"""Post-Training module Pydantic v2 schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


# ─── Dataset ────────────────────────────────────────────────────────────────

class DatasetCreate(BaseModel):
    name: str
    description: str | None = None
    format: str = "jsonl"


class DatasetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    name: str
    description: str | None
    format: str
    item_count: int
    created_at: datetime
    updated_at: datetime


class DatasetItemCreate(BaseModel):
    instruction: str | None = None
    input_text: str | None = None
    output_text: str
    system_message: str | None = None
    tags: str | None = None
    metadata_json: str | None = None


class DatasetItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    dataset_id: str
    instruction: str | None
    input_text: str | None
    output_text: str
    system_message: str | None
    tags: str | None
    metadata_json: str | None
    created_at: datetime


class DatasetWithItemsResponse(DatasetResponse):
    items: list[DatasetItemResponse] = []


# ─── Training Job (SFT) ──────────────────────────────────────────────────────

class TrainingJobCreate(BaseModel):
    project_id: str
    dataset_id: str
    name: str
    base_model: str
    backend: str = "mlx_lm"
    hyperparams: dict[str, Any] | None = None


class TrainingJobUpdate(BaseModel):
    name: str | None = None
    status: str | None = None
    log_text: str | None = None
    metrics_json: str | None = None
    error_message: str | None = None


class TrainingJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    dataset_id: str
    name: str
    base_model: str
    backend: str
    status: str
    hyperparams: str | None
    output_dir: str | None
    adapter_path: str | None
    log_text: str | None
    metrics_json: str | None
    error_message: str | None
    pid: int | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime


# ─── Feedback Run ────────────────────────────────────────────────────────────

class FeedbackRunCreate(BaseModel):
    name: str
    description: str | None = None
    prompt_version_id: str | None = None
    model_config_id: str | None = None


class FeedbackRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    name: str
    description: str | None
    prompt_version_id: str | None
    model_config_id: str | None
    status: str
    item_count: int
    reviewed_count: int
    created_at: datetime
    updated_at: datetime


class FeedbackItemCreate(BaseModel):
    input_text: str


class FeedbackItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    run_id: str
    input_text: str
    model_output: str | None
    generation_status: str
    rating: int | None
    thumbs: str | None
    preferred_answer: str | None
    corrected_output: str | None
    reviewer_comment: str | None
    error_tags: str | None
    review_status: str
    reviewed_at: datetime | None
    created_at: datetime


class FeedbackRunWithItemsResponse(FeedbackRunResponse):
    items: list[FeedbackItemResponse] = []


class FeedbackSubmit(BaseModel):
    rating: int | None = None
    thumbs: str | None = None
    preferred_answer: str | None = None
    corrected_output: str | None = None
    reviewer_comment: str | None = None
    error_tags: str | None = None
    review_status: str = "reviewed"  # reviewed or skipped


# ─── Test Cases ──────────────────────────────────────────────────────────────

class AssertionSpec(BaseModel):
    """One assertion describing how to check a field of the model output.

    Stored as part of TestCase.assertions (JSON list) and echoed back in results.
    """
    name: str
    type: str  # json_path_exact | json_path_numeric | json_path_contains | llm_judge
    path: str | None = None
    expected: Any | None = None
    weight: float = 1.0
    options: dict[str, Any] | None = None


class TestCaseCreate(BaseModel):
    name: str
    input_text: str
    expected_output: str
    expected_type: str = "generative"
    tags: str | None = None
    notes: str | None = None
    is_golden: bool = False
    document_id: str | None = None
    assertions: list[AssertionSpec] | None = None
    pass_threshold: float | None = None


class TestCaseUpdate(BaseModel):
    name: str | None = None
    input_text: str | None = None
    expected_output: str | None = None
    expected_type: str | None = None
    tags: str | None = None
    notes: str | None = None
    is_golden: bool | None = None
    assertions: list[AssertionSpec] | None = None
    pass_threshold: float | None = None


class TestCaseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    name: str
    input_text: str
    expected_output: str
    expected_type: str
    tags: str | None
    notes: str | None
    is_golden: bool
    document_id: str | None
    source_kb_item_id: str | None = None
    source_input_dataset_item_id: str | None = None
    assertions: str | None = None  # raw JSON string; frontend parses it
    pass_threshold: float | None = None
    created_at: datetime
    updated_at: datetime


# ─── Backtest Run ────────────────────────────────────────────────────────────

class BacktestRunCreate(BaseModel):
    name: str
    prompt_version_id: str
    model_config_id: str
    pass_threshold: float = 0.5  # 0.0-1.0, default 50%
    # When set, uses this model to grade each result (LLM-as-judge) instead of string matching
    judge_model_config_id: str | None = None
    test_case_ids: list[str] | None = None  # None = use all project test cases


class BacktestRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    name: str
    prompt_version_id: str
    model_config_id: str
    status: str
    pass_threshold: float
    judge_model_config_id: str | None = None
    total_cases: int
    passed_cases: int
    failed_cases: int
    pass_rate: float | None
    error_message: str | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime


class BacktestResultResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    backtest_run_id: str
    test_case_id: str
    actual_output: str | None
    status: str
    pass_score: float | None
    assertion_results: str | None = None  # JSON string, parsed client-side
    cache_hit: bool = False
    latency_ms: int | None
    error_message: str | None
    created_at: datetime
    test_case: TestCaseResponse | None = None


class BacktestRunWithResultsResponse(BacktestRunResponse):
    results: list[BacktestResultResponse] = []


# ─── Fusion Job ──────────────────────────────────────────────────────────────

class FusionJobCreate(BaseModel):
    name: str
    project_id: str | None = None
    backend: str = "mlx_lm"
    base_model: str
    adapter_path: str
    source_job_id: str | None = None
    convert_to_gguf: bool = False
    register_with_ollama: bool = False
    ollama_name: str | None = None


class FusionJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str | None
    name: str
    source_job_id: str | None
    backend: str
    base_model: str
    adapter_path: str
    convert_to_gguf: bool
    register_with_ollama: bool
    ollama_name: str | None
    merged_path: str | None
    gguf_path: str | None
    status: str
    log_text: str | None
    error_message: str | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime


# ─── Artifacts ───────────────────────────────────────────────────────────────

class ArtifactInfo(BaseModel):
    job_id: str
    path: str
    adapter_path: str | None = None
    size_bytes: int
    modified_at: str


class FusionArtifactInfo(BaseModel):
    fusion_id: str
    path: str
    size_bytes: int
    modified_at: str


# ─── Training backends / catalog ─────────────────────────────────────────────

class TrainingBackendInfo(BaseModel):
    name: str
    label: str
    description: str
    available: bool


class MlxModelInfo(BaseModel):
    id: str
    name: str
    size: str
    family: str
    quantization: str
    hf_original: str | None = None
    notes: str | None = None


class HfModelInfo(BaseModel):
    id: str
    name: str
    size: str
    family: str


# ─── Comparison Run (Batch Compare — hard-split from Backtest) ──────────────
#
# Unlike Backtest, Batch Compare:
#   • has no curated TestCases — inputs are ad-hoc text or pulled from an
#     InputDataset, stored in pt_comparison_input_items
#   • has no assertions / pass thresholds — judge model is optional
#   • supports two column kinds: 'model' (prompt+model) and 'chain'
#
# Wire shape:
#   ComparisonRunWithChildrenResponse
#     ├── input_items: ComparisonInputItemResponse[]
#     └── children: ComparisonChildResponse[]
#           └── results: ComparisonResultResponse[]   (one per input_item)


class ComparisonRunCreate(BaseModel):
    name: str
    # Default prompt for model children that don't have an override.
    # Required when at least one model_config_id is present without an override.
    prompt_version_id: str | None = None
    model_config_ids: list[str] = []
    chain_ids: list[str] | None = None
    # Optional per-model prompt overrides — {model_config_id: prompt_version_id}
    prompt_version_overrides: dict[str, str] | None = None
    # Inputs — use ONE of these:
    #   input_dataset_id [+ optional input_dataset_item_ids]: pull rows from
    #     the global InputDataset table (`input_datasets` — NOT `pt_datasets`).
    #   input_texts: ad-hoc free-text rows entered by the user.
    # Required: at least one row.
    input_dataset_id: str | None = None
    input_dataset_item_ids: list[str] | None = None
    input_texts: list[str] | None = None
    judge_model_config_id: str | None = None


class ComparisonInputItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    comparison_run_id: str
    input_text: str
    name: str | None = None
    source_input_dataset_item_id: str | None = None
    ordering: int
    created_at: datetime


class ComparisonResultResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    child_id: str
    input_item_id: str
    actual_output: str | None
    status: str  # pending, completed, failed, no_judgment, cancelled
    pass_score: float | None
    latency_ms: int | None
    cache_hit: bool = False
    error_message: str | None
    created_at: datetime


class ComparisonChildResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    comparison_run_id: str
    kind: str  # 'model' | 'chain'
    model_config_id: str | None
    prompt_version_id: str | None
    chain_id: str | None
    status: str
    error_message: str | None
    ordering: int
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    results: list[ComparisonResultResponse] = []


class ComparisonRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    name: str
    prompt_version_id: str  # default prompt (FK still NOT NULL on legacy table)
    judge_model_config_id: str | None
    status: str
    error_message: str | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime


class ComparisonRunWithChildrenResponse(ComparisonRunResponse):
    """Full matrix payload — children (columns) × input_items (rows)."""
    input_items: list[ComparisonInputItemResponse] = []
    children: list[ComparisonChildResponse] = []
