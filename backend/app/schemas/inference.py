from pydantic import BaseModel
from datetime import datetime


class InferenceRequest(BaseModel):
    prompt_version_id: str
    model_config_id: str
    document_id: str | None = None
    input_text: str = ""
    # Optional RAG override — when the request sets `kb_id` / `kb_top_k`, they
    # take precedence. Otherwise the backend falls back to the prompt
    # version's kb_id / kb_top_k. Pass `rag_override_none=true` to explicitly
    # disable RAG for this call even if the prompt has a bound KB.
    kb_id: str | None = None
    kb_top_k: int | None = None
    rag_override_none: bool = False


class InferenceRunResponse(BaseModel):
    id: str
    project_id: str
    prompt_version_id: str
    model_config_id: str
    document_id: str | None
    input_text: str
    output_text: str | None
    status: str
    error_message: str | None
    latency_ms: int | None
    token_usage_input: int | None
    token_usage_output: int | None
    cost_estimate_usd: float | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}
