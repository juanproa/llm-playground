from pydantic import BaseModel
from datetime import datetime


class DocumentPasteCreate(BaseModel):
    name: str
    content: str


class DocumentResponse(BaseModel):
    id: str
    project_id: str
    name: str
    source_type: str
    raw_text: str | None
    mime_type: str | None
    file_size_bytes: int | None
    parse_status: str
    parse_error: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
