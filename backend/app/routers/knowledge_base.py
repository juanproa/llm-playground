"""Knowledge Base routes: CRUD for bases + items (text / PDF / batch PDF / CSV)."""
from __future__ import annotations

import asyncio
import csv
import io
import os
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.dependencies import get_db
from app.models.knowledge_base import KnowledgeBase, KnowledgeBaseItem
from app.schemas.knowledge_base import (
    KnowledgeBaseCreate,
    KnowledgeBaseItemCreate,
    KnowledgeBaseItemResponse,
    KnowledgeBaseItemUpdate,
    KnowledgeBaseResponse,
    KnowledgeBaseUpdate,
    KnowledgeBaseWithItemsResponse,
)
from app.services.pdf_parser import parse_pdf


async def _extract_pdf_text(raw_bytes: bytes, filename: str) -> str:
    """Persist bytes to UPLOADS_DIR then run parse_pdf on the saved path.

    parse_pdf expects a filesystem path (Docling + Tesseract both want a path),
    so we must write the bytes to disk first.
    """
    os.makedirs(settings.UPLOADS_DIR, exist_ok=True)
    file_id = str(uuid.uuid4())
    ext = os.path.splitext(filename)[1] or ".pdf"
    save_path = os.path.join(settings.UPLOADS_DIR, f"kb_{file_id}{ext}")
    with open(save_path, "wb") as f:
        f.write(raw_bytes)
    try:
        return await asyncio.to_thread(parse_pdf, save_path)
    finally:
        # Keep uploaded file so KB items retain their source — comment out
        # the unlink if you prefer to clean up after parsing.
        pass

router = APIRouter(prefix="/knowledge-bases", tags=["knowledge-base"])


# ─── Knowledge Base CRUD ─────────────────────────────────────────────────────

@router.get("", response_model=list[KnowledgeBaseResponse])
async def list_kbs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(KnowledgeBase).order_by(KnowledgeBase.created_at.desc()))
    return list(result.scalars().all())


@router.post("", response_model=KnowledgeBaseResponse, status_code=201)
async def create_kb(data: KnowledgeBaseCreate, db: AsyncSession = Depends(get_db)):
    kb = KnowledgeBase(name=data.name, description=data.description)
    db.add(kb)
    await db.flush()
    return kb


@router.get("/{kb_id}", response_model=KnowledgeBaseWithItemsResponse)
async def get_kb(kb_id: str, db: AsyncSession = Depends(get_db)):
    kb = await db.get(KnowledgeBase, kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    result = await db.execute(
        select(KnowledgeBaseItem)
        .where(KnowledgeBaseItem.kb_id == kb_id)
        .order_by(KnowledgeBaseItem.created_at.desc())
    )
    items = list(result.scalars().all())
    return KnowledgeBaseWithItemsResponse(
        **KnowledgeBaseResponse.model_validate(kb).model_dump(),
        items=[KnowledgeBaseItemResponse.model_validate(i) for i in items],
    )


@router.put("/{kb_id}", response_model=KnowledgeBaseResponse)
async def update_kb(kb_id: str, data: KnowledgeBaseUpdate, db: AsyncSession = Depends(get_db)):
    kb = await db.get(KnowledgeBase, kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(kb, field, value)
    await db.flush()
    return kb


@router.delete("/{kb_id}", status_code=204)
async def delete_kb(kb_id: str, db: AsyncSession = Depends(get_db)):
    kb = await db.get(KnowledgeBase, kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    await db.execute(delete(KnowledgeBaseItem).where(KnowledgeBaseItem.kb_id == kb_id))
    await db.delete(kb)
    await db.flush()


# ─── Items CRUD ──────────────────────────────────────────────────────────────

@router.get("/{kb_id}/items", response_model=list[KnowledgeBaseItemResponse])
async def list_items(kb_id: str, db: AsyncSession = Depends(get_db)):
    kb = await db.get(KnowledgeBase, kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    result = await db.execute(
        select(KnowledgeBaseItem)
        .where(KnowledgeBaseItem.kb_id == kb_id)
        .order_by(KnowledgeBaseItem.created_at.desc())
    )
    return list(result.scalars().all())


@router.post("/{kb_id}/items", response_model=KnowledgeBaseItemResponse, status_code=201)
async def create_item(
    kb_id: str,
    data: KnowledgeBaseItemCreate,
    db: AsyncSession = Depends(get_db),
):
    kb = await db.get(KnowledgeBase, kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    item = KnowledgeBaseItem(
        kb_id=kb_id,
        name=data.name,
        description=data.description,
        content=data.content,
        source_type=data.source_type,
    )
    db.add(item)
    kb.item_count = kb.item_count + 1
    await db.flush()
    return item


@router.put("/{kb_id}/items/{item_id}", response_model=KnowledgeBaseItemResponse)
async def update_item(
    kb_id: str,
    item_id: str,
    data: KnowledgeBaseItemUpdate,
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(KnowledgeBaseItem, item_id)
    if not item or item.kb_id != kb_id:
        raise HTTPException(status_code=404, detail="Item not found")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(item, field, value)
    await db.flush()
    return item


@router.delete("/{kb_id}/items/{item_id}", status_code=204)
async def delete_item(kb_id: str, item_id: str, db: AsyncSession = Depends(get_db)):
    item = await db.get(KnowledgeBaseItem, item_id)
    if not item or item.kb_id != kb_id:
        raise HTTPException(status_code=404, detail="Item not found")
    kb = await db.get(KnowledgeBase, kb_id)
    await db.delete(item)
    if kb:
        kb.item_count = max(0, kb.item_count - 1)
    await db.flush()


# ─── Uploads ─────────────────────────────────────────────────────────────────

@router.post("/{kb_id}/items/upload-pdf", response_model=KnowledgeBaseItemResponse, status_code=201)
async def upload_pdf_item(
    kb_id: str,
    file: UploadFile = File(...),
    description: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    kb = await db.get(KnowledgeBase, kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    raw = await file.read()
    try:
        text = await _extract_pdf_text(raw, file.filename)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to parse PDF: {e}")

    item = KnowledgeBaseItem(
        kb_id=kb_id,
        name=file.filename,
        description=description,
        content=text,
        source_type="pdf",
        source_filename=file.filename,
        mime_type=file.content_type or "application/pdf",
        file_size_bytes=len(raw),
    )
    db.add(item)
    kb.item_count = kb.item_count + 1
    await db.flush()
    return item


@router.post("/{kb_id}/items/upload-pdfs", response_model=list[KnowledgeBaseItemResponse], status_code=201)
async def upload_batch_pdf_items(
    kb_id: str,
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    kb = await db.get(KnowledgeBase, kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")

    created: list[KnowledgeBaseItem] = []
    errors: list[str] = []
    for f in files:
        if not f.filename or not f.filename.lower().endswith(".pdf"):
            errors.append(f"{f.filename or '(unnamed)'}: not a PDF")
            continue
        raw = await f.read()
        try:
            text = await _extract_pdf_text(raw, f.filename)
        except Exception as e:
            errors.append(f"{f.filename}: {e}")
            continue
        item = KnowledgeBaseItem(
            kb_id=kb_id,
            name=f.filename,
            content=text,
            source_type="pdf",
            source_filename=f.filename,
            mime_type=f.content_type or "application/pdf",
            file_size_bytes=len(raw),
        )
        db.add(item)
        created.append(item)

    kb.item_count = kb.item_count + len(created)
    await db.flush()
    return created


@router.post("/{kb_id}/items/upload-csv", response_model=list[KnowledgeBaseItemResponse], status_code=201)
async def upload_csv_items(
    kb_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Ingest a CSV where each row becomes one item.

    Accepted column names (case-insensitive):
      - 'content' or 'text' or the first column → content
      - 'name' → name (optional; if missing, auto-generates "row N")
      - 'description' → description (optional)
    Rows with empty content are skipped.
    """
    kb = await db.get(KnowledgeBase, kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")

    raw = await file.read()
    text = raw.decode("utf-8", errors="replace")

    # Try DictReader first (with header); fall back to positional reader
    created: list[KnowledgeBaseItem] = []
    reader = csv.DictReader(io.StringIO(text))
    fieldnames = [f.lower() for f in (reader.fieldnames or [])]

    def _field(row: dict, *names: str) -> str | None:
        for n in names:
            for key in row:
                if key and key.lower() == n:
                    v = row[key]
                    if v is not None and str(v).strip():
                        return str(v).strip()
        return None

    if fieldnames and ("content" in fieldnames or "text" in fieldnames):
        for i, row in enumerate(reader, start=1):
            content = _field(row, "content", "text")
            if not content:
                continue
            name = _field(row, "name") or f"row {i}"
            desc = _field(row, "description")
            item = KnowledgeBaseItem(
                kb_id=kb_id, name=name, description=desc, content=content, source_type="csv_row",
                source_filename=file.filename, mime_type="text/csv", file_size_bytes=len(raw),
            )
            db.add(item)
            created.append(item)
    else:
        # Positional: every non-empty line = one item (first column)
        plain_reader = csv.reader(io.StringIO(text))
        for i, row in enumerate(plain_reader, start=1):
            if not row:
                continue
            content = (row[0] if row else "").strip()
            if not content:
                continue
            name = f"row {i}"
            item = KnowledgeBaseItem(
                kb_id=kb_id, name=name, content=content, source_type="csv_row",
                source_filename=file.filename, mime_type="text/csv", file_size_bytes=len(raw),
            )
            db.add(item)
            created.append(item)

    kb.item_count = kb.item_count + len(created)
    await db.flush()
    return created
