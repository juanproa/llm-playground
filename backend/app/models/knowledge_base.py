"""Knowledge Base models — reusable libraries of text/document items.

Adds chunk-level embeddings for RAG retrieval. Each KnowledgeBaseItem is
split into KnowledgeBaseChunk rows whose `embedding` BLOB holds a packed
float32 vector. Cosine similarity is computed in Python at query time
(numpy); this is fine at playground scale (<<100k chunks).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


DEFAULT_EMBEDDING_PROVIDER = "mlx_local"
DEFAULT_EMBEDDING_MODEL = "mlx-community/Qwen3-Embedding-0.6B-4bit-DWQ"
DEFAULT_CHUNK_SIZE_TOKENS = 800
DEFAULT_CHUNK_OVERLAP_TOKENS = 100


class KnowledgeBase(Base):
    __tablename__ = "knowledge_bases"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    item_count: Mapped[int] = mapped_column(Integer, default=0)

    # RAG configuration
    embedding_provider: Mapped[str] = mapped_column(String(50), default=DEFAULT_EMBEDDING_PROVIDER)
    embedding_model: Mapped[str] = mapped_column(String(255), default=DEFAULT_EMBEDDING_MODEL)
    embedding_dim: Mapped[int | None] = mapped_column(Integer, nullable=True)
    chunk_size_tokens: Mapped[int] = mapped_column(Integer, default=DEFAULT_CHUNK_SIZE_TOKENS)
    chunk_overlap_tokens: Mapped[int] = mapped_column(Integer, default=DEFAULT_CHUNK_OVERLAP_TOKENS)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)

    # Optional "dictionary" / schema doc (markdown or CSV-derived) describing
    # column meanings for CSV-based KBs. Injected alongside retrieved chunks
    # at query time so the model knows what each column represents.
    dictionary_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    dictionary_filename: Mapped[str | None] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    items: Mapped[list["KnowledgeBaseItem"]] = relationship(
        "KnowledgeBaseItem",
        back_populates="knowledge_base",
        cascade="all, delete-orphan",
    )


class KnowledgeBaseItem(Base):
    __tablename__ = "knowledge_base_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    kb_id: Mapped[str] = mapped_column(String(36), ForeignKey("knowledge_bases.id"), nullable=False)
    # Human name / short identifier
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # The actual text content (extracted from PDF or directly entered)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # Where the content came from: "text", "pdf", "csv_row"
    source_type: Mapped[str] = mapped_column(String(50), default="text")
    source_filename: Mapped[str | None] = mapped_column(String(500), nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    file_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Arbitrary per-row metadata (e.g. CSV columns alongside the content
    # column). Stored as JSON-encoded string; rendered alongside retrieved
    # chunks so the model sees the row's tags/categories/etc.
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Parse state tracking (for PDF uploads that run docling/OCR asynchronously)
    parse_status: Mapped[str] = mapped_column(String(20), default="ready")  # pending | ready | failed
    parse_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Embedding state tracking
    embedding_status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | ready | failed
    embedding_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    knowledge_base = relationship("KnowledgeBase", back_populates="items")
    chunks: Mapped[list["KnowledgeBaseChunk"]] = relationship(
        "KnowledgeBaseChunk",
        back_populates="item",
        cascade="all, delete-orphan",
    )


class KnowledgeBaseChunk(Base):
    __tablename__ = "knowledge_base_chunks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    kb_id: Mapped[str] = mapped_column(String(36), ForeignKey("knowledge_bases.id"), nullable=False, index=True)
    item_id: Mapped[str] = mapped_column(String(36), ForeignKey("knowledge_base_items.id"), nullable=False, index=True)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    # Packed float32 little-endian vector (numpy tobytes()).
    embedding: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    # Optional scalar "norm" so we can cache the L2 norm for fast cosine (not used yet)
    embedding_norm: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    item = relationship("KnowledgeBaseItem", back_populates="chunks")
