"""Background worker for the SyntheticJob: LLM-driven SFT data augmentation.

A SyntheticJob reads from a *source* `Dataset`, calls the configured LLM N
times per item (N is decided by the per-tag multiplier table), and writes the
variants into a brand-new *target* `Dataset`. The source is never mutated.

Why an LLM, not regex substitution: the goal is "produce a different-looking
input that still maps to the same expected output." That's a semantic rewrite
problem (paraphrase, domain-shift, harder-edge-case) which only a language
model handles cleanly. The `variation_prompt` template carries both the
original `input_text` AND the `output_text` so the LLM has a fixed target the
rewrite must still produce.

Only `input_text` is varied. `output_text`, `instruction`, and `system_message`
are copied verbatim from the parent — varying the expected output would invent
new ground truth (the classic synthetic-data-poisons-the-model trap).
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from app.database import async_session
from app.models.model_config import ModelConfig
from app.models.post_training import Dataset, DatasetItem, SyntheticJob
from app.providers.registry import get_provider
from app.services.model_config_service import decrypt_api_key

logger = logging.getLogger(__name__)


# 90s timeout per variant call. Variation is short-form rewriting — even a slow
# remote model usually finishes within a few seconds. A higher ceiling lets
# rare-but-legitimate long generations through without false failures.
VARIANT_TIMEOUT_SECONDS = 90

# Diversity over determinism. Synthetic data's whole purpose is to look
# different from the source while preserving meaning — temperature=0 would
# defeat that. 0.8 is the empirical sweet spot for paraphrase-style tasks.
VARIANT_TEMPERATURE = 0.8


def _parse_tags(raw: str | None) -> list[str]:
    """Split the comma-separated tag column into a clean token list."""
    if not raw:
        return []
    return [t.strip() for t in raw.split(",") if t.strip()]


def _variants_for(item_tags: list[str], multipliers: dict[str, int]) -> int:
    """Decide how many variants this item should produce.

    The multiplier map is `{tag: count, "_default": baseline}`. When an item
    carries multiple matching tags, MAX wins — i.e. if `bt:failed` says 5 and
    `is_golden` says 3, the item gets 5. This is intentional: emphasising the
    most-emphasised dimension is the natural reading of "make more of THIS."
    Falls back to `_default` (or 1) for items with no matching tag.
    """
    matching = [multipliers[t] for t in item_tags if t in multipliers]
    if matching:
        return max(matching)
    return int(multipliers.get("_default", 1))


def _short_model_name(provider: str, model_id: str | None) -> str:
    """Make a compact tag-friendly label for `synthetic_model:<...>`."""
    short = (model_id or "?").split("/")[-1][:40]
    return f"{provider}:{short}"


def _substitute_prompt(template: str, input_text: str, output_text: str) -> str:
    """Inject parent input/output into the user-edited prompt template.

    We use plain string substitution rather than `str.format` because the
    template may itself contain JSON braces, percent signs, or other content
    that would crash a stricter formatter. KISS.
    """
    return (
        template
        .replace("{input_text}", input_text or "")
        .replace("{output_text}", output_text or "")
    )


async def _should_stop(job_id: str) -> bool:
    """Cooperative cancel check between items. Returns True when the worker
    should bail — job was deleted, user clicked Cancel, or admin reset.
    """
    async with async_session() as db:
        job = await db.get(SyntheticJob, job_id)
        if not job:
            return True
        return job.status not in ("running", "pending")


async def generate_synthetic_for_dataset(job_id: str) -> None:
    """Main entry point invoked via FastAPI's BackgroundTasks.

    Reads the source dataset's items once into memory at start (so deleting
    the source mid-job doesn't crash us), then loops with cooperative cancel
    between items. Updates the job's progress counters and the target
    dataset's `item_count` as it goes so the UI polling shows live progress.
    """
    # ── Initial load: job + source items + model + parsed multipliers ──
    try:
        async with async_session() as db:
            job = await db.get(SyntheticJob, job_id)
            if not job:
                logger.warning("synthetic: job %s not found at start", job_id)
                return
            # Mark running + stamp start time.
            job.status = "running"
            job.started_at = datetime.now(timezone.utc)
            await db.commit()
            await db.refresh(job)

            if not job.source_dataset_id or not job.target_dataset_id:
                job.status = "failed"
                job.error_message = "Job is missing source or target dataset id"
                job.completed_at = datetime.now(timezone.utc)
                await db.commit()
                return

            if not job.model_config_id:
                job.status = "failed"
                job.error_message = "Job is missing model_config_id"
                job.completed_at = datetime.now(timezone.utc)
                await db.commit()
                return

            model_config = await db.get(ModelConfig, job.model_config_id)
            if not model_config:
                job.status = "failed"
                job.error_message = f"Model {job.model_config_id} not found"
                job.completed_at = datetime.now(timezone.utc)
                await db.commit()
                return

            try:
                multipliers: dict[str, int] = json.loads(job.tag_multipliers or "{}")
            except Exception as e:
                job.status = "failed"
                job.error_message = f"Bad tag_multipliers JSON: {e}"
                job.completed_at = datetime.now(timezone.utc)
                await db.commit()
                return

            # Snapshot source items into memory so deleting the source dataset
            # mid-job doesn't crash us. SQLAlchemy detaches them when the
            # session closes; the worker only reads field values from here on.
            result = await db.execute(
                select(DatasetItem)
                .where(DatasetItem.dataset_id == job.source_dataset_id)
                .order_by(DatasetItem.created_at.asc())
            )
            source_items = list(result.scalars().all())
            for it in source_items:
                # Force-load attributes before the session closes; otherwise
                # accessing them later raises DetachedInstanceError.
                _ = (it.id, it.name, it.input_text, it.output_text,
                     it.instruction, it.system_message, it.tags,
                     it.source_test_case_id)

            target_dataset_id = job.target_dataset_id
            variation_prompt = job.variation_prompt

        # ── Plan: compute total expected variant count and per-parent budgets ──
        plan: list[tuple[DatasetItem, int]] = []
        total_planned = 0
        for item in source_items:
            tags = _parse_tags(item.tags)
            n = _variants_for(tags, multipliers)
            if n > 0:
                plan.append((item, n))
                total_planned += n

        async with async_session() as db:
            job = await db.get(SyntheticJob, job_id)
            if job:
                job.total_planned = total_planned
                await db.commit()

        if total_planned == 0:
            # Nothing to do — finalise as completed (vacuously successful).
            async with async_session() as db:
                job = await db.get(SyntheticJob, job_id)
                if job:
                    job.status = "completed"
                    job.completed_at = datetime.now(timezone.utc)
                    await db.commit()
            return

        # ── Provider setup once (not per item) ──
        api_key = decrypt_api_key(model_config.api_key_encrypted) if model_config.api_key_encrypted else None
        provider = get_provider(
            model_config.provider,
            api_key=api_key,
            base_url=model_config.base_url,
        )
        extra_params = dict(model_config.extra_params or {})
        if model_config.adapter_path:
            extra_params.setdefault("adapter_path", model_config.adapter_path)

        synthetic_model_tag = f"synthetic_model:{_short_model_name(model_config.provider, model_config.model_id)}"

        # ── Main loop: generate variants, cancel-aware ──
        completed = 0
        failed = 0
        for parent, n_variants in plan:
            if await _should_stop(job_id):
                logger.info("synthetic: job %s cancelled mid-flight", job_id)
                break

            parent_tags = _parse_tags(parent.tags)
            # Tags carried to every variant of this parent. Keep parent tags
            # (incl. bt:passed / bt:failed / bt_run:* — a synthetic-of-a-
            # failure is still semantically a failure variant) plus our
            # synthetic-provenance tokens.
            base_tag_list = list(parent_tags) + ["synthetic:unverified", synthetic_model_tag]
            new_tags = ",".join(base_tag_list)

            for variant_idx in range(1, n_variants + 1):
                if await _should_stop(job_id):
                    break

                prompt = _substitute_prompt(
                    variation_prompt,
                    parent.input_text or "",
                    parent.output_text or "",
                )
                messages = [{"role": "user", "content": prompt}]

                new_input: str | None = None
                error: str | None = None
                try:
                    response = await asyncio.wait_for(
                        provider.generate(
                            messages=messages,
                            model_id=model_config.model_id,
                            max_tokens=2048,
                            temperature=VARIANT_TEMPERATURE,
                            **extra_params,
                        ),
                        timeout=VARIANT_TIMEOUT_SECONDS,
                    )
                    new_input = (response.content or "").strip()
                    if not new_input:
                        error = "Empty LLM response"
                except asyncio.TimeoutError:
                    error = f"Timed out after {VARIANT_TIMEOUT_SECONDS}s"
                except Exception as e:
                    logger.exception("synthetic: variant gen failed for item %s", parent.id)
                    error = f"{type(e).__name__}: {str(e)[:200]}"

                if error or not new_input:
                    failed += 1
                    # Bump counters even on failure so progress moves forward.
                    async with async_session() as db:
                        job_row = await db.get(SyntheticJob, job_id)
                        if job_row:
                            job_row.failed_count = failed
                            await db.commit()
                    continue

                # Persist the variant. We use the parent's name (with a
                # `(synthetic vN)` suffix) so the SFT viewer header reads as
                # a natural variant of its source.
                parent_name = (parent.name or "item").strip()
                variant_name = f"{parent_name} (synthetic v{variant_idx})"

                async with async_session() as db:
                    new_item = DatasetItem(
                        dataset_id=target_dataset_id,
                        name=variant_name[:255],
                        instruction=parent.instruction,
                        input_text=new_input,
                        output_text=parent.output_text,  # unchanged — fixed target
                        system_message=parent.system_message,
                        tags=new_tags,
                        source_test_case_id=parent.source_test_case_id,
                        parent_item_id=parent.id,
                        verified_status="unverified",
                    )
                    db.add(new_item)
                    # Bump target dataset's item_count and job counters atomically.
                    target_ds = await db.get(Dataset, target_dataset_id)
                    if target_ds:
                        target_ds.item_count = (target_ds.item_count or 0) + 1
                    job_row = await db.get(SyntheticJob, job_id)
                    if job_row:
                        completed += 1
                        job_row.completed_count = completed
                    await db.commit()

        # ── Finalise: completed / cancelled / failed depending on end-state ──
        async with async_session() as db:
            job = await db.get(SyntheticJob, job_id)
            if not job:
                return
            if job.status == "cancelling":
                job.status = "cancelled"
            elif job.status == "running":
                job.status = "completed"
            # else: row already in a terminal state — don't overwrite.
            job.completed_at = datetime.now(timezone.utc)
            await db.commit()

    except Exception as e:
        # Top-level safety net: never leave the row in `running` if the worker
        # crashed. Mark `failed` with a short error message so the UI shows it.
        logger.exception("synthetic: top-level failure for job %s", job_id)
        try:
            async with async_session() as db:
                job = await db.get(SyntheticJob, job_id)
                if job and job.status in ("running", "pending", "cancelling"):
                    job.status = "failed"
                    job.error_message = f"{type(e).__name__}: {str(e)[:300]}"
                    job.completed_at = datetime.now(timezone.utc)
                    await db.commit()
        except Exception:
            logger.exception("synthetic: failed to record top-level failure for job %s", job_id)


def plan_total_planned(items: list[dict], multipliers: dict[str, int]) -> int:
    """Pure-Python helper exposed for unit testing & the POST validator.

    Given a list of items each with a `tags` (comma-separated) field, return
    the total variant count we'd plan against `multipliers`. Lets the router
    fail fast on "0 variants planned" before bothering to kick off a task.
    """
    total = 0
    for it in items:
        tag_list = _parse_tags(it.get("tags"))
        total += _variants_for(tag_list, multipliers)
    return total
