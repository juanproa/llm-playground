from pydantic import BaseModel
from datetime import datetime


class PromptCreate(BaseModel):
    name: str
    content: str
    system_message: str | None = None
    label: str | None = None


class PromptUpdate(BaseModel):
    name: str | None = None


class PromptVersionCreate(BaseModel):
    content: str
    system_message: str | None = None
    label: str | None = None


class PromptVersionUpdate(BaseModel):
    label: str | None = None
    is_active: bool | None = None


class PromptVersionResponse(BaseModel):
    id: str
    prompt_id: str
    version_number: int
    label: str | None
    content: str
    system_message: str | None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class PromptResponse(BaseModel):
    id: str
    project_id: str
    name: str
    created_at: datetime
    updated_at: datetime
    versions: list[PromptVersionResponse] = []

    model_config = {"from_attributes": True}


class PromptListResponse(BaseModel):
    id: str
    project_id: str
    name: str
    created_at: datetime
    updated_at: datetime
    version_count: int = 0
    active_version: PromptVersionResponse | None = None

    model_config = {"from_attributes": True}
