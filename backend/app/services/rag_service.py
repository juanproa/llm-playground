"""RAG pipeline: chunk + embed ingest, top-k retrieval.

Ingest path (called from the KB router on upload/text add):
    1. Break `item.content` into chunks.
    2. Embed all chunks in one batch.
    3. Persist chunks with packed float32 embedding BLOBs.

Query path:
    1. Embed the query with the KB's configured embedding model.
    2. Load every chunk's embedding from the DB, stack into a matrix.
    3. numpy cosine top-k. Return full chunk rows + metadata.

This "load all vectors" path is O(n) per query but trivial at playground
scale. Swap for sqlite-vec if you ever hit >100k chunks.
"""
from __future__ import annotations

import json
import logging

import numpy as np
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.knowledge_base import (
    KnowledgeBase,
    KnowledgeBaseChunk,
    KnowledgeBaseItem,
)
from app.schemas.knowledge_base import RetrievedChunk
from app.services.chunker import chunk_text
from app.services.embeddings import cosine_top_k, get_embedder

logger = logging.getLogger(__name__)


async def embed_item(db: AsyncSession, kb: KnowledgeBase, item: KnowledgeBaseItem) -> int:
    """Delete any existing chunks for `item`, chunk its content, embed, and persist.

    Returns the number of chunks created. Updates `item.embedding_status` on
    success/failure and bumps `kb.chunk_count`. Caller is responsible for the
    session lifecycle (commit/flush outside).
    """
    # Remove any previous chunks
    prev_count_result = await db.execute(
        select(KnowledgeBaseChunk).where(KnowledgeBaseChunk.item_id == item.id)
    )
    prev_chunks = list(prev_count_result.scalars().all())
    prev_n = len(prev_chunks)
    if prev_n:
        await db.execute(delete(KnowledgeBaseChunk).where(KnowledgeBaseChunk.item_id == item.id))

    chunks = chunk_text(
        item.content,
        chunk_size_tokens=kb.chunk_size_tokens,
        overlap_tokens=kb.chunk_overlap_tokens,
    )
    if not chunks:
        item.embedding_status = "ready"
        item.embedding_error = None
        kb.chunk_count = max(0, kb.chunk_count - prev_n)
        return 0

    embedder = get_embedder(kb.embedding_provider, kb.embedding_model)
    try:
        result = await embedder.embed([c.content for c in chunks])
    except Exception as e:
        logger.exception("Embedding failed for item %s", item.id)
        item.embedding_status = "failed"
        item.embedding_error = str(e)[:2000]
        # Adjust count: we removed prev but added nothing
        kb.chunk_count = max(0, kb.chunk_count - prev_n)
        return 0

    if kb.embedding_dim and kb.embedding_dim != result.dim:
        # Dimension mismatch (e.g. user changed embedding model) — wipe the
        # whole KB's chunks so all items use the new dim consistently.
        logger.warning(
            "Embedding dim changed for KB %s: was %s, now %s — wiping all chunks",
            kb.id, kb.embedding_dim, result.dim,
        )
        await db.execute(delete(KnowledgeBaseChunk).where(KnowledgeBaseChunk.kb_id == kb.id))
        kb.chunk_count = 0
        # Also mark every other item as pending so they get re-embedded on demand
        from sqlalchemy import update
        await db.execute(
            update(KnowledgeBaseItem)
            .where(KnowledgeBaseItem.kb_id == kb.id, KnowledgeBaseItem.id != item.id)
            .values(embedding_status="pending", embedding_error=None)
        )
    kb.embedding_dim = result.dim

    rows: list[KnowledgeBaseChunk] = []
    for i, (piece, vec) in enumerate(zip(chunks, result.vectors)):
        rows.append(
            KnowledgeBaseChunk(
                kb_id=kb.id,
                item_id=item.id,
                chunk_index=i,
                content=piece.content,
                token_count=piece.token_count,
                embedding=vec.astype(np.float32).tobytes(),
                embedding_norm=float(np.linalg.norm(vec)),
            )
        )
    db.add_all(rows)

    kb.chunk_count = max(0, kb.chunk_count - prev_n) + len(rows)
    item.embedding_status = "ready"
    item.embedding_error = None
    return len(rows)


async def embed_item_by_id(kb_id: str, item_id: str) -> None:
    """Background-task variant: opens its own session so it survives past the
    HTTP request that queued it. Used for uploads where we want the POST to
    return immediately and the embedding to happen async."""
    async with async_session() as db:
        kb = await db.get(KnowledgeBase, kb_id)
        item = await db.get(KnowledgeBaseItem, item_id)
        if not kb or not item:
            logger.warning("embed_item_by_id: missing kb=%s or item=%s", kb_id, item_id)
            return
        try:
            await embed_item(db, kb, item)
            await db.commit()
        except Exception as e:
            logger.exception("Background embed failed for item %s", item_id)
            await db.rollback()
            # Mark the item failed in a fresh session so the rollback doesn't wipe it
            async with async_session() as db2:
                it = await db2.get(KnowledgeBaseItem, item_id)
                if it:
                    it.embedding_status = "failed"
                    it.embedding_error = str(e)[:2000]
                    await db2.commit()


async def parse_and_embed_pdf_by_id(kb_id: str, item_id: str, save_path: str) -> None:
    """Background pipeline for PDF uploads.

    parse_pdf runs in a thread (docling + tesseract). On success we persist
    the extracted text and flip parse_status=ready, then embed. On failure we
    mark parse_status=failed and surface the error.

    The KB's "item_count" was already incremented at upload time; we do NOT
    revert it on parse failure — the item still exists (empty/failed) and is
    visible in the UI.
    """
    import asyncio

    from app.services.pdf_parser import parse_pdf

    text = ""
    parse_error: str | None = None
    try:
        text = await asyncio.to_thread(parse_pdf, save_path)
    except Exception as e:
        parse_error = str(e)[:2000]
        logger.exception("PDF parse failed for item %s", item_id)

    # Persist parse result
    async with async_session() as db:
        item = await db.get(KnowledgeBaseItem, item_id)
        if not item:
            logger.warning("parse_and_embed_pdf_by_id: item %s vanished", item_id)
            return
        if parse_error is not None:
            item.parse_status = "failed"
            item.parse_error = parse_error
            item.embedding_status = "failed"
            item.embedding_error = "parse failed — cannot embed"
            await db.commit()
            return
        item.content = text
        item.parse_status = "ready"
        item.parse_error = None
        await db.commit()

    # Now embed (own session inside embed_item_by_id)
    await embed_item_by_id(kb_id, item_id)


async def reembed_kb(db: AsyncSession, kb: KnowledgeBase) -> dict:
    """Wipe and rebuild all chunks for a KB. Use after changing embedding model
    or chunk parameters. Returns a summary dict."""
    # Clear all chunks
    await db.execute(delete(KnowledgeBaseChunk).where(KnowledgeBaseChunk.kb_id == kb.id))
    kb.chunk_count = 0
    kb.embedding_dim = None

    result = await db.execute(
        select(KnowledgeBaseItem).where(KnowledgeBaseItem.kb_id == kb.id)
    )
    items = list(result.scalars().all())
    total_chunks = 0
    failed = 0
    for item in items:
        n = await embed_item(db, kb, item)
        total_chunks += n
        if item.embedding_status == "failed":
            failed += 1

    return {
        "items": len(items),
        "chunks": total_chunks,
        "failed_items": failed,
    }


async def query_kb(
    db: AsyncSession,
    kb: KnowledgeBase,
    query: str,
    top_k: int = 5,
) -> list[RetrievedChunk]:
    """Embed `query`, load all chunks for the KB, return top-k by cosine sim."""
    if not query.strip() or top_k <= 0:
        return []

    embedder = get_embedder(kb.embedding_provider, kb.embedding_model)
    result = await embedder.embed([query])
    if result.vectors.shape[0] == 0:
        return []
    q = result.vectors[0]

    rows_result = await db.execute(
        select(KnowledgeBaseChunk, KnowledgeBaseItem)
        .join(KnowledgeBaseItem, KnowledgeBaseChunk.item_id == KnowledgeBaseItem.id)
        .where(
            KnowledgeBaseChunk.kb_id == kb.id,
            KnowledgeBaseChunk.embedding.isnot(None),
        )
    )
    pairs = list(rows_result.all())
    if not pairs:
        return []

    # Build matrix of embeddings
    vecs: list[np.ndarray] = []
    keep_pairs: list[tuple[KnowledgeBaseChunk, KnowledgeBaseItem]] = []
    for chunk, item in pairs:
        v = np.frombuffer(chunk.embedding, dtype=np.float32)
        if v.shape[0] != q.shape[0]:
            # Dimension mismatch — skip (will be re-indexed via re-embed)
            continue
        vecs.append(v)
        keep_pairs.append((chunk, item))
    if not vecs:
        return []

    matrix = np.stack(vecs, axis=0)
    idx, scores = cosine_top_k(q, matrix, top_k)

    hits: list[RetrievedChunk] = []
    for i, score in zip(idx, scores):
        chunk, item = keep_pairs[int(i)]
        metadata: dict | None = None
        if item.metadata_json:
            try:
                metadata = json.loads(item.metadata_json)
            except Exception:
                metadata = None
        hits.append(
            RetrievedChunk(
                chunk_id=chunk.id,
                item_id=item.id,
                item_name=item.name,
                source_type=item.source_type,
                chunk_index=chunk.chunk_index,
                content=chunk.content,
                score=float(score),
                metadata=metadata,
            )
        )
    return hits


def format_chunks_for_prompt(
    chunks: list[RetrievedChunk],
    dictionary_content: str | None = None,
) -> str:
    """Render retrieved chunks (+ optional dictionary) as a single text block
    suitable for prepending to the system prompt."""
    if not chunks and not dictionary_content:
        return ""

    parts: list[str] = ["--- Retrieved Knowledge ---"]
    if dictionary_content:
        parts.append("[Data Dictionary]\n" + dictionary_content.strip())

    for i, c in enumerate(chunks, start=1):
        header = f"[{i}] {c.item_name} (chunk {c.chunk_index + 1}, score={c.score:.3f})"
        if c.metadata:
            try:
                meta_str = ", ".join(f"{k}={v}" for k, v in c.metadata.items() if v is not None)
            except Exception:
                meta_str = ""
            if meta_str:
                header += f" — {meta_str}"
        parts.append(header)
        parts.append(c.content.strip())

    parts.append("--- End Retrieved Knowledge ---")
    return "\n\n".join(parts)
