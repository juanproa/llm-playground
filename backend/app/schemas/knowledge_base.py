"""Knowledge Base Pydantic schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


# ─── Knowledge Base ──────────────────────────────────────────────────────────

class KnowledgeBaseCreate(BaseModel):
    name: str
    description: str | None = None


class KnowledgeBaseUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class KnowledgeBaseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str | None
    item_count: int
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
    created_at: datetime
    updated_at: datetime


class KnowledgeBaseWithItemsResponse(KnowledgeBaseResponse):
    items: list[KnowledgeBaseItemResponse] = []
