"""Feedback / RLHF service for collecting human preferences."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.model_config import ModelConfig
from app.models.post_training import FeedbackItem, FeedbackRun
from app.models.prompt import PromptVersion
from app.providers.registry import get_provider
from app.schemas.post_training import FeedbackSubmit
from app.services.model_config_service import decrypt_api_key

logger = logging.getLogger(__name__)

DEFAULT_MAX_TOKENS = 4096


async def generate_outputs_for_run(db: AsyncSession, run_id: str) -> int:
    """Generate model outputs for all pending FeedbackItems in a run.

    Returns the number of items processed.
    """
    run = await db.get(FeedbackRun, run_id)
    if not run:
        raise ValueError(f"Feedback run {run_id} not found")

    if not run.model_config_id:
        raise ValueError("Feedback run has no model config assigned")
    if not run.prompt_version_id:
        raise ValueError("Feedback run has no prompt version assigned")

    model_config = await db.get(ModelConfig, run.model_config_id)
    prompt_version = await db.get(PromptVersion, run.prompt_version_id)

    if not model_config:
        raise ValueError("Model config not found")
    if not prompt_version:
        raise ValueError("Prompt version not found")

    result = await db.execute(
        select(FeedbackItem).where(
            FeedbackItem.run_id == run_id,
            FeedbackItem.generation_status == "pending",
        )
    )
    pending_items = list(result.scalars().all())

    if not pending_items:
        return 0

    api_key = decrypt_api_key(model_config.api_key_encrypted) if model_config.api_key_encrypted else None
    provider = get_provider(model_config.provider, api_key=api_key, base_url=model_config.base_url)

    processed = 0
    for item in pending_items:
        messages = []
        if prompt_version.system_message:
            messages.append({"role": "system", "content": prompt_version.system_message})

        user_content = prompt_version.content
        if item.input_text:
            user_content += f"\n\n--- User Input ---\n{item.input_text}"
        messages.append({"role": "user", "content": user_content})

        try:
            response = await provider.generate(
                messages=messages,
                model_id=model_config.model_id,
                max_tokens=DEFAULT_MAX_TOKENS,
                temperature=model_config.temperature,
                **(model_config.extra_params or {}),
            )
            item.model_output = response.content
            item.generation_status = "generated"
        except Exception as e:
            logger.exception("Failed to generate output for item %s: %s", item.id, e)
            item.generation_status = "failed"

        processed += 1

    # Update run status and counts
    run.status = "collecting"
    await db.flush()

    return processed


async def submit_feedback(db: AsyncSession, item_id: str, data: FeedbackSubmit) -> FeedbackItem:
    """Submit a human review for a FeedbackItem."""
    item = await db.get(FeedbackItem, item_id)
    if not item:
        raise ValueError(f"Feedback item {item_id} not found")

    if data.rating is not None:
        item.rating = data.rating
    if data.thumbs is not None:
        item.thumbs = data.thumbs
    if data.preferred_answer is not None:
        item.preferred_answer = data.preferred_answer
    if data.corrected_output is not None:
        item.corrected_output = data.corrected_output
    if data.reviewer_comment is not None:
        item.reviewer_comment = data.reviewer_comment
    if data.error_tags is not None:
        item.error_tags = data.error_tags

    item.review_status = data.review_status
    item.reviewed_at = datetime.now(timezone.utc)
    await db.flush()

    # Update reviewed_count on parent run
    run = await db.get(FeedbackRun, item.run_id)
    if run:
        result = await db.execute(
            select(FeedbackItem).where(
                FeedbackItem.run_id == item.run_id,
                FeedbackItem.review_status.in_(["reviewed", "skipped"]),
            )
        )
        run.reviewed_count = len(list(result.scalars().all()))
        await db.flush()

    return item


async def build_dpo_dataset_from_run(db: AsyncSession, run_id: str, dataset_name: str) -> "Dataset":
    """Create a Dataset of DPO-format items from a reviewed Feedback run.

    The dataset is marked with format="dpo".  Each DatasetItem stores:
      - system_message = prompt
      - output_text    = chosen (preferred response)
      - input_text     = rejected (original model output)

    This layout lets the DpoBackend.start() consume the items directly.
    """
    from app.models.post_training import Dataset, DatasetItem

    run = await db.get(FeedbackRun, run_id)
    if not run:
        raise ValueError(f"Feedback run {run_id} not found")

    result = await db.execute(
        select(FeedbackItem).where(
            FeedbackItem.run_id == run_id,
            FeedbackItem.review_status == "reviewed",
        )
    )
    items = list(result.scalars().all())

    # Build preference pairs: keep only items where we have a distinct chosen vs rejected
    pairs = []
    for it in items:
        chosen = (it.corrected_output or it.preferred_answer or "").strip()
        rejected = (it.model_output or "").strip()
        if not chosen or not rejected or chosen == rejected:
            continue
        pairs.append((it.input_text, chosen, rejected))

    if not pairs:
        raise ValueError(
            "No usable preference pairs: items need reviewer-provided "
            "corrected_output / preferred_answer distinct from model_output."
        )

    ds = Dataset(
        project_id=run.project_id,
        name=dataset_name,
        description=f"DPO preference pairs exported from feedback run {run.name}",
        format="dpo",
        item_count=len(pairs),
    )
    db.add(ds)
    await db.flush()

    for prompt, chosen, rejected in pairs:
        ditem = DatasetItem(
            dataset_id=ds.id,
            system_message=prompt,  # DpoBackend reads prompt from system_message
            output_text=chosen,      # chosen
            input_text=rejected,     # rejected
        )
        db.add(ditem)
    await db.flush()
    return ds


async def export_run_as_jsonl(db: AsyncSession, run_id: str) -> str:
    """Export all reviewed FeedbackItems as JSONL for DPO/TRL training.

    Each line is a JSON object with prompt, chosen, and rejected fields
    (in DPO format) or instruction/output pairs (SFT format).
    """
    run = await db.get(FeedbackRun, run_id)
    if not run:
        raise ValueError(f"Feedback run {run_id} not found")

    result = await db.execute(
        select(FeedbackItem).where(
            FeedbackItem.run_id == run_id,
            FeedbackItem.review_status == "reviewed",
        )
    )
    items = list(result.scalars().all())

    lines: list[str] = []
    for item in items:
        # Determine the preferred (chosen) output
        chosen = item.corrected_output or item.preferred_answer or item.model_output or ""
        # Build record
        record: dict = {
            "prompt": item.input_text,
            "chosen": chosen,
            "rejected": item.model_output or "",
        }
        if item.rating is not None:
            record["rating"] = item.rating
        if item.thumbs:
            record["thumbs"] = item.thumbs
        if item.error_tags:
            record["error_tags"] = item.error_tags.split(",")
        if item.reviewer_comment:
            record["reviewer_comment"] = item.reviewer_comment

        lines.append(json.dumps(record, ensure_ascii=False))

    return "\n".join(lines)
