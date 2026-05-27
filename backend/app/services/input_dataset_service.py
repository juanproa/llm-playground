"""Background helpers for InputDataset PDF ingestion.

Mirrors the KB flow minus the embedding step: save bytes to disk inline,
return a pending item immediately, parse (docling + OCR) in a background task
that opens its own DB session.
"""
from __future__ import annotations

import asyncio
import json
import logging

from app.database import async_session
from app.models.input_dataset import InputDatasetItem
from app.models.model_config import ModelConfig
from app.providers.registry import get_provider
from app.services.model_config_service import decrypt_api_key
from app.services.pdf_parser import parse_pdf

logger = logging.getLogger(__name__)


QUALITY_SYSTEM_PROMPT = """You are a text-quality classifier for OCR'd PDFs. Decide if the text is usable for downstream LLM inference.

Respond with a JSON object only, no other text. Schema:
{"quality": "good" | "bad" | "trash", "reason": "<short explanation, max 120 chars>"}

Three tiers:
- "good"  = clean, coherent prose, forms, or structured data — fully usable
- "bad"   = readable but degraded (typos, OCR artifacts, partial pages, missing words). Still usable for some inference, just lower quality.
- "trash" = unintelligible — mostly random characters, broken fragments, repeating junk, or empty. NOT usable.

Empty or near-empty content is "trash".
"""


async def _should_stop_eval(dataset_id: str) -> bool:
    """Return True when the worker should bail out of the item loop.

    The worker only continues while the dataset's ``eval_status`` is still
    ``"running"`` — the value it was set to when this task was dispatched.
    Any other value means someone else changed it:

    - ``"cancelling"`` — user clicked Cancel (cooperative)
    - ``"idle"`` — user clicked Force Reset, or the dataset was just cleaned
    - dataset gone — the dataset itself was deleted

    Treating all three as "stop" makes Force Reset actually stop the worker
    (otherwise it'd lie to the UI while the worker kept burning model quota).
    """
    from app.models.input_dataset import InputDataset
    async with async_session() as db:
        ds = await db.get(InputDataset, dataset_id)
        return not ds or ds.eval_status != "running"


# Per-item ceiling on the LLM call. If the chosen model is unreachable or
# hangs (the failure mode the user hit), we abandon that item with an error
# instead of locking the whole dataset forever.
EVAL_ITEM_TIMEOUT_SECONDS = 90


async def evaluate_quality_for_dataset(dataset_id: str, model_config_id: str) -> None:
    """Loop ready items in the dataset and ask the LLM to classify text quality.

    Cooperative cancel: between items, the loop re-reads `eval_status`. If it
    flipped to ``"cancelling"`` (via the cancel route), we break early and
    leave any remaining items as ``"unchecked"`` so the user can re-run later.

    Per-item timeout: ``provider.generate()`` is wrapped in ``asyncio.wait_for``
    so a single hung model call can't block the rest of the dataset.

    The ``finally`` block always restores ``eval_status`` to ``"idle"`` —
    whether we exit normally, via cancel, via timeout, or on error.
    """
    from app.models.input_dataset import InputDataset
    from sqlalchemy import select

    try:
        async with async_session() as db:
            model_config = await db.get(ModelConfig, model_config_id)
            if not model_config:
                logger.warning("evaluate_quality: model %s not found", model_config_id)
                return

            result = await db.execute(
                select(InputDatasetItem)
                .where(InputDatasetItem.dataset_id == dataset_id)
                .where(InputDatasetItem.parse_status == "ready")
                .where(InputDatasetItem.quality_status == "unchecked")
            )
            items = list(result.scalars().all())

        if not items:
            return

        api_key = decrypt_api_key(model_config.api_key_encrypted) if model_config.api_key_encrypted else None
        provider = get_provider(model_config.provider, api_key=api_key, base_url=model_config.base_url)
        extra_params = dict(model_config.extra_params or {})
        if model_config.adapter_path:
            extra_params.setdefault("adapter_path", model_config.adapter_path)

        for item in items:
            # Cooperative cancel: bail out between items if the user clicked
            # "Cancel" or "Force Reset" since the last iteration. Items
            # already classified keep their result; remaining items stay
            # "unchecked".
            if await _should_stop_eval(dataset_id):
                logger.info(
                    "evaluate_quality: stop signal for dataset %s — exiting loop",
                    dataset_id,
                )
                break

            content = (item.content or "").strip()
            if not content:
                quality = "trash"
                reason = "Empty content"
            else:
                preview = content[:4000]
                messages = [
                    {"role": "system", "content": QUALITY_SYSTEM_PROMPT},
                    {"role": "user", "content": f"Text to classify:\n\n{preview}"},
                ]
                try:
                    response = await asyncio.wait_for(
                        provider.generate(
                            messages=messages,
                            model_id=model_config.model_id,
                            max_tokens=200,
                            temperature=0.0,
                            **extra_params,
                        ),
                        timeout=EVAL_ITEM_TIMEOUT_SECONDS,
                    )
                    raw = (response.content or "").strip()
                    start = raw.find("{")
                    end = raw.rfind("}")
                    if start != -1 and end > start:
                        parsed = json.loads(raw[start : end + 1])
                        quality = parsed.get("quality", "unchecked")
                        reason = (parsed.get("reason") or "")[:500]
                        if quality not in ("good", "bad", "trash"):
                            quality = "unchecked"
                            reason = f"Invalid response: {raw[:200]}"
                    else:
                        quality = "unchecked"
                        reason = f"No JSON found in response: {raw[:200]}"
                except asyncio.TimeoutError:
                    logger.warning(
                        "Quality evaluation timed out for item %s after %ds",
                        item.id, EVAL_ITEM_TIMEOUT_SECONDS,
                    )
                    quality = "unchecked"
                    reason = f"Eval timed out after {EVAL_ITEM_TIMEOUT_SECONDS}s — model may be unreachable"
                except Exception as e:
                    logger.exception("Quality evaluation failed for item %s", item.id)
                    quality = "unchecked"
                    reason = f"Eval error: {str(e)[:300]}"

            async with async_session() as db:
                db_item = await db.get(InputDatasetItem, item.id)
                if db_item:
                    db_item.quality_status = quality
                    db_item.quality_reason = reason
                    await db.commit()
    finally:
        # Always clear the running flag, even on error / cancel / timeout.
        async with async_session() as db:
            ds = await db.get(InputDataset, dataset_id)
            if ds:
                ds.eval_status = "idle"
                await db.commit()


async def mask_pii_for_dataset(dataset_id: str) -> None:
    """Run PII detection on every ready item using the local privacy-filter model."""
    from app.models.input_dataset import InputDataset
    from app.services import pii_filter_service
    from sqlalchemy import select

    try:
        async with async_session() as db:
            result = await db.execute(
                select(InputDatasetItem)
                .where(InputDatasetItem.dataset_id == dataset_id)
                .where(InputDatasetItem.parse_status == "ready")
                .where(InputDatasetItem.pii_status == "unchecked")
            )
            items = list(result.scalars().all())

        if not items:
            return

        for item in items:
            content = (item.content or "").strip()
            if not content:
                pii_status = "clean"
                pii_masked_content = None
            else:
                try:
                    result = await pii_filter_service.run_in_mlx_thread(pii_filter_service.detect_and_mask, content)
                    if result["has_pii"]:
                        pii_status = "masked"
                        pii_masked_content = result["masked_content"]
                    else:
                        pii_status = "clean"
                        pii_masked_content = None
                except Exception as e:
                    logger.exception("PII masking failed for item %s", item.id)
                    pii_status = "unchecked"
                    pii_masked_content = None

            async with async_session() as db:
                db_item = await db.get(InputDatasetItem, item.id)
                if db_item:
                    db_item.pii_status = pii_status
                    db_item.pii_masked_content = pii_masked_content
                    await db.commit()
    finally:
        async with async_session() as db:
            ds = await db.get(InputDataset, dataset_id)
            if ds:
                ds.mask_status = "idle"
                await db.commit()


async def parse_pdf_for_item(item_id: str, save_path: str) -> None:
    """Run docling/OCR on `save_path`, persist text on the item row."""
    text = ""
    parse_error: str | None = None
    try:
        text = await asyncio.to_thread(parse_pdf, save_path)
    except Exception as e:
        parse_error = str(e)[:2000]
        logger.exception("Dataset PDF parse failed for item %s", item_id)

    async with async_session() as db:
        item = await db.get(InputDatasetItem, item_id)
        if not item:
            logger.warning("parse_pdf_for_item: item %s vanished", item_id)
            return
        if parse_error is not None:
            item.parse_status = "failed"
            item.parse_error = parse_error
        else:
            item.content = text
            item.parse_status = "ready"
            item.parse_error = None
        await db.commit()
