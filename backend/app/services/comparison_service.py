"""Batch Compare orchestrator (hard-split from Backtest).

A ComparisonRun has:
  • input items (rows): ad-hoc text or pulled from an InputDataset
  • children (columns): each is either a (prompt+model) or a chain
  • results: one ComparisonResult per (child × input_item) cell

This service owns its own tables — pt_comparison_runs, pt_comparison_children,
pt_comparison_input_items, pt_comparison_results — and does NOT share rows
with Backtest. See comparison_executor for the per-child runtime.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import async_session
from app.models.chain import Chain, ChainNode
from app.models.input_dataset import InputDataset, InputDatasetItem
from app.models.model_config import ModelConfig
from app.models.post_training import (
    ComparisonChild,
    ComparisonInputItem,
    ComparisonResult,
    ComparisonRun,
)
from app.providers import mlx_local
from app.services import comparison_executor

# Local-runtime providers serialize so the single-slot mlx model cache /
# Ollama swap don't thrash. Cloud providers stay parallel.
_LOCAL_PROVIDERS = {"mlx_local", "ollama"}

logger = logging.getLogger(__name__)


# ─── Validation ─────────────────────────────────────────────────────────────


async def _validate_chain_for_batch_compare(db: AsyncSession, chain_id: str) -> Chain:
    """Reject chains that can't be used as a Batch Compare column.

    Multi-terminal chains are allowed — the chain runtime aggregates every
    node's output into the cell value, so all branches are visible.
    Raises ValueError on cycle, missing nodes, or unconfigured nodes.
    """
    chain = await db.get(
        Chain, chain_id,
        options=[selectinload(Chain.nodes), selectinload(Chain.edges)],
    )
    if not chain:
        raise ValueError(f"Chain {chain_id} not found.")
    if not chain.nodes:
        raise ValueError(f"Chain '{chain.name}' has no nodes — add nodes before running.")

    has_outgoing = {e.source_node_id for e in chain.edges}
    terminals = [n for n in chain.nodes if n.id not in has_outgoing]
    if not terminals:
        raise ValueError(
            f"Chain '{chain.name}' has no terminal node — every node has an outgoing edge,"
            " which means the graph is cyclic. Remove the cycle before running."
        )
    unconfigured = [n.name for n in chain.nodes if not (n.prompt_version_id and n.model_config_id)]
    if unconfigured:
        raise ValueError(
            f"Chain '{chain.name}' has unconfigured node(s): {', '.join(unconfigured)}."
            " Each node needs a prompt version and model."
        )
    return chain


# ─── Create ─────────────────────────────────────────────────────────────────


async def create_comparison_run(
    db: AsyncSession,
    project_id: str,
    name: str,
    prompt_version_id: str | None,
    model_config_ids: list[str],
    judge_model_config_id: str | None,
    input_dataset_id: str | None = None,
    input_dataset_item_ids: list[str] | None = None,
    input_texts: list[str] | None = None,
    prompt_version_overrides: dict[str, str] | None = None,
    chain_ids: list[str] | None = None,
) -> ComparisonRun:
    """Materialize the parent + input items + children, ready for execution.

    Inputs come from EITHER an InputDataset (sidebar "Datasets" — table
    `input_datasets`, NOT `pt_datasets`/SFT) or an explicit `input_texts`
    list. At least one row must resolve.

    Each model_config_id becomes a ComparisonChild (kind='model'); each
    chain_id becomes a ComparisonChild (kind='chain'). prompt_version_id
    is the default for model children; per-model overrides via
    prompt_version_overrides.
    """
    chain_ids = chain_ids or []
    if not model_config_ids and not chain_ids:
        raise ValueError("Pick at least one model or chain to run.")

    # Validate chains up front — fail fast before writing anything.
    chains: list[Chain] = []
    for cid in chain_ids:
        chains.append(await _validate_chain_for_batch_compare(db, cid))

    overrides_in = prompt_version_overrides or {}
    missing = [mid for mid in model_config_ids if not (overrides_in.get(mid) or prompt_version_id)]
    if missing:
        raise ValueError(
            "No prompt for model(s) " + ", ".join(missing)
            + ". Either pick a default prompt or set an override for each model."
        )

    # ── 1. Resolve input rows ──────────────────────────────────────────────
    # Tuples are (input_text, source_input_dataset_item_id, display_name).
    # `display_name` is copied from InputDatasetItem.name so the matrix
    # header column doesn't have to join back to the source dataset
    # (which may be deleted or renamed later).
    rows: list[tuple[str, str | None, str | None]] = []
    if input_dataset_id:
        dataset = await db.get(InputDataset, input_dataset_id)
        if not dataset:
            raise ValueError("Input dataset not found.")
        q = select(InputDatasetItem).where(InputDatasetItem.dataset_id == input_dataset_id)
        if input_dataset_item_ids:
            q = q.where(InputDatasetItem.id.in_(input_dataset_item_ids))
        q = q.order_by(InputDatasetItem.created_at.asc())
        items = list((await db.execute(q)).scalars().all())
        if not items:
            raise ValueError(
                "No items selected — this dataset is empty or none of the picked item ids matched."
            )
        for item in items:
            # Once PII has been masked, the masked content is the only version
            # allowed to leave the dataset (see InputDatasetItem.effective_content).
            rows.append((item.effective_content, item.id, item.name))
    elif input_texts:
        for txt in input_texts:
            if txt and txt.strip():
                rows.append((txt, None, None))
    if not rows:
        raise ValueError("No inputs resolved — pick an input dataset or enter at least one input row.")

    # Parent row needs a non-null prompt_version_id (legacy NOT NULL FK). Use the
    # first available prompt: explicit default → first override → first chain's
    # first node's prompt. The actual prompt for each child lives on the child row.
    if prompt_version_id:
        parent_pv = prompt_version_id
    elif model_config_ids:
        parent_pv = overrides_in[model_config_ids[0]]
    else:
        parent_pv = chains[0].nodes[0].prompt_version_id  # type: ignore[assignment]

    # ── 2. Persist parent + input items + children + result stubs ──────────
    parent = ComparisonRun(
        project_id=project_id,
        name=name,
        prompt_version_id=parent_pv,
        model_config_ids="[]",  # legacy NOT NULL — children carry the truth now
        judge_model_config_id=judge_model_config_id,
        status="pending",
    )
    db.add(parent)
    await db.flush()

    input_items: list[ComparisonInputItem] = []
    for idx, (text, src_id, item_name) in enumerate(rows):
        ii = ComparisonInputItem(
            comparison_run_id=parent.id,
            input_text=text,
            name=item_name,
            source_input_dataset_item_id=src_id,
            ordering=idx,
        )
        db.add(ii)
        input_items.append(ii)
    await db.flush()

    children: list[ComparisonChild] = []
    ordering = 0
    for mid in model_config_ids:
        c = ComparisonChild(
            comparison_run_id=parent.id,
            kind="model",
            model_config_id=mid,
            prompt_version_id=overrides_in.get(mid, parent_pv),
            ordering=ordering,
        )
        db.add(c)
        children.append(c)
        ordering += 1
    for chain in chains:
        c = ComparisonChild(
            comparison_run_id=parent.id,
            kind="chain",
            chain_id=chain.id,
            ordering=ordering,
        )
        db.add(c)
        children.append(c)
        ordering += 1
    await db.flush()

    for child in children:
        for item in input_items:
            db.add(ComparisonResult(child_id=child.id, input_item_id=item.id))
    await db.commit()
    await db.refresh(parent)
    return parent


# ─── Run ────────────────────────────────────────────────────────────────────


async def run_comparison(comparison_id: str) -> None:
    """Execute every child of a comparison run, with provider-aware scheduling.

    Local runtimes (mlx_local, ollama) are strictly serialized. Cloud
    providers and chain children run in parallel — chains may internally
    use mlx, but that's the executor's problem; we don't introspect their
    nodes here.
    """
    async with async_session() as db:
        parent = await db.get(ComparisonRun, comparison_id)
        if not parent:
            logger.error("ComparisonRun %s not found", comparison_id)
            return
        parent.status = "running"
        parent.started_at = datetime.now(timezone.utc)
        await db.commit()

        cr = await db.execute(
            select(ComparisonChild).where(ComparisonChild.comparison_run_id == comparison_id)
            .order_by(ComparisonChild.ordering.asc())
        )
        children = list(cr.scalars().all())
        model_ids = [c.model_config_id for c in children if c.kind == "model" and c.model_config_id]
        mr = await db.execute(select(ModelConfig).where(ModelConfig.id.in_(model_ids))) if model_ids else None
        mc_by_id = {m.id: m for m in (mr.scalars().all() if mr else [])}

    # Bucket: local children (serialized) vs cloud children (parallel).
    # Chain children go in the local bucket — they may load mlx internally
    # and we don't want to thrash the single-slot model cache by running
    # several chain runs at once.
    local_children: list[tuple[str, ModelConfig | None]] = []
    cloud_children: list[str] = []
    for c in children:
        if c.kind == "chain":
            local_children.append((c.id, None))
            continue
        mc = mc_by_id.get(c.model_config_id) if c.model_config_id else None
        if mc and mc.provider in _LOCAL_PROVIDERS:
            local_children.append((c.id, mc))
        else:
            cloud_children.append(c.id)

    async def _one(cid: str) -> None:
        try:
            await comparison_executor.run_comparison_child(cid)
        except Exception as e:
            logger.exception("Comparison child %s crashed: %s", cid, e)

    cloud_task = asyncio.gather(*[_one(cid) for cid in cloud_children])

    async def _run_local_serially() -> None:
        for cid, mc in local_children:
            await _one(cid)
            if mc and mc.provider == "mlx_local":
                try:
                    mlx_local.unload(mc.model_id, mc.adapter_path)
                except Exception as e:
                    logger.warning("mlx unload after %s failed: %s", cid, e)

    await asyncio.gather(cloud_task, _run_local_serially())

    async with async_session() as db:
        parent = await db.get(ComparisonRun, comparison_id)
        if not parent:
            return
        cr = await db.execute(
            select(ComparisonChild).where(ComparisonChild.comparison_run_id == comparison_id)
        )
        children = list(cr.scalars().all())
        if parent.status in ("cancelling", "cancelled") or any(
            c.status in ("cancelling", "cancelled") for c in children
        ):
            parent.status = "cancelled"
        elif any(c.status == "failed" for c in children):
            parent.status = "failed"
            parent.error_message = "One or more child runs failed."
        elif all(c.status == "completed" for c in children):
            parent.status = "completed"
        else:
            parent.status = "partial"
        parent.completed_at = datetime.now(timezone.utc)
        await db.commit()


# ─── Cancel ─────────────────────────────────────────────────────────────────


async def cancel_comparison_run(db: AsyncSession, comparison_id: str) -> ComparisonRun | None:
    """Mark the parent + every running child as 'cancelling'.

    The executor polls this between cells and short-circuits. Already-terminal
    children are left alone — cancel is idempotent.
    """
    parent = await db.get(ComparisonRun, comparison_id)
    if not parent:
        return None
    if parent.status in ("completed", "failed", "cancelled"):
        return parent

    cr = await db.execute(
        select(ComparisonChild).where(ComparisonChild.comparison_run_id == comparison_id)
    )
    for child in cr.scalars().all():
        if child.status not in ("completed", "failed", "cancelled"):
            child.status = "cancelling"
    parent.status = "cancelling"
    await db.commit()
    await db.refresh(parent)
    return parent


# ─── Read ───────────────────────────────────────────────────────────────────


async def get_comparison_with_children(db: AsyncSession, comparison_id: str) -> dict | None:
    """JSON-serializable matrix payload: parent + input_items + children (each with results)."""
    parent = await db.get(ComparisonRun, comparison_id)
    if not parent:
        return None

    items_q = await db.execute(
        select(ComparisonInputItem)
        .where(ComparisonInputItem.comparison_run_id == comparison_id)
        .order_by(ComparisonInputItem.ordering.asc(), ComparisonInputItem.created_at.asc())
    )
    items = list(items_q.scalars().all())

    children_q = await db.execute(
        select(ComparisonChild)
        .where(ComparisonChild.comparison_run_id == comparison_id)
        .order_by(ComparisonChild.ordering.asc(), ComparisonChild.created_at.asc())
    )
    children = list(children_q.scalars().all())

    children_out = []
    for child in children:
        rr = await db.execute(
            select(ComparisonResult).where(ComparisonResult.child_id == child.id)
        )
        results = list(rr.scalars().all())
        children_out.append({
            "id": child.id,
            "comparison_run_id": child.comparison_run_id,
            "kind": child.kind,
            "model_config_id": child.model_config_id,
            "prompt_version_id": child.prompt_version_id,
            "chain_id": child.chain_id,
            "status": child.status,
            "error_message": child.error_message,
            "ordering": child.ordering,
            "started_at": child.started_at.isoformat() if child.started_at else None,
            "completed_at": child.completed_at.isoformat() if child.completed_at else None,
            "created_at": child.created_at.isoformat(),
            "results": [
                {
                    "id": r.id,
                    "child_id": r.child_id,
                    "input_item_id": r.input_item_id,
                    "actual_output": r.actual_output,
                    "status": r.status,
                    "pass_score": r.pass_score,
                    "latency_ms": r.latency_ms,
                    "cache_hit": r.cache_hit,
                    "error_message": r.error_message,
                    "created_at": r.created_at.isoformat(),
                }
                for r in results
            ],
        })

    return {
        "id": parent.id,
        "project_id": parent.project_id,
        "name": parent.name,
        "prompt_version_id": parent.prompt_version_id,
        "judge_model_config_id": parent.judge_model_config_id,
        "status": parent.status,
        "error_message": parent.error_message,
        "started_at": parent.started_at.isoformat() if parent.started_at else None,
        "completed_at": parent.completed_at.isoformat() if parent.completed_at else None,
        "created_at": parent.created_at.isoformat(),
        "input_items": [
            {
                "id": it.id,
                "comparison_run_id": it.comparison_run_id,
                "input_text": it.input_text,
                "name": it.name,
                "source_input_dataset_item_id": it.source_input_dataset_item_id,
                "ordering": it.ordering,
                "created_at": it.created_at.isoformat(),
            }
            for it in items
        ],
        "children": children_out,
    }
