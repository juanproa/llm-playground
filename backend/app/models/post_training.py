"""Post-Training module models: SFT, Feedback, Backtesting."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


# ─── Shared: Dataset ────────────────────────────────────────────────────────

class Dataset(Base):
    __tablename__ = "pt_datasets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    format: Mapped[str] = mapped_column(String(50), default="jsonl")  # jsonl, csv, alpaca, chatml
    item_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    project = relationship("Project")
    items: Mapped[list["DatasetItem"]] = relationship("DatasetItem", back_populates="dataset", cascade="all, delete-orphan")
    training_jobs: Mapped[list["TrainingJob"]] = relationship("TrainingJob", back_populates="dataset")


class DatasetItem(Base):
    __tablename__ = "pt_dataset_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    dataset_id: Mapped[str] = mapped_column(String(36), ForeignKey("pt_datasets.id"), nullable=False)
    instruction: Mapped[str | None] = mapped_column(Text, nullable=True)
    input_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    output_text: Mapped[str] = mapped_column(Text, nullable=False)
    system_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[str | None] = mapped_column(Text, nullable=True)  # comma-separated
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    dataset = relationship("Dataset", back_populates="items")


# ─── SFT: Training Jobs ────────────────────────────────────────────────────

class TrainingJob(Base):
    __tablename__ = "pt_training_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), nullable=False)
    dataset_id: Mapped[str] = mapped_column(String(36), ForeignKey("pt_datasets.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    base_model: Mapped[str] = mapped_column(String(255), nullable=False)  # Ollama model name
    backend: Mapped[str] = mapped_column(String(50), default="mlx_lm")  # backend-agnostic
    status: Mapped[str] = mapped_column(String(50), default="pending")  # pending, running, completed, failed, stopped
    # Hyperparameters stored as JSON
    hyperparams: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON: epochs, lr, batch_size, etc.
    output_dir: Mapped[str | None] = mapped_column(String(500), nullable=True)
    adapter_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    log_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    metrics_json: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON: loss curves, etc.
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    pid: Mapped[int | None] = mapped_column(Integer, nullable=True)  # subprocess PID
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    project = relationship("Project")
    dataset = relationship("Dataset", back_populates="training_jobs")


# ─── Feedback / RLHF ────────────────────────────────────────────────────────

class FeedbackRun(Base):
    __tablename__ = "pt_feedback_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    prompt_version_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("prompt_versions.id"), nullable=True)
    model_config_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("model_configs.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="draft")  # draft, collecting, completed
    item_count: Mapped[int] = mapped_column(Integer, default=0)
    reviewed_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    project = relationship("Project")
    prompt_version = relationship("PromptVersion")
    model_config = relationship("ModelConfig")
    items: Mapped[list["FeedbackItem"]] = relationship("FeedbackItem", back_populates="run", cascade="all, delete-orphan")


class FeedbackItem(Base):
    __tablename__ = "pt_feedback_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("pt_feedback_runs.id"), nullable=False)
    input_text: Mapped[str] = mapped_column(Text, nullable=False)
    model_output: Mapped[str | None] = mapped_column(Text, nullable=True)
    generation_status: Mapped[str] = mapped_column(String(50), default="pending")  # pending, generated, failed
    # Feedback fields
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1-5
    thumbs: Mapped[str | None] = mapped_column(String(10), nullable=True)  # up/down
    preferred_answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    corrected_output: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewer_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_tags: Mapped[str | None] = mapped_column(Text, nullable=True)  # comma-separated
    review_status: Mapped[str] = mapped_column(String(50), default="pending")  # pending, reviewed, skipped
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    run = relationship("FeedbackRun", back_populates="items")


# ─── Backtesting ─────────────────────────────────────────────────────────────

class TestCase(Base):
    __tablename__ = "pt_test_cases"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    input_text: Mapped[str] = mapped_column(Text, nullable=False)
    expected_output: Mapped[str] = mapped_column(Text, nullable=False)
    expected_type: Mapped[str] = mapped_column(String(50), default="generative")  # generative, classification, extraction, structured
    tags: Mapped[str | None] = mapped_column(Text, nullable=True)  # comma-separated
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_golden: Mapped[bool] = mapped_column(default=False)
    document_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("documents.id"), nullable=True)
    # Back-link to the knowledge-base item this case was materialised from (if any).
    # Legacy: KB items used to be the input source for Batch Compare.
    source_kb_item_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # Back-link to the InputDataset item this case was materialised from. Batch Compare
    # uses this for idempotent test-case creation when an InputDataset feeds the run.
    # NB: this points at `input_dataset_items.id` — NOT `pt_dataset_items.id` (SFT).
    source_input_dataset_item_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # JSON array of assertion specs; null → fall back to legacy whole-output scoring
    assertions: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Per-test-case pass threshold (0.0-1.0) when assertions are present.
    # Overall score = weighted average of assertion scores; passed iff overall >= threshold.
    pass_threshold: Mapped[float | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    project = relationship("Project")
    document = relationship("Document")
    results: Mapped[list["BacktestResult"]] = relationship("BacktestResult", back_populates="test_case")


class BacktestRun(Base):
    __tablename__ = "pt_backtest_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    prompt_version_id: Mapped[str] = mapped_column(String(36), ForeignKey("prompt_versions.id"), nullable=False)
    model_config_id: Mapped[str] = mapped_column(String(36), ForeignKey("model_configs.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="pending")  # pending, running, completed, failed
    pass_threshold: Mapped[float] = mapped_column(default=0.5)  # configurable per run
    # Optional LLM-as-judge: when set, score with this model instead of string similarity
    judge_model_config_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("model_configs.id"), nullable=True)
    total_cases: Mapped[int] = mapped_column(Integer, default=0)
    passed_cases: Mapped[int] = mapped_column(Integer, default=0)
    failed_cases: Mapped[int] = mapped_column(Integer, default=0)
    pass_rate: Mapped[float | None] = mapped_column(nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    project = relationship("Project")
    prompt_version = relationship("PromptVersion")
    model_config = relationship("ModelConfig", foreign_keys=[model_config_id])
    judge_model_config = relationship("ModelConfig", foreign_keys=[judge_model_config_id])
    results: Mapped[list["BacktestResult"]] = relationship("BacktestResult", back_populates="backtest_run", cascade="all, delete-orphan")


class BacktestResult(Base):
    __tablename__ = "pt_backtest_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    backtest_run_id: Mapped[str] = mapped_column(String(36), ForeignKey("pt_backtest_runs.id"), nullable=False)
    test_case_id: Mapped[str] = mapped_column(String(36), ForeignKey("pt_test_cases.id"), nullable=False)
    actual_output: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="pending")  # pending, passed, failed, error
    pass_score: Mapped[float | None] = mapped_column(nullable=True)  # 0.0-1.0 overall score
    # JSON array of per-assertion results (snapshotted at evaluation time)
    assertion_results: Mapped[str | None] = mapped_column(Text, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Whether this result came from the inference cache (skipped a real API call)
    cache_hit: Mapped[bool] = mapped_column(default=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    backtest_run = relationship("BacktestRun", back_populates="results")
    test_case = relationship("TestCase", back_populates="results")


# ─── Inference cache ─────────────────────────────────────────────────────────
# Keyed by the inputs that fully determine an output: (prompt_version, model,
# test_case, document, max_tokens, temperature).  Used to avoid re-calling
# commercial APIs when the user is just iterating on assertions.

class InferenceCache(Base):
    __tablename__ = "pt_inference_cache"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    # Components of the cache key
    prompt_version_id: Mapped[str] = mapped_column(String(36), nullable=False)
    model_config_id: Mapped[str] = mapped_column(String(36), nullable=False)
    test_case_id: Mapped[str] = mapped_column(String(36), nullable=False)
    document_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    max_tokens: Mapped[int] = mapped_column(Integer, default=0)
    temperature: Mapped[float] = mapped_column(default=0.0)
    # Cached output
    output: Mapped[str] = mapped_column(Text, nullable=False)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


# ─── Comparison Run (multi-model batch comparison) ──────────────────────────
# Orchestrates N child BacktestRuns, one per model.

class ComparisonRun(Base):
    __tablename__ = "pt_comparison_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    prompt_version_id: Mapped[str] = mapped_column(String(36), ForeignKey("prompt_versions.id"), nullable=False)
    # JSON arrays
    model_config_ids: Mapped[str] = mapped_column(Text, nullable=False)  # JSON list
    # Chain columns selected for this run. JSON list of chain_ids; null/empty = none.
    # Chain children are tracked alongside model children in `child_backtest_run_ids`
    # — the BacktestRun rows themselves carry `chain_id` to disambiguate.
    chain_ids: Mapped[str | None] = mapped_column(Text, nullable=True)
    test_case_ids: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON list; null = all
    child_backtest_run_ids: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON list
    # Optional per-model prompt overrides — JSON dict {model_config_id: prompt_version_id}.
    # When a model id is present here, its child run uses the override instead of
    # the parent prompt_version_id. Lets you compare a small model's tuned prompt
    # against a frontier model's tighter prompt in the same run.
    prompt_version_overrides: Mapped[str | None] = mapped_column(Text, nullable=True)

    judge_model_config_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("model_configs.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="pending")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


# ─── Comparison children/results/inputs (Batch Compare, hard-split) ─────────
# These tables are owned by Batch Compare. They intentionally do NOT reuse
# pt_backtest_runs / pt_test_cases / pt_backtest_results — Backtest is a
# separate user flow (assertions, pass thresholds, curated test cases) and
# leaking comparison runs into it polluted that surface.

class ComparisonInputItem(Base):
    """One input row in a comparison run (row dimension of the matrix)."""
    __tablename__ = "pt_comparison_input_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    comparison_run_id: Mapped[str] = mapped_column(String(36), ForeignKey("pt_comparison_runs.id"), nullable=False)
    input_text: Mapped[str] = mapped_column(Text, nullable=False)
    # Display label, copied from InputDatasetItem.name at create time. Null
    # when the row came from `input_texts` (ad-hoc) or the source item had no
    # name. Denormalized so the matrix renders without a join back to the
    # source dataset (which may be deleted later).
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Optional back-link to the InputDataset item this row was sourced from.
    # Points at `input_dataset_items.id` — NOT `pt_dataset_items.id` (SFT).
    source_input_dataset_item_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    ordering: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class ComparisonChild(Base):
    """One column of a comparison run — discriminated by `kind`.

    kind='model' → uses model_config_id + prompt_version_id.
    kind='chain' → uses chain_id (the other two are null)."""
    __tablename__ = "pt_comparison_children"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    comparison_run_id: Mapped[str] = mapped_column(String(36), ForeignKey("pt_comparison_runs.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    model_config_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("model_configs.id"), nullable=True)
    prompt_version_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("prompt_versions.id"), nullable=True)
    chain_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("chains.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="pending")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    ordering: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    model_config = relationship("ModelConfig")
    prompt_version = relationship("PromptVersion")


class ComparisonResult(Base):
    """One cell of a comparison run — one input × one column."""
    __tablename__ = "pt_comparison_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    child_id: Mapped[str] = mapped_column(String(36), ForeignKey("pt_comparison_children.id"), nullable=False)
    input_item_id: Mapped[str] = mapped_column(String(36), ForeignKey("pt_comparison_input_items.id"), nullable=False)
    actual_output: Mapped[str | None] = mapped_column(Text, nullable=True)
    # pending, completed, failed, no_judgment
    status: Mapped[str] = mapped_column(String(50), default="pending")
    pass_score: Mapped[float | None] = mapped_column(nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cache_hit: Mapped[bool] = mapped_column(default=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


# ─── Fusion Job (merge LoRA → full model → GGUF → Ollama) ────────────────────

class FusionJob(Base):
    __tablename__ = "pt_fusion_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("projects.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Source training job reference (optional — you can also fuse any adapter path manually)
    source_job_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("pt_training_jobs.id"), nullable=True)

    # Pipeline configuration
    backend: Mapped[str] = mapped_column(String(50), default="mlx_lm")  # mlx_lm, peft
    base_model: Mapped[str] = mapped_column(String(255), nullable=False)
    adapter_path: Mapped[str] = mapped_column(String(500), nullable=False)
    convert_to_gguf: Mapped[bool] = mapped_column(default=False)
    register_with_ollama: Mapped[bool] = mapped_column(default=False)
    ollama_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Outputs
    merged_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    gguf_path: Mapped[str | None] = mapped_column(String(500), nullable=True)

    status: Mapped[str] = mapped_column(String(50), default="pending")  # pending, running, completed, failed
    log_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
