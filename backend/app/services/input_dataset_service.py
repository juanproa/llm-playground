"""Background helpers for InputDataset PDF ingestion.

Mirrors the KB flow minus the embedding step: save bytes to disk inline,
return a pending item immediately, parse (docling + OCR) in a background task
that opens its own DB session.
"""
from __future__ import annotations

import asyncio
import logging

from app.database import async_session
from app.models.input_dataset import InputDatasetItem
from app.services.pdf_parser import parse_pdf

logger = logging.getLogger(__name__)


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
