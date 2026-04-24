"""Knowledge Base routes: CRUD for bases + items (text / PDF / batch PDF / CSV),
plus RAG-related endpoints (retrieval query, re-embed, dictionary upload,
embedding-model catalog)."""
from __future__ import annotations

import csv
import io
import json
import logging
import os
import uuid
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.dependencies import get_db
from app.models.knowledge_base import (
    KnowledgeBase,
    KnowledgeBaseChunk,
    KnowledgeBaseItem,
)
from app.schemas.knowledge_base import (
    EmbeddingModelInfo,
    KbQueryRequest,
    KbQueryResponse,
    KnowledgeBaseCreate,
    KnowledgeBaseItemCreate,
    KnowledgeBaseItemResponse,
    KnowledgeBaseItemUpdate,
    KnowledgeBaseResponse,
    KnowledgeBaseUpdate,
    KnowledgeBaseWithItemsResponse,
)
from app.services import rag_service
from app.services.embeddings import AVAILABLE_EMBEDDING_MODELS

logger = logging.getLogger(__name__)


def _save_upload_to_disk(raw_bytes: bytes, filename: str) -> str:
    """Write raw bytes into UPLOADS_DIR and return the persisted path."""
    os.makedirs(settings.UPLOADS_DIR, exist_ok=True)
    file_id = str(uuid.uuid4())
    ext = os.path.splitext(filename)[1] or ".pdf"
    save_path = os.path.join(settings.UPLOADS_DIR, f"kb_{file_id}{ext}")
    with open(save_path, "wb") as f:
        f.write(raw_bytes)
    return save_path


router = APIRouter(prefix="/knowledge-bases", tags=["knowledge-base"])


# ─── Catalog ─────────────────────────────────────────────────────────────────

@router.get("/embedding-models", response_model=list[EmbeddingModelInfo])
async def list_embedding_models():
    """List known embedding models (MLX local + OpenAI)."""
    return [EmbeddingModelInfo(**m) for m in AVAILABLE_EMBEDDING_MODELS]


# ─── Knowledge Base CRUD ─────────────────────────────────────────────────────

@router.get("", response_model=list[KnowledgeBaseResponse])
async def list_kbs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(KnowledgeBase).order_by(KnowledgeBase.created_at.desc()))
    return list(result.scalars().all())


@router.post("", response_model=KnowledgeBaseResponse, status_code=201)
async def create_kb(data: KnowledgeBaseCreate, db: AsyncSession = Depends(get_db)):
    kwargs = dict(name=data.name, description=data.description)
    if data.embedding_provider:
        kwargs["embedding_provider"] = data.embedding_provider
    if data.embedding_model:
        kwargs["embedding_model"] = data.embedding_model
    if data.chunk_size_tokens:
        kwargs["chunk_size_tokens"] = data.chunk_size_tokens
    if data.chunk_overlap_tokens is not None:
        kwargs["chunk_overlap_tokens"] = data.chunk_overlap_tokens
    kb = KnowledgeBase(**kwargs)
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
        dictionary_content=kb.dictionary_content,
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
    await db.execute(delete(KnowledgeBaseChunk).where(KnowledgeBaseChunk.kb_id == kb_id))
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
    background_tasks: BackgroundTasks,
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
    await db.commit()
    await db.refresh(item)
    background_tasks.add_task(rag_service.embed_item_by_id, kb_id, item.id)
    return item


@router.put("/{kb_id}/items/{item_id}", response_model=KnowledgeBaseItemResponse)
async def update_item(
    kb_id: str,
    item_id: str,
    data: KnowledgeBaseItemUpdate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(KnowledgeBaseItem, item_id)
    if not item or item.kb_id != kb_id:
        raise HTTPException(status_code=404, detail="Item not found")
    content_changed = data.content is not None and data.content != item.content
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(item, field, value)
    if content_changed:
        item.embedding_status = "pending"
        item.embedding_error = None
    await db.commit()
    if content_changed:
        background_tasks.add_task(rag_service.embed_item_by_id, kb_id, item_id)
    return item


@router.delete("/{kb_id}/items/{item_id}", status_code=204)
async def delete_item(kb_id: str, item_id: str, db: AsyncSession = Depends(get_db)):
    item = await db.get(KnowledgeBaseItem, item_id)
    if not item or item.kb_id != kb_id:
        raise HTTPException(status_code=404, detail="Item not found")
    kb = await db.get(KnowledgeBase, kb_id)
    # Count chunks to decrement kb.chunk_count
    chunk_count_result = await db.execute(
        select(KnowledgeBaseChunk).where(KnowledgeBaseChunk.item_id == item_id)
    )
    nchunks = len(list(chunk_count_result.scalars().all()))
    await db.execute(delete(KnowledgeBaseChunk).where(KnowledgeBaseChunk.item_id == item_id))
    await db.delete(item)
    if kb:
        kb.item_count = max(0, kb.item_count - 1)
        kb.chunk_count = max(0, kb.chunk_count - nchunks)
    await db.flush()


# ─── Uploads ─────────────────────────────────────────────────────────────────

@router.post("/{kb_id}/items/upload-pdf", response_model=KnowledgeBaseItemResponse, status_code=201)
async def upload_pdf_item(
    kb_id: str,
    background_tasks: BackgroundTasks,
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
    save_path = _save_upload_to_disk(raw, file.filename)

    # Create the item immediately with empty content. Parsing + embedding run
    # in the background so the POST returns fast even when docling is slow or
    # downloading its layout model on first use.
    item = KnowledgeBaseItem(
        kb_id=kb_id,
        name=file.filename,
        description=description,
        content="",
        source_type="pdf",
        source_filename=file.filename,
        mime_type=file.content_type or "application/pdf",
        file_size_bytes=len(raw),
        parse_status="pending",
        embedding_status="pending",
    )
    db.add(item)
    kb.item_count = kb.item_count + 1
    await db.commit()
    await db.refresh(item)
    background_tasks.add_task(
        rag_service.parse_and_embed_pdf_by_id, kb_id, item.id, save_path
    )
    return item


@router.post("/{kb_id}/items/upload-pdfs", response_model=list[KnowledgeBaseItemResponse], status_code=201)
async def upload_batch_pdf_items(
    kb_id: str,
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    kb = await db.get(KnowledgeBase, kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")

    created: list[tuple[KnowledgeBaseItem, str]] = []
    for f in files:
        if not f.filename or not f.filename.lower().endswith(".pdf"):
            continue
        raw = await f.read()
        save_path = _save_upload_to_disk(raw, f.filename)
        item = KnowledgeBaseItem(
            kb_id=kb_id,
            name=f.filename,
            content="",
            source_type="pdf",
            source_filename=f.filename,
            mime_type=f.content_type or "application/pdf",
            file_size_bytes=len(raw),
            parse_status="pending",
            embedding_status="pending",
        )
        db.add(item)
        created.append((item, save_path))

    kb.item_count = kb.item_count + len(created)
    await db.commit()
    result: list[KnowledgeBaseItem] = []
    for item, save_path in created:
        await db.refresh(item)
        result.append(item)
        background_tasks.add_task(
            rag_service.parse_and_embed_pdf_by_id, kb_id, item.id, save_path
        )
    return result


@router.post("/{kb_id}/items/upload-csv", response_model=list[KnowledgeBaseItemResponse], status_code=201)
async def upload_csv_items(
    kb_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    content_column: Optional[str] = Form(None),
    name_column: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """Ingest a CSV where each row becomes one item.

    Columns handled (case-insensitive):
      - Content source: `content_column` form field if given, else first of
        `content`/`text`, else the first column.
      - Name: `name_column` form field if given, else a `name` column, else
        auto-generated "row N".
      - Description: a `description` column if present (optional).
      - Every other column is captured into the row's `metadata_json` blob
        so the model sees tags/categories/etc. at retrieval time.

    Rows with empty content are skipped.
    """
    kb = await db.get(KnowledgeBase, kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")

    raw = await file.read()
    text = raw.decode("utf-8", errors="replace")

    reader = csv.DictReader(io.StringIO(text))
    fieldnames = reader.fieldnames or []
    lower_names = [f.lower() for f in fieldnames]

    # Decide which column is the "content" column
    content_col: str | None = None
    if content_column:
        # Match case-insensitive
        for f in fieldnames:
            if f.lower() == content_column.lower():
                content_col = f
                break
    if not content_col:
        for candidate in ("content", "text"):
            if candidate in lower_names:
                content_col = fieldnames[lower_names.index(candidate)]
                break
    if not content_col and fieldnames:
        content_col = fieldnames[0]

    # Name column
    name_col: str | None = None
    if name_column:
        for f in fieldnames:
            if f.lower() == name_column.lower():
                name_col = f
                break
    if not name_col and "name" in lower_names:
        name_col = fieldnames[lower_names.index("name")]

    # Description
    desc_col: str | None = None
    if "description" in lower_names:
        desc_col = fieldnames[lower_names.index("description")]

    created: list[KnowledgeBaseItem] = []

    if fieldnames:
        for i, row in enumerate(reader, start=1):
            content = (row.get(content_col) or "").strip() if content_col else ""
            if not content:
                continue
            name = (row.get(name_col) or "").strip() if name_col else ""
            if not name:
                name = f"row {i}"
            desc = (row.get(desc_col) or "").strip() if desc_col else None

            # Everything else → metadata
            meta = {
                k: v for k, v in row.items()
                if k and k != content_col and k != name_col and k != desc_col and v not in (None, "")
            }
            meta_json = json.dumps(meta) if meta else None

            item = KnowledgeBaseItem(
                kb_id=kb_id,
                name=name,
                description=desc,
                content=content,
                source_type="csv_row",
                source_filename=file.filename,
                mime_type="text/csv",
                file_size_bytes=len(raw),
                metadata_json=meta_json,
            )
            db.add(item)
            created.append(item)
    else:
        # Headerless: every non-empty line = one item (first column)
        plain_reader = csv.reader(io.StringIO(text))
        for i, row in enumerate(plain_reader, start=1):
            if not row:
                continue
            content = (row[0] if row else "").strip()
            if not content:
                continue
            item = KnowledgeBaseItem(
                kb_id=kb_id,
                name=f"row {i}",
                content=content,
                source_type="csv_row",
                source_filename=file.filename,
                mime_type="text/csv",
                file_size_bytes=len(raw),
            )
            db.add(item)
            created.append(item)

    kb.item_count = kb.item_count + len(created)
    await db.commit()
    for item in created:
        await db.refresh(item)
        background_tasks.add_task(rag_service.embed_item_by_id, kb_id, item.id)
    return created


@router.post("/{kb_id}/upload-dictionary", response_model=KnowledgeBaseResponse)
async def upload_dictionary(
    kb_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload a CSV/markdown/text "dictionary" describing the KB's columns.

    The raw text is rendered (or, for CSV, flattened into a bullet list) and
    injected alongside retrieved chunks at query time so the model knows what
    each column/metadata field means.
    """
    kb = await db.get(KnowledgeBase, kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")

    raw = await file.read()
    text = raw.decode("utf-8", errors="replace")
    filename = file.filename or "dictionary"

    # If it's a CSV, format as "- column: description" bullets.
    if filename.lower().endswith(".csv"):
        try:
            reader = csv.DictReader(io.StringIO(text))
            fields = reader.fieldnames or []
            lower = [f.lower() for f in fields]
            col_key = fields[lower.index("column")] if "column" in lower else (fields[0] if fields else None)
            desc_key = (
                fields[lower.index("description")] if "description" in lower
                else (fields[lower.index("meaning")] if "meaning" in lower
                      else (fields[1] if len(fields) >= 2 else None))
            )
            lines: list[str] = []
            for row in reader:
                if not col_key:
                    continue
                col = (row.get(col_key) or "").strip()
                desc = (row.get(desc_key) or "").strip() if desc_key else ""
                if not col:
                    continue
                lines.append(f"- {col}: {desc}" if desc else f"- {col}")
            if lines:
                text = "\n".join(lines)
        except Exception as e:
            logger.warning("Dictionary CSV parse fell back to raw text: %s", e)

    kb.dictionary_content = text
    kb.dictionary_filename = filename
    await db.flush()
    return kb


@router.delete("/{kb_id}/dictionary", response_model=KnowledgeBaseResponse)
async def clear_dictionary(kb_id: str, db: AsyncSession = Depends(get_db)):
    kb = await db.get(KnowledgeBase, kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    kb.dictionary_content = None
    kb.dictionary_filename = None
    await db.flush()
    return kb


# ─── RAG: query + re-embed ───────────────────────────────────────────────────

@router.post("/{kb_id}/query", response_model=KbQueryResponse)
async def query_kb(
    kb_id: str,
    request: KbQueryRequest,
    db: AsyncSession = Depends(get_db),
):
    kb = await db.get(KnowledgeBase, kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")

    try:
        hits = await rag_service.query_kb(db, kb, request.query, request.top_k)
    except Exception as e:
        logger.exception("KB query failed")
        raise HTTPException(status_code=500, detail=f"Query failed: {e}")

    return KbQueryResponse(
        query=request.query,
        embedding_model=kb.embedding_model,
        chunks=hits,
        dictionary_content=kb.dictionary_content,
    )


@router.post("/{kb_id}/reindex", response_model=KnowledgeBaseResponse)
async def reindex_kb(kb_id: str, db: AsyncSession = Depends(get_db)):
    """Wipe and rebuild all chunks + embeddings for this KB. Use after changing
    the embedding model or chunk parameters."""
    kb = await db.get(KnowledgeBase, kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    try:
        summary = await rag_service.reembed_kb(db, kb)
        logger.info("Re-indexed KB %s: %s", kb_id, summary)
    except Exception as e:
        logger.exception("Re-index failed")
        raise HTTPException(status_code=500, detail=f"Re-index failed: {e}")
    await db.flush()
    return kb
