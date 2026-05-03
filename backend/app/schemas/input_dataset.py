"""Pydantic schemas for global Input Datasets (Workspace prompt-input browsing)."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, model_validator


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
    """Response for an InputDatasetItem.

    PII guarantee: `content` is ALWAYS the PII-safe version. When the source
    item has `pii_status='masked'`, this field returns `pii_masked_content`
    (the masked text); otherwise it returns the raw `content`. The raw text
    of a masked item is NEVER exposed via the API.

    The dedicated `pii_masked_content` field has been intentionally removed —
    it duplicated the value now exposed via `content` and made it possible
    for the frontend to bypass masking by reading the wrong field.
    """
    model_config = ConfigDict(from_attributes=True)

    id: str
    dataset_id: str
    name: str | None
    content: str  # Always PII-safe (== effective_content of the source item)
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
    created_at: datetime

    @model_validator(mode="before")
    @classmethod
    def _enforce_pii_mask(cls, data: Any) -> Any:
        """Replace `content` with `effective_content` when validating from an
        ORM model. This is the API-boundary enforcement of the rule
        "if a mask exists, never expose the original".
        """
        if hasattr(data, "effective_content"):
            # Wrap the ORM object so Pydantic's `from_attributes` picks up the
            # masked content via .content. Mutating the ORM object would risk
            # an autoflush writing the masked text back to disk.
            class _SafeView:
                def __init__(self, obj):
                    self._obj = obj

                def __getattr__(self, name: str) -> Any:
                    if name == "content":
                        return self._obj.effective_content
                    return getattr(self._obj, name)

            return _SafeView(data)
        return data


class InputDatasetWithItemsResponse(InputDatasetResponse):
    items: list[InputDatasetItemResponse] = []


class CopyFromKbRequest(BaseModel):
    """Create an InputDataset containing all items of a given KB."""
    dataset_name: str | None = None   # defaults to KB name
    dataset_description: str | None = None
