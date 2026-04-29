"""Pydantic schemas for global Input Datasets (Workspace prompt-input browsing)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class InputDatasetCreate(BaseModel):
    name: str
    description: str | None = None


class InputDatasetUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class InputDatasetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str | None
    item_count: int
    eval_status: str = "idle"
    mask_status: str = "idle"
    created_at: datetime
    updated_at: datetime


class InputDatasetItemCreate(BaseModel):
    name: str | None = None
    content: str
    tags: str | None = None
    metadata_json: str | None = None


class InputDatasetItemUpdate(BaseModel):
    name: str | None = None
    content: str | None = None
    tags: str | None = None
    metadata_json: str | None = None


class InputDatasetItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    dataset_id: str
    name: str | None
    content: str
    tags: str | None
    metadata_json: str | None
    source_type: str = "text"
    source_filename: str | None
    mime_type: str | None = None
    file_size_bytes: int | None = None
    parse_status: str = "ready"
    parse_error: str | None = None
    quality_status: str = "unchecked"
    quality_reason: str | None = None
    pii_status: str = "unchecked"
    pii_masked_content: str | None = None
    created_at: datetime


class InputDatasetWithItemsResponse(InputDatasetResponse):
    items: list[InputDatasetItemResponse] = []


class CopyFromKbRequest(BaseModel):
    """Create an InputDataset containing all items of a given KB."""
    dataset_name: str | None = None   # defaults to KB name
    dataset_description: str | None = None
