from pydantic import BaseModel


class PromptBuilderRequest(BaseModel):
    run_id: str
    user_question: str
    helper_model_config_id: str | None = None


class PromptBuilderResponse(BaseModel):
    reasoning: str
    suggestion: str  # "improve_prompt" | "no_change" | "error"
    proposed_prompt: str | None = None
    explanation: str | None = None
    error_message: str | None = None


class ApproveChangeRequest(BaseModel):
    run_id: str
    proposed_prompt: str
    explanation: str


class ApproveChangeResponse(BaseModel):
    version_id: str
    version_number: int
    new_run_id: str
    new_run_output: str | None
    error_message: str | None = None
