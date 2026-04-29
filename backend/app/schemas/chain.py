from datetime import datetime

from pydantic import BaseModel


class EdgeAssertion(BaseModel):
    # Deterministic text assertion on the source node's output.
    op: str  # "contains" | "equals" | "regex" | "startswith" | "endswith"
    value: str
    case_sensitive: bool = False
    negate: bool = False


class ChainNodeCreate(BaseModel):
    name: str
    position_x: float = 0.0
    position_y: float = 0.0
    prompt_version_id: str | None = None
    model_config_id: str | None = None
    kb_id: str | None = None
    kb_top_k: int | None = None
    kb_query_template: str | None = None
    input_text: str | None = None
    input_document_id: str | None = None


class ChainNodeUpdate(BaseModel):
    name: str | None = None
    position_x: float | None = None
    position_y: float | None = None
    prompt_version_id: str | None = None
    model_config_id: str | None = None
    kb_id: str | None = None
    kb_top_k: int | None = None
    kb_query_template: str | None = None
    input_text: str | None = None
    input_document_id: str | None = None


class ChainNodeResponse(BaseModel):
    id: str
    chain_id: str
    name: str
    position_x: float
    position_y: float
    prompt_version_id: str | None
    model_config_id: str | None
    kb_id: str | None
    kb_top_k: int | None
    kb_query_template: str | None
    input_text: str | None
    input_document_id: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ChainEdgeCreate(BaseModel):
    source_node_id: str
    target_node_id: str
    assertion: EdgeAssertion | None = None


class ChainEdgeUpdate(BaseModel):
    assertion: EdgeAssertion | None = None
    # Sentinel to clear an existing assertion (None on PATCH means "no change").
    clear_assertion: bool | None = None


class ChainEdgeResponse(BaseModel):
    id: str
    chain_id: str
    source_node_id: str
    target_node_id: str
    assertion: EdgeAssertion | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ChainCreate(BaseModel):
    name: str
    description: str | None = None


class ChainUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class ChainResponse(BaseModel):
    id: str
    project_id: str
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime
    nodes: list[ChainNodeResponse] = []
    edges: list[ChainEdgeResponse] = []

    model_config = {"from_attributes": True}


class ChainListItem(BaseModel):
    id: str
    project_id: str
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime
    node_count: int = 0
    edge_count: int = 0

    model_config = {"from_attributes": True}


# ─── Chain runs ────────────────────────────────────────────────────────────


class ChainNodeRunResponse(BaseModel):
    id: str
    run_id: str
    node_id: str
    status: str  # pending | running | completed | skipped | failed
    skip_reason: str | None
    resolved_input: str | None
    output_text: str | None
    error_message: str | None
    latency_ms: int | None
    inference_run_id: str | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ChainRunResponse(BaseModel):
    id: str
    chain_id: str
    status: str
    error_message: str | None
    final_output: str | None = None  # JSON string of {node_name: output}
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    node_runs: list[ChainNodeRunResponse] = []

    model_config = {"from_attributes": True}


class ChainRunListItem(BaseModel):
    id: str
    chain_id: str
    status: str
    error_message: str | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}
