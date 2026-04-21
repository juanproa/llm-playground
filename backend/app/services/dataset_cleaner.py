"""Dataset cleaning utilities: deduplication and format normalization.

Operates on DatasetItem rows in-place for a given dataset.
"""
from __future__ import annotations

import hashlib
import logging
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.post_training import Dataset, DatasetItem

logger = logging.getLogger(__name__)


_WHITESPACE_RE = re.compile(r"[ \t]+")
_NEWLINES_RE = re.compile(r"\n{3,}")
_ZERO_WIDTH_RE = re.compile(r"[\u200b-\u200f\ufeff]")
_HTML_RE = re.compile(r"<(script|style)[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
_HTML_TAG_RE = re.compile(r"<[^>]+>")


def _normalize_text(text: str | None, *, strip_html: bool = False) -> str:
    if not text:
        return text or ""
    t = text
    # Remove zero-width chars
    t = _ZERO_WIDTH_RE.sub("", t)
    if strip_html:
        t = _HTML_RE.sub("", t)
        t = _HTML_TAG_RE.sub("", t)
    # Collapse runs of spaces/tabs
    t = _WHITESPACE_RE.sub(" ", t)
    # Collapse 3+ newlines to 2
    t = _NEWLINES_RE.sub("\n\n", t)
    # Trim trailing whitespace on each line
    t = "\n".join(line.rstrip() for line in t.split("\n"))
    return t.strip()


def _item_hash(item: DatasetItem) -> str:
    """Content-based hash used for exact-duplicate detection.

    Combines instruction + input + output + system. Two items with identical
    values on all four fields are considered duplicates.
    """
    h = hashlib.sha256()
    for part in (item.instruction, item.input_text, item.output_text, item.system_message):
        h.update((part or "").encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()


async def clean_dataset(
    db: AsyncSession,
    dataset_id: str,
    *,
    dedup: bool = True,
    normalize: bool = True,
    strip_html: bool = False,
) -> dict:
    """Clean all items in a dataset in place.

    Returns a report dict: {duplicates_removed, normalized_count, final_count}.
    """
    dataset = await db.get(Dataset, dataset_id)
    if not dataset:
        raise ValueError(f"Dataset {dataset_id} not found")

    result = await db.execute(
        select(DatasetItem)
        .where(DatasetItem.dataset_id == dataset_id)
        .order_by(DatasetItem.created_at.asc())
    )
    items = list(result.scalars().all())
    initial = len(items)

    normalized_count = 0
    if normalize:
        for it in items:
            before = (it.instruction, it.input_text, it.output_text, it.system_message)
            it.instruction = _normalize_text(it.instruction, strip_html=strip_html) or None
            it.input_text = _normalize_text(it.input_text, strip_html=strip_html) or None
            it.output_text = _normalize_text(it.output_text, strip_html=strip_html) or ""
            it.system_message = _normalize_text(it.system_message, strip_html=strip_html) or None
            after = (it.instruction, it.input_text, it.output_text, it.system_message)
            if before != after:
                normalized_count += 1

    removed = 0
    if dedup:
        seen: dict[str, DatasetItem] = {}
        to_remove: list[DatasetItem] = []
        for it in items:
            h = _item_hash(it)
            if h in seen:
                to_remove.append(it)
            else:
                seen[h] = it
        for it in to_remove:
            await db.delete(it)
            removed += 1

    final_count = initial - removed
    dataset.item_count = final_count
    await db.flush()

    logger.info(
        "Cleaned dataset %s: %d items → %d (removed %d dupes, normalized %d)",
        dataset_id, initial, final_count, removed, normalized_count,
    )
    return {
        "initial_count": initial,
        "duplicates_removed": removed,
        "normalized_count": normalized_count,
        "final_count": final_count,
    }
