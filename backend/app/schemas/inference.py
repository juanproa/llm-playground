from pydantic import BaseModel
from datetime import datetime


class InferenceRequest(BaseModel):
    prompt_version_id: str
    model_config_id: str
    document_id: str | None = None
    input_text: str = ""


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
