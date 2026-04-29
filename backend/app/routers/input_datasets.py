"""Input Datasets router — global prompt-input libraries for the Workspace.

Distinct from post-training datasets (which are project-scoped SFT data).
These exist only to let the user "pick an item, paste it into the Input box."
"""
from __future__ import annotations

import csv
import io
import logging
import os
import uuid
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.dependencies import get_db
from app.models.input_dataset import InputDataset, InputDatasetItem
from app.models.knowledge_base import KnowledgeBase, KnowledgeBaseItem
from app.schemas.input_dataset import (
    CopyFromKbRequest,
    InputDatasetCreate,
    InputDatasetItemCreate,
    InputDatasetItemResponse,
    InputDatasetItemUpdate,
    InputDatasetResponse,
    InputDatasetUpdate,
    InputDatasetWithItemsResponse,
)
from app.services import input_dataset_service

logger = logging.getLogger(__name__)


def _save_upload_to_disk(raw_bytes: bytes, filename: str) -> str:
    """Write raw bytes into UPLOADS_DIR and return the persisted path."""
    os.makedirs(settings.UPLOADS_DIR, exist_ok=True)
    file_id = str(uuid.uuid4())
    ext = os.path.splitext(filename)[1] or ".pdf"
    save_path = os.path.join(settings.UPLOADS_DIR, f"ds_{file_id}{ext}")
    with open(save_path, "wb") as f:
        f.write(raw_bytes)
    return save_path


router = APIRouter(prefix="/input-datasets", tags=["input-datasets"])


# ─── CRUD ────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[InputDatasetResponse])
async def list_datasets(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(InputDataset).order_by(InputDataset.created_at.desc()))
    return list(result.scalars().all())


@router.post("", response_model=InputDatasetResponse, status_code=201)
async def create_dataset(data: InputDatasetCreate, db: AsyncSession = Depends(get_db)):
    ds = InputDataset(name=data.name, description=data.description)
    db.add(ds)
    await db.flush()
    return ds


@router.get("/pii-filter-status")
async def pii_filter_status():
    """Return download/load status of the local PII filter model."""
    from app.services.pii_filter_service import get_status
    return get_status()


@router.post("/pii-filter-preload", response_model=dict)
async def pii_filter_preload():
    """Trigger background download + load of the PII filter model."""
    from app.services.pii_filter_service import preload_async
    return preload_async()


@router.get("/{dataset_id}", response_model=InputDatasetWithItemsResponse)
async def get_dataset(dataset_id: str, db: AsyncSession = Depends(get_db)):
    ds = await db.get(InputDataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    result = await db.execute(
        select(InputDatasetItem)
        .where(InputDatasetItem.dataset_id == dataset_id)
        .order_by(InputDatasetItem.created_at.asc())
    )
    items = list(result.scalars().all())
    return InputDatasetWithItemsResponse(
        **InputDatasetResponse.model_validate(ds).model_dump(),
        items=[InputDatasetItemResponse.model_validate(i) for i in items],
    )


@router.put("/{dataset_id}", response_model=InputDatasetResponse)
async def update_dataset(dataset_id: str, data: InputDatasetUpdate, db: AsyncSession = Depends(get_db)):
    ds = await db.get(InputDataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    for f, v in data.model_dump(exclude_none=True).items():
        setattr(ds, f, v)
    await db.flush()
    return ds


@router.delete("/{dataset_id}", status_code=204)
async def delete_dataset(dataset_id: str, db: AsyncSession = Depends(get_db)):
    ds = await db.get(InputDataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    await db.execute(delete(InputDatasetItem).where(InputDatasetItem.dataset_id == dataset_id))
    await db.delete(ds)
    await db.flush()


# ─── Items ───────────────────────────────────────────────────────────────────

@router.get("/{dataset_id}/items", response_model=list[InputDatasetItemResponse])
async def list_items(dataset_id: str, db: AsyncSession = Depends(get_db)):
    ds = await db.get(InputDataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    result = await db.execute(
        select(InputDatasetItem)
        .where(InputDatasetItem.dataset_id == dataset_id)
        .order_by(InputDatasetItem.created_at.asc())
    )
    return list(result.scalars().all())


@router.post("/{dataset_id}/items", response_model=InputDatasetItemResponse, status_code=201)
async def create_item(
    dataset_id: str,
    data: InputDatasetItemCreate,
    db: AsyncSession = Depends(get_db),
):
    ds = await db.get(InputDataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    item = InputDatasetItem(
        dataset_id=dataset_id,
        name=data.name,
        content=data.content,
        tags=data.tags,
        metadata_json=data.metadata_json,
        source_type="text",
    )
    db.add(item)
    ds.item_count = ds.item_count + 1
    await db.flush()
    return item


@router.put("/{dataset_id}/items/{item_id}", response_model=InputDatasetItemResponse)
async def update_item(
    dataset_id: str,
    item_id: str,
    data: InputDatasetItemUpdate,
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(InputDatasetItem, item_id)
    if not item or item.dataset_id != dataset_id:
        raise HTTPException(status_code=404, detail="Item not found")
    for f, v in data.model_dump(exclude_none=True).items():
        setattr(item, f, v)
    await db.flush()
    return item


@router.delete("/{dataset_id}/items/{item_id}", status_code=204)
async def delete_item(dataset_id: str, item_id: str, db: AsyncSession = Depends(get_db)):
    item = await db.get(InputDatasetItem, item_id)
    if not item or item.dataset_id != dataset_id:
        raise HTTPException(status_code=404, detail="Item not found")
    ds = await db.get(InputDataset, dataset_id)
    await db.delete(item)
    if ds:
        ds.item_count = max(0, ds.item_count - 1)
    await db.flush()


# ─── PDF upload ──────────────────────────────────────────────────────────────

@router.post("/{dataset_id}/items/upload-pdf", response_model=InputDatasetItemResponse, status_code=201)
async def upload_pdf(
    dataset_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    tags: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """Save a single PDF as a dataset item. Parsing runs in the background."""
    ds = await db.get(InputDataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    raw = await file.read()
    save_path = _save_upload_to_disk(raw, file.filename)

    item = InputDatasetItem(
        dataset_id=dataset_id,
        name=(name or file.filename),
        content="",
        tags=tags,
        source_type="pdf",
        source_filename=file.filename,
        file_path=save_path,
        mime_type=file.content_type or "application/pdf",
        file_size_bytes=len(raw),
        parse_status="pending",
    )
    db.add(item)
    ds.item_count = ds.item_count + 1
    await db.commit()
    await db.refresh(item)
    background_tasks.add_task(input_dataset_service.parse_pdf_for_item, item.id, save_path)
    return item


@router.post("/{dataset_id}/items/upload-pdfs", response_model=list[InputDatasetItemResponse], status_code=201)
async def upload_pdfs(
    dataset_id: str,
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Save multiple PDFs as dataset items. Each parses in the background."""
    ds = await db.get(InputDataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    created: list[tuple[InputDatasetItem, str]] = []
    for f in files:
        if not f.filename or not f.filename.lower().endswith(".pdf"):
            continue
        raw = await f.read()
        save_path = _save_upload_to_disk(raw, f.filename)
        item = InputDatasetItem(
            dataset_id=dataset_id,
            name=f.filename,
            content="",
            source_type="pdf",
            source_filename=f.filename,
            file_path=save_path,
            mime_type=f.content_type or "application/pdf",
            file_size_bytes=len(raw),
            parse_status="pending",
        )
        db.add(item)
        created.append((item, save_path))

    ds.item_count = ds.item_count + len(created)
    await db.commit()
    result: list[InputDatasetItem] = []
    for item, save_path in created:
        await db.refresh(item)
        result.append(item)
        background_tasks.add_task(input_dataset_service.parse_pdf_for_item, item.id, save_path)
    return result


@router.post("/retry-pending", response_model=dict, status_code=200)
async def retry_pending_pdfs(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Retry all pending PDF parses. Useful if parsing was interrupted (e.g., hibernation)."""
    result = await db.execute(
        select(InputDatasetItem)
        .where(InputDatasetItem.parse_status == "pending")
        .where(InputDatasetItem.source_type == "pdf")
    )
    pending_items = list(result.scalars().all())

    # For items without file_path (old uploads), search uploads dir for matching PDFs
    os.makedirs(settings.UPLOADS_DIR, exist_ok=True)
    available_files = {f for f in os.listdir(settings.UPLOADS_DIR) if f.endswith('.pdf')}

    retried = []
    for item in pending_items:
        file_path = item.file_path

        # If file_path is missing, try to find the file in uploads by looking for files with matching source_filename
        if not file_path:
            if item.source_filename:
                # Try exact match first, then prefix match
                matching = [f for f in available_files if item.source_filename in f or f.endswith(item.source_filename.split('.')[-1])]
                if matching:
                    file_path = os.path.join(settings.UPLOADS_DIR, matching[0])

        if file_path and os.path.exists(file_path):
            background_tasks.add_task(input_dataset_service.parse_pdf_for_item, item.id, file_path)
            retried.append(item)
        elif not file_path:
            logger.warning(f"Cannot find file for pending item {item.id} ({item.source_filename})")

    return {
        "retried_count": len(retried),
        "items": [InputDatasetItemResponse.model_validate(item) for item in retried],
    }


@router.post("/{dataset_id}/evaluate-quality", response_model=dict, status_code=202)
async def evaluate_quality(
    dataset_id: str,
    background_tasks: BackgroundTasks,
    model_config_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Kick off LLM-based quality evaluation for all ready items in this dataset."""
    ds = await db.get(InputDataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    if ds.eval_status == "running":
        raise HTTPException(status_code=409, detail="Evaluation already running for this dataset")

    pending = await db.execute(
        select(InputDatasetItem)
        .where(InputDatasetItem.dataset_id == dataset_id)
        .where(InputDatasetItem.parse_status == "pending")
    )
    if pending.scalars().first() is not None:
        raise HTTPException(status_code=409, detail="Wait for all PDFs to finish parsing before evaluating")

    ready = await db.execute(
        select(InputDatasetItem)
        .where(InputDatasetItem.dataset_id == dataset_id)
        .where(InputDatasetItem.parse_status == "ready")
    )
    ready_items = list(ready.scalars().all())
    ready_count = len(ready_items)

    if ready_count == 0:
        return {"queued_count": 0, "message": "No ready items to evaluate"}

    # Reset every ready item so progress counts from 0/N and re-runs use the
    # latest prompt/model. Click = always re-evaluate everything.
    for item in ready_items:
        item.quality_status = "unchecked"
        item.quality_reason = None
    ds.eval_status = "running"
    await db.commit()

    background_tasks.add_task(input_dataset_service.evaluate_quality_for_dataset, dataset_id, model_config_id)
    return {"queued_count": ready_count, "message": f"Quality evaluation queued for {ready_count} items"}


@router.post("/{dataset_id}/mask-pii", response_model=dict, status_code=202)
async def mask_pii(
    dataset_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Kick off PII detection and masking for all ready items using the local privacy-filter model."""
    from app.services.pii_filter_service import is_loaded

    ds = await db.get(InputDataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    if not is_loaded():
        raise HTTPException(status_code=409, detail="PII filter model is not loaded. Preload it first.")

    if ds.mask_status == "running":
        raise HTTPException(status_code=409, detail="PII masking already running for this dataset")

    pending = await db.execute(
        select(InputDatasetItem)
        .where(InputDatasetItem.dataset_id == dataset_id)
        .where(InputDatasetItem.parse_status == "pending")
    )
    if pending.scalars().first() is not None:
        raise HTTPException(status_code=409, detail="Wait for all PDFs to finish parsing before masking PII")

    ready = await db.execute(
        select(InputDatasetItem)
        .where(InputDatasetItem.dataset_id == dataset_id)
        .where(InputDatasetItem.parse_status == "ready")
    )
    ready_items = list(ready.scalars().all())
    ready_count = len(ready_items)

    if ready_count == 0:
        return {"queued_count": 0, "message": "No ready items to process"}

    for item in ready_items:
        item.pii_status = "unchecked"
        item.pii_masked_content = None
    ds.mask_status = "running"
    await db.commit()

    background_tasks.add_task(input_dataset_service.mask_pii_for_dataset, dataset_id)
    return {"queued_count": ready_count, "message": f"PII masking queued for {ready_count} items"}


# ─── CSV upload ──────────────────────────────────────────────────────────────

@router.post("/{dataset_id}/upload-csv", response_model=list[InputDatasetItemResponse], status_code=201)
async def upload_csv(
    dataset_id: str,
    file: UploadFile = File(...),
    content_column: Optional[str] = Form(None),
    name_column: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """Ingest CSV rows as items. Same column-hint rules as the KB CSV upload."""
    ds = await db.get(InputDataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    raw = await file.read()
    text = raw.decode("utf-8", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    fieldnames = reader.fieldnames or []
    lower = [f.lower() for f in fieldnames]

    content_col = None
    if content_column:
        content_col = next((f for f in fieldnames if f.lower() == content_column.lower()), None)
    if not content_col:
        for candidate in ("content", "text", "input", "input_text", "prompt"):
            if candidate in lower:
                content_col = fieldnames[lower.index(candidate)]
                break
    if not content_col and fieldnames:
        content_col = fieldnames[0]

    name_col = None
    if name_column:
        name_col = next((f for f in fieldnames if f.lower() == name_column.lower()), None)
    if not name_col and "name" in lower:
        name_col = fieldnames[lower.index("name")]

    tags_col = fieldnames[lower.index("tags")] if "tags" in lower else None

    import json as _json
    created: list[InputDatasetItem] = []
    for i, row in enumerate(reader, start=1):
        content = (row.get(content_col) or "").strip() if content_col else ""
        if not content:
            continue
        name = (row.get(name_col) or "").strip() if name_col else ""
        tags = (row.get(tags_col) or "").strip() if tags_col else None
        meta = {
            k: v for k, v in row.items()
            if k and k != content_col and k != name_col and k != tags_col and v not in (None, "")
        }
        item = InputDatasetItem(
            dataset_id=dataset_id,
            name=name or None,
            content=content,
            tags=tags,
            metadata_json=_json.dumps(meta) if meta else None,
            source_type="csv_row",
            source_filename=file.filename,
            mime_type="text/csv",
            file_size_bytes=len(raw),
        )
        db.add(item)
        created.append(item)

    ds.item_count = ds.item_count + len(created)
    await db.flush()
    return created


# ─── Copy from KB ────────────────────────────────────────────────────────────

@router.post("/copy-from-kb/{kb_id}", response_model=InputDatasetWithItemsResponse, status_code=201)
async def copy_from_kb(
    kb_id: str,
    data: CopyFromKbRequest | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Create a new InputDataset mirroring every item of a KB.

    Useful for KBs that were originally being used as a "library of inputs"
    before the dedicated Datasets concept existed.
    """
    kb = await db.get(KnowledgeBase, kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")

    req = data or CopyFromKbRequest()
    ds = InputDataset(
        name=req.dataset_name or f"{kb.name} (copy)",
        description=req.dataset_description or f"Copied from KB '{kb.name}'",
    )
    db.add(ds)
    await db.flush()

    result = await db.execute(
        select(KnowledgeBaseItem)
        .where(KnowledgeBaseItem.kb_id == kb_id)
        .order_by(KnowledgeBaseItem.created_at.asc())
    )
    items = list(result.scalars().all())
    new_items: list[InputDatasetItem] = []
    for kb_item in items:
        if not (kb_item.content or "").strip():
            continue
        new_items.append(InputDatasetItem(
            dataset_id=ds.id,
            name=kb_item.name,
            content=kb_item.content,
            metadata_json=kb_item.metadata_json,
            source_type=kb_item.source_type or "text",
            source_filename=kb_item.source_filename,
            mime_type=kb_item.mime_type,
            file_size_bytes=kb_item.file_size_bytes,
        ))
    db.add_all(new_items)
    ds.item_count = len(new_items)
    await db.flush()

    return InputDatasetWithItemsResponse(
        **InputDatasetResponse.model_validate(ds).model_dump(),
        items=[InputDatasetItemResponse.model_validate(i) for i in new_items],
    )
