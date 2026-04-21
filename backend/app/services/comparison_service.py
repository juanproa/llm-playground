"""Multi-model batch comparison orchestrator.

A ComparisonRun runs the same prompt against N models over the same set of
test cases and lets the UI compare results side-by-side.  Each model gets its
own child BacktestRun (using the existing backtest pipeline), so everything
works: inference cache, assertions, judge scoring, concurrency, logs.

The `children` JSON field on ComparisonRun holds the list of child run IDs.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.knowledge_base import KnowledgeBaseItem
from app.models.post_training import BacktestResult, BacktestRun, ComparisonRun, TestCase
from app.services import backtest_service

logger = logging.getLogger(__name__)


async def create_comparison_run(
    db: AsyncSession,
    project_id: str,
    name: str,
    prompt_version_id: str,
    model_config_ids: list[str],
    test_case_ids: list[str] | None,
    judge_model_config_id: str | None,
    knowledge_base_item_ids: list[str] | None = None,
) -> ComparisonRun:
    """Create the parent row + N child BacktestRuns (one per model).  Does not kick them off yet.

    Inputs can come from either KB items (materialized into TestCases) or directly
    from existing TestCase ids.  If both are empty, all project test cases are used.
    """
    from sqlalchemy import select as _sel

    if len(model_config_ids) < 2:
        raise ValueError("A comparison run needs at least 2 models to compare.")

    cases: list[TestCase] = []

    # ── 1. Materialize TestCases from selected KB items (find-or-create) ────
    if knowledge_base_item_ids:
        kb_result = await db.execute(
            _sel(KnowledgeBaseItem).where(KnowledgeBaseItem.id.in_(knowledge_base_item_ids))
        )
        kb_items = list(kb_result.scalars().all())
        if not kb_items:
            raise ValueError("None of the selected KB items were found.")

        # Look up any existing TestCases linked to these KB items for this project
        existing_result = await db.execute(
            _sel(TestCase).where(
                TestCase.project_id == project_id,
                TestCase.source_kb_item_id.in_([k.id for k in kb_items]),
            )
        )
        existing = {tc.source_kb_item_id: tc for tc in existing_result.scalars().all()}

        for item in kb_items:
            if item.id in existing:
                cases.append(existing[item.id])
                continue
            # Auto-create: no expected_output yet — user can curate it later.
            tc = TestCase(
                project_id=project_id,
                name=item.name,
                input_text=item.content,
                expected_output="",
                expected_type="generative",
                tags=item.description or None,
                notes=f"Auto-created from KB item {item.id}",
                is_golden=False,
                source_kb_item_id=item.id,
            )
            db.add(tc)
            await db.flush()
            cases.append(tc)

    # ── 2. OR use existing test cases by id ────────────────────────────────
    elif test_case_ids:
        result = await db.execute(
            _sel(TestCase)
            .where(TestCase.project_id == project_id, TestCase.id.in_(test_case_ids))
        )
        cases = list(result.scalars().all())

    # ── 3. Fallback: all project test cases ────────────────────────────────
    else:
        result = await db.execute(
            _sel(TestCase).where(TestCase.project_id == project_id)
        )
        cases = list(result.scalars().all())

    if not cases:
        raise ValueError("No inputs resolved — pick some KB items, test cases, or create test cases first.")
    case_ids = [c.id for c in cases]

    parent = ComparisonRun(
        project_id=project_id,
        name=name,
        prompt_version_id=prompt_version_id,
        model_config_ids=json.dumps(model_config_ids),
        test_case_ids=json.dumps(case_ids),
        judge_model_config_id=judge_model_config_id,
        status="pending",
    )
    db.add(parent)
    await db.flush()

    # Spawn one BacktestRun per model
    child_ids: list[str] = []
    for mid in model_config_ids:
        child = BacktestRun(
            project_id=project_id,
            name=f"{name} · {_short(mid)}",
            prompt_version_id=prompt_version_id,
            model_config_id=mid,
            pass_threshold=0.5,
            judge_model_config_id=judge_model_config_id,
            total_cases=len(case_ids),
        )
        db.add(child)
        await db.flush()

        # Pre-create result stubs (mirrors the single-run flow)
        for cid in case_ids:
            rr = BacktestResult(backtest_run_id=child.id, test_case_id=cid)
            db.add(rr)
        child_ids.append(child.id)

    parent.child_backtest_run_ids = json.dumps(child_ids)
    await db.commit()
    await db.refresh(parent)
    return parent


def _short(s: str) -> str:
    return s[:8] if s else ""


async def run_comparison(comparison_id: str) -> None:
    """Execute a ComparisonRun: run every child BacktestRun in parallel."""
    async with async_session() as db:
        parent = await db.get(ComparisonRun, comparison_id)
        if not parent:
            logger.error("ComparisonRun %s not found", comparison_id)
            return

        parent.status = "running"
        parent.started_at = datetime.now(timezone.utc)
        await db.commit()

        try:
            child_ids = json.loads(parent.child_backtest_run_ids or "[]")
        except Exception:
            child_ids = []

    # Fire all children concurrently.  Each BacktestRun has its own semaphore
    # (MAX_CONCURRENT=5), so total in-flight inferences = 5 × len(children).
    async def _one(cid: str) -> None:
        try:
            await backtest_service.run_backtest(cid)
        except Exception as e:
            logger.exception("Child backtest %s failed: %s", cid, e)

    await asyncio.gather(*[_one(cid) for cid in child_ids])

    # Aggregate status
    async with async_session() as db:
        parent = await db.get(ComparisonRun, comparison_id)
        if not parent:
            return
        try:
            child_ids = json.loads(parent.child_backtest_run_ids or "[]")
        except Exception:
            child_ids = []

        r = await db.execute(
            select(BacktestRun).where(BacktestRun.id.in_(child_ids))
        )
        children = list(r.scalars().all())

        if any(c.status == "failed" for c in children):
            parent.status = "failed"
            parent.error_message = "One or more child runs failed."
        elif all(c.status == "completed" for c in children):
            parent.status = "completed"
        else:
            parent.status = "partial"
        parent.completed_at = datetime.now(timezone.utc)
        await db.commit()


async def get_comparison_with_children(db: AsyncSession, comparison_id: str) -> dict | None:
    """Return a JSON-serializable dict of the comparison + all child runs + results + test cases."""
    parent = await db.get(ComparisonRun, comparison_id)
    if not parent:
        return None

    try:
        child_ids = json.loads(parent.child_backtest_run_ids or "[]")
    except Exception:
        child_ids = []

    r = await db.execute(select(BacktestRun).where(BacktestRun.id.in_(child_ids)))
    children = list(r.scalars().all())

    children_out = []
    for child in children:
        rr = await db.execute(
            select(BacktestResult).where(BacktestResult.backtest_run_id == child.id)
        )
        results = list(rr.scalars().all())

        # Attach test cases
        tcs_ids = [res.test_case_id for res in results]
        tcr = await db.execute(select(TestCase).where(TestCase.id.in_(tcs_ids)))
        tcs = {tc.id: tc for tc in tcr.scalars().all()}

        children_out.append({
            "id": child.id,
            "project_id": child.project_id,
            "name": child.name,
            "prompt_version_id": child.prompt_version_id,
            "model_config_id": child.model_config_id,
            "status": child.status,
            "pass_threshold": child.pass_threshold,
            "judge_model_config_id": child.judge_model_config_id,
            "total_cases": child.total_cases,
            "passed_cases": child.passed_cases,
            "failed_cases": child.failed_cases,
            "pass_rate": child.pass_rate,
            "error_message": child.error_message,
            "started_at": child.started_at.isoformat() if child.started_at else None,
            "completed_at": child.completed_at.isoformat() if child.completed_at else None,
            "created_at": child.created_at.isoformat(),
            "results": [
                {
                    "id": res.id,
                    "backtest_run_id": res.backtest_run_id,
                    "test_case_id": res.test_case_id,
                    "actual_output": res.actual_output,
                    "status": res.status,
                    "pass_score": res.pass_score,
                    "assertion_results": res.assertion_results,
                    "cache_hit": res.cache_hit,
                    "latency_ms": res.latency_ms,
                    "error_message": res.error_message,
                    "created_at": res.created_at.isoformat(),
                    "test_case": (
                        {
                            "id": tc.id,
                            "project_id": tc.project_id,
                            "name": tc.name,
                            "input_text": tc.input_text,
                            "expected_output": tc.expected_output,
                            "expected_type": tc.expected_type,
                            "tags": tc.tags,
                            "notes": tc.notes,
                            "is_golden": tc.is_golden,
                            "document_id": tc.document_id,
                            "assertions": tc.assertions,
                            "pass_threshold": tc.pass_threshold,
                            "created_at": tc.created_at.isoformat(),
                            "updated_at": tc.updated_at.isoformat(),
                        }
                        if (tc := tcs.get(res.test_case_id)) else None
                    ),
                }
                for res in results
            ],
        })

    return {
        "id": parent.id,
        "project_id": parent.project_id,
        "name": parent.name,
        "prompt_version_id": parent.prompt_version_id,
        "model_config_ids": parent.model_config_ids,
        "test_case_ids": parent.test_case_ids,
        "child_backtest_run_ids": parent.child_backtest_run_ids,
        "judge_model_config_id": parent.judge_model_config_id,
        "status": parent.status,
        "error_message": parent.error_message,
        "started_at": parent.started_at.isoformat() if parent.started_at else None,
        "completed_at": parent.completed_at.isoformat() if parent.completed_at else None,
        "created_at": parent.created_at.isoformat(),
        "children": children_out,
    }
