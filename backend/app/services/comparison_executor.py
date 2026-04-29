"""Batch Compare executor — runs one ComparisonChild over its input items.

Forked from backtest_service so Batch Compare can stop polluting the Backtest
tables. Differences from backtest:
  • operates on ComparisonChild / ComparisonResult / ComparisonInputItem (not
    BacktestRun / BacktestResult / TestCase)
  • no assertions; judge model is optional, scoring only when judge is set
  • supports two child kinds: 'model' and 'chain'
  • caches inference under input_item_id rather than test_case_id

A chain child runs the full DAG once per input item and stores `{node_name:
text}` JSON (the same shape the Model Chain page exposes) so reviewers can
see every intermediate node, not just terminals.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import async_session
from app.models.chain import Chain, ChainRun
from app.models.model_config import ModelConfig
from app.models.post_training import (
    ComparisonChild,
    ComparisonInputItem,
    ComparisonResult,
    InferenceCache,
)
from app.models.prompt import PromptVersion
from app.providers.registry import get_provider
from app.services.backtest_service import _strip_think  # canonical <think> cleanup
from app.services.model_config_service import decrypt_api_key

logger = logging.getLogger(__name__)

MAX_CONCURRENT = 5
DEFAULT_MAX_TOKENS = 4096

_DB_WRITE_LOCK = asyncio.Lock()


# ─── Public entry point ─────────────────────────────────────────────────────


async def run_comparison_child(child_id: str) -> None:
    """Execute one ComparisonChild end-to-end, in its own session."""
    async with async_session() as db:
        child = await db.get(ComparisonChild, child_id)
        if not child:
            logger.error("ComparisonChild %s not found", child_id)
            return
        if child.status in ("cancelling", "cancelled"):
            child.status = "cancelled"
            child.completed_at = datetime.now(timezone.utc)
            await db.commit()
            return
        kind = child.kind

    if kind == "chain":
        await _execute_chain_child(child_id)
    else:
        await _execute_model_child(child_id)


async def _is_child_cancelling(child_id: str) -> bool:
    async with async_session() as peek_db:
        row = await peek_db.get(ComparisonChild, child_id)
        return bool(row and row.status in ("cancelling", "cancelled"))


# ─── LLM-as-judge (optional) ────────────────────────────────────────────────
# Without an expected_output we have nothing to grade against, so judge use
# is rare in Batch Compare. Kept here as a hook for future "rate this output
# 0–1" style scoring; currently only fires when the parent run has a
# judge_model_config_id set AND the row has reference text — which it never
# does in the current schema. Leaving the plumbing in so it's trivial to add
# expected outputs later without rewriting the executor.


# ─── Model child execution ──────────────────────────────────────────────────


async def _execute_model_child(child_id: str) -> None:
    async with async_session() as db:
        child = await db.get(ComparisonChild, child_id)
        if not child:
            return

        child.status = "running"
        child.started_at = datetime.now(timezone.utc)
        await db.commit()

        try:
            prompt_version = await db.get(PromptVersion, child.prompt_version_id) if child.prompt_version_id else None
            model_config = await db.get(ModelConfig, child.model_config_id) if child.model_config_id else None
            if not prompt_version or not model_config:
                child.status = "failed"
                child.error_message = "Invalid prompt version or model config"
                child.completed_at = datetime.now(timezone.utc)
                await db.commit()
                return

            result_rows = await db.execute(
                select(ComparisonResult).where(ComparisonResult.child_id == child_id)
            )
            results = list(result_rows.scalars().all())
            if not results:
                child.status = "completed"
                child.completed_at = datetime.now(timezone.utc)
                await db.commit()
                return

            model_snap = {
                "id": model_config.id,
                "provider": model_config.provider,
                "model_id": model_config.model_id,
                "temperature": model_config.temperature,
                "max_tokens": model_config.max_tokens if (model_config.max_tokens or 0) > 0 else DEFAULT_MAX_TOKENS,
                "extra_params": dict(model_config.extra_params or {}),
                "adapter_path": model_config.adapter_path,
                "api_key_encrypted": model_config.api_key_encrypted,
                "base_url": model_config.base_url,
            }
            prompt_snap = {
                "system_message": prompt_version.system_message,
                "content": prompt_version.content,
                "id": prompt_version.id,
            }
            result_ids = [r.id for r in results]
        except Exception as e:
            logger.exception("Model child %s setup failed", child_id)
            child.status = "failed"
            child.error_message = str(e)[:500]
            child.completed_at = datetime.now(timezone.utc)
            await db.commit()
            return

    semaphore = asyncio.Semaphore(MAX_CONCURRENT)

    async def run_one(result_id: str) -> None:
        async with semaphore:
            if await _is_child_cancelling(child_id):
                outcome = {"status": "cancelled", "actual_output": None,
                           "latency_ms": 0, "cache_hit": False, "error_message": None}
            else:
                try:
                    outcome = await _run_single_cell(result_id, prompt_snap, model_snap)
                except Exception as e:
                    logger.exception("comparison cell %s crashed", result_id)
                    outcome = {"status": "failed", "actual_output": None,
                               "latency_ms": 0, "cache_hit": False,
                               "error_message": str(e)[:500]}

        async with _DB_WRITE_LOCK:
            async with async_session() as wdb:
                row = await wdb.get(ComparisonResult, result_id)
                if row is None:
                    return
                row.status = outcome["status"]
                row.actual_output = outcome["actual_output"]
                row.latency_ms = outcome["latency_ms"]
                row.cache_hit = outcome["cache_hit"]
                if outcome.get("error_message"):
                    row.error_message = outcome["error_message"]
                await wdb.commit()

    await asyncio.gather(*[run_one(rid) for rid in result_ids])

    async with async_session() as db:
        child = await db.get(ComparisonChild, child_id)
        if child is None:
            return
        child.status = "cancelled" if child.status in ("cancelling", "cancelled") else "completed"
        child.completed_at = datetime.now(timezone.utc)
        await db.commit()


async def _run_single_cell(result_id: str, prompt_snap: dict, model_snap: dict) -> dict:
    """One inference call for one (child, input_item) pair."""
    async with async_session() as read_db:
        res = await read_db.get(ComparisonResult, result_id)
        if not res:
            return {"status": "failed", "actual_output": None, "latency_ms": 0,
                    "cache_hit": False, "error_message": "result row vanished"}
        item = await read_db.get(ComparisonInputItem, res.input_item_id)
        if not item:
            return {"status": "failed", "actual_output": None, "latency_ms": 0,
                    "cache_hit": False, "error_message": "input item not found"}
        input_text = item.input_text
        item_id = item.id

    messages: list[dict] = []
    if prompt_snap["system_message"]:
        messages.append({"role": "system", "content": prompt_snap["system_message"]})
    user_content = prompt_snap["content"]
    if input_text:
        user_content += f"\n\n--- User Input ---\n{input_text}"
    messages.append({"role": "user", "content": user_content})

    api_key = decrypt_api_key(model_snap["api_key_encrypted"]) if model_snap["api_key_encrypted"] else None
    provider = get_provider(model_snap["provider"], api_key=api_key, base_url=model_snap["base_url"])

    extra = dict(model_snap["extra_params"] or {})
    if model_snap.get("adapter_path"):
        extra.setdefault("adapter_path", model_snap["adapter_path"])

    start = time.monotonic()
    cache_hit = False
    actual: str | None = None
    elapsed_ms = 0

    try:
        max_tokens = model_snap["max_tokens"]
        # Cache: keyed on (prompt, model, input_item, max_tokens, temperature).
        # Reuses the existing pt_inference_cache table — input_item_id slots
        # into the test_case_id column (it's just a UUID; namespaces don't
        # cross because no real TestCase shares an id with an InputItem).
        async with _DB_WRITE_LOCK:
            async with async_session() as cdb:
                cached = await _lookup_cache(
                    cdb,
                    prompt_version_id=prompt_snap["id"],
                    model_config_id=model_snap["id"],
                    test_case_id=item_id,
                    max_tokens=max_tokens,
                    temperature=model_snap["temperature"],
                )
                if cached is not None:
                    actual = _strip_think(cached.output)
                    elapsed_ms = cached.latency_ms or 0
                    cache_hit = True

        if actual is None:
            response = await provider.generate(
                messages=messages,
                model_id=model_snap["model_id"],
                max_tokens=max_tokens,
                temperature=model_snap["temperature"],
                **extra,
            )
            elapsed_ms = int((time.monotonic() - start) * 1000)
            actual = _strip_think(response.content)

            async with _DB_WRITE_LOCK:
                async with async_session() as cdb:
                    await _store_cache(
                        cdb,
                        prompt_version_id=prompt_snap["id"],
                        model_config_id=model_snap["id"],
                        test_case_id=item_id,
                        max_tokens=max_tokens,
                        temperature=model_snap["temperature"],
                        output=actual,
                        latency_ms=elapsed_ms,
                    )
                    await cdb.commit()

        # No expected_output in Batch Compare → no scoring.
        return {"status": "completed", "actual_output": actual, "latency_ms": elapsed_ms,
                "cache_hit": cache_hit, "error_message": None}
    except Exception as e:
        return {"status": "failed", "actual_output": None,
                "latency_ms": int((time.monotonic() - start) * 1000),
                "cache_hit": False, "error_message": str(e)[:500]}


# ─── Chain child execution ──────────────────────────────────────────────────


async def _execute_chain_child(child_id: str) -> None:
    """Run the chain DAG once per input item; aggregate per-node outputs."""
    from app.services import chain_run_service  # lazy: avoids circular at import time

    async with async_session() as db:
        child = await db.get(ComparisonChild, child_id)
        if not child or not child.chain_id:
            return
        child.status = "running"
        child.started_at = datetime.now(timezone.utc)
        await db.commit()

        chain_id = child.chain_id

        chain_q = await db.execute(
            select(Chain).where(Chain.id == chain_id)
            .options(selectinload(Chain.nodes), selectinload(Chain.edges))
        )
        chain = chain_q.scalar_one_or_none()
        if not chain:
            child.status = "failed"
            child.error_message = "Chain not found"
            child.completed_at = datetime.now(timezone.utc)
            await db.commit()
            return

        outgoing = {e.source_node_id for e in chain.edges}
        terminals = [n for n in chain.nodes if n.id not in outgoing]
        if not terminals:
            child.status = "failed"
            child.error_message = (
                f"Chain '{chain.name}' has no terminal node (cycle?). Edit the chain and try again."
            )
            child.completed_at = datetime.now(timezone.utc)
            await db.commit()
            return

        result_rows = await db.execute(
            select(ComparisonResult).where(ComparisonResult.child_id == child_id)
        )
        results = list(result_rows.scalars().all())
        if not results:
            child.status = "completed"
            child.completed_at = datetime.now(timezone.utc)
            await db.commit()
            return

    for r in results:
        if await _is_child_cancelling(child_id):
            async with _DB_WRITE_LOCK:
                async with async_session() as wdb:
                    row = await wdb.get(ComparisonResult, r.id)
                    if row is not None:
                        row.status = "cancelled"
                        await wdb.commit()
            continue

        async with async_session() as read_db:
            item = await read_db.get(ComparisonInputItem, r.input_item_id)
        if not item:
            async with _DB_WRITE_LOCK:
                async with async_session() as wdb:
                    row = await wdb.get(ComparisonResult, r.id)
                    if row is not None:
                        row.status = "failed"
                        row.error_message = "Input item not found"
                        await wdb.commit()
            continue

        chain_run_id: str | None = None
        try:
            async with async_session() as start_db:
                cr = await chain_run_service.start_chain_run(
                    start_db,
                    chain_id,
                    wipe_prior=False,
                    input_override=item.input_text or "",
                )
                if cr is None:
                    raise RuntimeError("start_chain_run returned None")
                await start_db.commit()
                chain_run_id = cr.id

            t0 = time.monotonic()
            await chain_run_service.execute_chain_run(chain_run_id)
            elapsed_ms = int((time.monotonic() - t0) * 1000)

            async with async_session() as read_db:
                cr_done = await read_db.get(ChainRun, chain_run_id)
                final_output_json = cr_done.final_output if cr_done else None
                cr_status = cr_done.status if cr_done else "failed"
                cr_error = cr_done.error_message if cr_done else None
        except Exception as e:
            logger.exception("Chain comparison cell %s failed", r.id)
            async with _DB_WRITE_LOCK:
                async with async_session() as wdb:
                    row = await wdb.get(ComparisonResult, r.id)
                    if row is not None:
                        row.status = "failed"
                        row.error_message = str(e)[:500]
                        row.latency_ms = 0
                        await wdb.commit()
            continue

        if cr_status == "failed":
            status = "failed"
            error_msg = cr_error
        elif cr_status == "cancelled":
            status = "cancelled"
            error_msg = None
        else:
            status = "completed"
            error_msg = None

        async with _DB_WRITE_LOCK:
            async with async_session() as wdb:
                row = await wdb.get(ComparisonResult, r.id)
                if row is not None:
                    row.status = status
                    row.actual_output = final_output_json or "{}"
                    row.latency_ms = elapsed_ms
                    if error_msg:
                        row.error_message = error_msg
                    await wdb.commit()

    async with async_session() as db:
        child = await db.get(ComparisonChild, child_id)
        if child is None:
            return
        child.status = "cancelled" if child.status in ("cancelling", "cancelled") else "completed"
        child.completed_at = datetime.now(timezone.utc)
        await db.commit()


# ─── Inference cache helpers (forked: no document_id dimension) ─────────────


async def _lookup_cache(
    db: AsyncSession,
    *,
    prompt_version_id: str,
    model_config_id: str,
    test_case_id: str,
    max_tokens: int,
    temperature: float,
) -> InferenceCache | None:
    from sqlalchemy import and_
    q = select(InferenceCache).where(and_(
        InferenceCache.prompt_version_id == prompt_version_id,
        InferenceCache.model_config_id == model_config_id,
        InferenceCache.test_case_id == test_case_id,
        InferenceCache.document_id.is_(None),
        InferenceCache.max_tokens == max_tokens,
        InferenceCache.temperature == temperature,
    ))
    r = await db.execute(q)
    return r.scalars().first()


async def _store_cache(
    db: AsyncSession,
    *,
    prompt_version_id: str,
    model_config_id: str,
    test_case_id: str,
    max_tokens: int,
    temperature: float,
    output: str,
    latency_ms: int,
) -> None:
    db.add(InferenceCache(
        prompt_version_id=prompt_version_id,
        model_config_id=model_config_id,
        test_case_id=test_case_id,
        document_id=None,
        max_tokens=max_tokens,
        temperature=temperature,
        output=output,
        latency_ms=latency_ms,
    ))
