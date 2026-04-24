"""Global input datasets — curated lists of prompt inputs for the Workspace.

Distinct from `pt_datasets` (post-training): those are project-scoped
labeled (input, output) pairs for fine-tuning. These are global, use only
`input_text`, and exist purely so the user can "pick an item to paste into
the Input box" in the Project Workspace.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class InputDataset(Base):
    __tablename__ = "input_datasets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    item_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    items: Mapped[list["InputDatasetItem"]] = relationship(
        "InputDatasetItem",
        back_populates="dataset",
        cascade="all, delete-orphan",
    )


class InputDatasetItem(Base):
    __tablename__ = "input_dataset_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    dataset_id: Mapped[str] = mapped_column(String(36), ForeignKey("input_datasets.id"), nullable=False, index=True)
    # Human-readable label; auto-derived from content preview if omitted
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # content may start empty ("") while a PDF parse runs in the background
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    tags: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_type: Mapped[str] = mapped_column(String(50), default="text")  # text | pdf | csv_row
    source_filename: Mapped[str | None] = mapped_column(String(500), nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    file_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # PDF parse state (same pattern as KB): pending while docling runs, then ready/failed
    parse_status: Mapped[str] = mapped_column(String(20), default="ready")
    parse_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    dataset = relationship("InputDataset", back_populates="items")
