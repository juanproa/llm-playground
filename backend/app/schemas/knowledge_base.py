"""Knowledge Base Pydantic schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


# ─── Knowledge Base ──────────────────────────────────────────────────────────

class KnowledgeBaseCreate(BaseModel):
    name: str
    description: str | None = None
    embedding_provider: str | None = None
    embedding_model: str | None = None
    chunk_size_tokens: int | None = None
    chunk_overlap_tokens: int | None = None


class KnowledgeBaseUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    embedding_provider: str | None = None
    embedding_model: str | None = None
    chunk_size_tokens: int | None = None
    chunk_overlap_tokens: int | None = None


class KnowledgeBaseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str | None
    item_count: int
    embedding_provider: str
    embedding_model: str
    embedding_dim: int | None
    chunk_size_tokens: int
    chunk_overlap_tokens: int
    chunk_count: int
    dictionary_filename: str | None
    created_at: datetime
    updated_at: datetime


# ─── Item ────────────────────────────────────────────────────────────────────

class KnowledgeBaseItemCreate(BaseModel):
    name: str
    description: str | None = None
    content: str
    source_type: str = "text"


class KnowledgeBaseItemUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    content: str | None = None


class KnowledgeBaseItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    kb_id: str
    name: str
    description: str | None
    content: str
    source_type: str
    source_filename: str | None
    mime_type: str | None
    file_size_bytes: int | None
    metadata_json: str | None
    parse_status: str
    parse_error: str | None
    embedding_status: str
    embedding_error: str | None
    created_at: datetime
    updated_at: datetime


class KnowledgeBaseWithItemsResponse(KnowledgeBaseResponse):
    items: list[KnowledgeBaseItemResponse] = []
    dictionary_content: str | None = None


# ─── Retrieval ───────────────────────────────────────────────────────────────

class KbQueryRequest(BaseModel):
    query: str
    top_k: int = 5


class RetrievedChunk(BaseModel):
    chunk_id: str
    item_id: str
    item_name: str
    source_type: str
    chunk_index: int
    content: str
    score: float
    metadata: dict[str, Any] | None = None


class KbQueryResponse(BaseModel):
    query: str
    embedding_model: str
    chunks: list[RetrievedChunk]
    dictionary_content: str | None = None


# ─── Embedding model catalog ─────────────────────────────────────────────────

class EmbeddingModelInfo(BaseModel):
    provider: str          # "mlx_local" | "openai"
    model_id: str
    display_name: str
    dim: int | None = None
    notes: str | None = None
