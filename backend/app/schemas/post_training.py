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
    # `name` and provenance columns are curation metadata, never read by the
    # training pipeline. See DatasetItem model docstring.
    name: str | None = None
    instruction: str | None = None
    input_text: str | None = None
    output_text: str
    system_message: str | None = None
    tags: str | None = None
    metadata_json: str | None = None
    source_test_case_id: str | None = None
    parent_item_id: str | None = None
    verified_status: str | None = None


class DatasetItemUpdate(BaseModel):
    """Partial update for a single DatasetItem.

    All fields are optional and use `model_dump(exclude_unset=True)` semantics
    on the router side: omitted fields are left untouched, present-but-null
    fields explicitly clear the column. `output_text` cannot be set to null
    (NOT NULL in DB) — the router validates this.
    """
    name: str | None = None
    instruction: str | None = None
    input_text: str | None = None
    output_text: str | None = None
    system_message: str | None = None
    tags: str | None = None
    metadata_json: str | None = None
    source_test_case_id: str | None = None
    parent_item_id: str | None = None
    verified_status: str | None = None


class BulkSetSystemRequest(BaseModel):
    """Set `system_message` on every item in a dataset.

    - `system_message` may be null to clear.
    - When `overwrite` is False (default), items that already have a non-empty
      system_message are left alone.
    """
    system_message: str | None
    overwrite: bool = False


class DatasetItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    dataset_id: str
    name: str | None
    instruction: str | None
    input_text: str | None
    output_text: str
    system_message: str | None
    tags: str | None
    metadata_json: str | None
    source_test_case_id: str | None
    parent_item_id: str | None
    verified_status: str | None
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
    input_text: str  # PII-safe at API boundary (test_case_pii_service swaps in masked content)
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
    # PII masking state on this test case itself (parallel to InputDatasetItem):
    #   unchecked | clean | masked
    # NB: pii_masked_content is intentionally omitted from the response — the
    # masked text is exposed via input_text, same pattern as InputDatasetItem.
    pii_status: str = "unchecked"
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
    reverse_order: bool = False


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
    reverse_order: bool = False
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


# ─── Synthetic Data Generation (Phase 3) ───────────────────────────────────

class SyntheticJobCreate(BaseModel):
    """Kick off LLM-driven generation of variations into a NEW dataset.

    The source dataset is never mutated — a brand-new dataset is created and
    populated as the job runs.
    """
    name: str
    source_dataset_id: str
    model_config_id: str
    # Prompt template; the worker substitutes {input_text} and {output_text}
    # per item before sending to the LLM.
    variation_prompt: str
    # Map of tag → variant count. The reserved key "_default" applies to items
    # with no matching tag. Max wins when an item carries multiple matching
    # tags. Counts must be ≥ 0; 0 means "skip variants for these items".
    tag_multipliers: dict[str, int]


class SyntheticJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    name: str
    source_dataset_id: str | None
    target_dataset_id: str | None
    model_config_id: str | None
    variation_prompt: str
    tag_multipliers: str  # JSON string — frontend parses
    status: str
    total_planned: int
    completed_count: int
    failed_count: int
    error_message: str | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime


# ═══════════════════════════════════════════════════════════════════════════════
# DATASET STUDIO (transformations on pt_datasets)
# ═══════════════════════════════════════════════════════════════════════════════


class CleanupRuleInfo(BaseModel):
    """Built-in cleanup rule metadata (frontend renders these as togglable checkboxes)."""
    id: str
    name: str
    description: str
    tier: int
    default_on: bool
    type: str  # "regex" | "function"
    pattern: str | None = None  # for "regex" type only — shown in tooltip


class CustomRuleSpec(BaseModel):
    """User-supplied ephemeral regex rule. Not persisted."""
    pattern: str
    replacement: str = ""
    name: str = "custom"
    multiline: bool = False  # convenience: sets re.MULTILINE flag


class CleanupPreviewRequest(BaseModel):
    """Body for /dataset-studio/preview-cleanup."""
    source_dataset_id: str
    enabled_rule_ids: list[str]
    custom_rules: list[CustomRuleSpec] = []
    sample_size: int = 3


class CleanupSample(BaseModel):
    id: str
    name: str | None
    before: str
    after: str
    chars_before: int
    chars_after: int


class CleanupPreviewResponse(BaseModel):
    samples: list[CleanupSample]
    total_chars_before: int
    total_chars_after: int
    total_items: int
    estimated_savings_pct: float


class ApplyCleanupRequest(BaseModel):
    """Body for /dataset-studio/apply-cleanup."""
    source_dataset_id: str
    enabled_rule_ids: list[str]
    custom_rules: list[CustomRuleSpec] = []
    new_name: str
    new_description: str | None = None


class ApplyCleanupResponse(BaseModel):
    dataset: DatasetResponse
    items: int
    input_chars_before: int
    input_chars_after: int


class MergeDatasetsRequest(BaseModel):
    """Body for /dataset-studio/merge."""
    source_dataset_ids: list[str]
    new_name: str
    new_description: str | None = None
    dedup_strategy: str = "none"  # "none" | "exact" | "input_only"


class TokenStatsRequest(BaseModel):
    """Body for /dataset-studio/token-stats."""
    dataset_id: str
    model_id: str  # HuggingFace repo id, e.g. "Qwen/Qwen3-4B-FP8"


class TokenStatsItemEntry(BaseModel):
    id: str
    name: str | None
    token_count: int


class TokenStatsResponse(BaseModel):
    total_items: int
    tokenizer_loaded: bool
    model_id: str
    stats: dict[str, int] = {}  # min, max, mean, p50, p75, p90, p95, p99
    items: list[TokenStatsItemEntry] = []
    histogram: dict[str, list[int]] = {"bin_edges": [], "counts": []}
    error: str | None = None


class FilterByTokensRequest(BaseModel):
    """Body for /dataset-studio/filter-by-tokens."""
    source_dataset_id: str
    model_id: str
    max_tokens: int
    new_name: str
    new_description: str | None = None


class FilterByTokensResponse(BaseModel):
    dataset: DatasetResponse
    kept: int
    dropped: int
    total: int
