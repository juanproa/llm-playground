"""Chat Pydantic schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ChatSessionCreate(BaseModel):
    name: str
    model_config_id: str
    system_prompt: str | None = None


class ChatSessionUpdate(BaseModel):
    name: str | None = None
    model_config_id: str | None = None
    system_prompt: str | None = None


class ChatSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    model_config_id: str
    system_prompt: str | None
    created_at: datetime
    updated_at: datetime


class ChatMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    session_id: str
    role: str
    content: str
    tokens_in: int | None
    tokens_out: int | None
    latency_ms: int | None
    error_message: str | None
    created_at: datetime


class ChatSessionWithMessagesResponse(ChatSessionResponse):
    messages: list[ChatMessageResponse] = []


class ChatTurnRequest(BaseModel):
    content: str
