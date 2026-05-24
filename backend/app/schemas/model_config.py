from pydantic import BaseModel
from datetime import datetime


class ModelConfigCreate(BaseModel):
    name: str
    provider: str
    model_id: str
    namespace: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    max_tokens: int = 4096
    temperature: float = 0.7
    extra_params: dict | None = None
    adapter_path: str | None = None
    # Defaults to True (use model's built-in default). When False, MLX/Qwen3
    # skips the <think>…</think> phase via chat_template_kwargs.
    enable_thinking: bool = True


class ModelConfigUpdate(BaseModel):
    name: str | None = None
    provider: str | None = None
    model_id: str | None = None
    namespace: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    max_tokens: int | None = None
    temperature: float | None = None
    extra_params: dict | None = None
    adapter_path: str | None = None
    enable_thinking: bool | None = None
    is_enabled: bool | None = None


class ModelConfigResponse(BaseModel):
    id: str
    name: str
    provider: str
    model_id: str
    namespace: str | None
    base_url: str | None
    max_tokens: int
    temperature: float
    extra_params: dict | None
    adapter_path: str | None = None
    enable_thinking: bool = True
    is_enabled: bool
    has_api_key: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
