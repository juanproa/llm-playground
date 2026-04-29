import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Chain(Base):
    __tablename__ = "chains"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    nodes = relationship("ChainNode", back_populates="chain", cascade="all, delete-orphan")
    edges = relationship("ChainEdge", back_populates="chain", cascade="all, delete-orphan")
    # Past runs reference this chain via FK; without this cascade SQLite blocks
    # `DELETE FROM chains` for any chain that has been executed at least once.
    runs = relationship("ChainRun", back_populates="chain", cascade="all, delete-orphan")


class ChainNode(Base):
    __tablename__ = "chain_nodes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    chain_id: Mapped[str] = mapped_column(String(36), ForeignKey("chains.id"), nullable=False)
    # Human-readable name so a user can refer to the node's output as {{node_name.output}}.
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    position_x: Mapped[float] = mapped_column(Float, default=0.0)
    position_y: Mapped[float] = mapped_column(Float, default=0.0)

    # The Workspace triplet — all nullable because a freshly-placed node may be
    # unconfigured until the user picks a prompt/model in Phase 2.
    prompt_version_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    model_config_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # Per-node RAG override (falls back to prompt version's binding when null).
    kb_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    kb_top_k: Mapped[int | None] = mapped_column(nullable=True)
    # Explicit retrieval-query template for RAG. Supports `{{node.output}}`
    # references to upstream nodes. When null, the executor falls back to
    # `input_text or resolved_prompt_content[:1000]` (legacy behavior).
    # Use case: a "query generator" node produces a sharp lookup string,
    # and the downstream RAG node consumes it via `{{QueryGen.output}}`.
    kb_query_template: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Only root nodes carry a literal input; downstream nodes reference upstream
    # via {{node.output}} templating in their prompt content.
    # Mirrors the Workspace input panel: free-form text and/or an attached
    # document (PDF / dataset item) — the executor concats both into the user
    # message just like single-shot inference does.
    input_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    input_document_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    chain = relationship("Chain", back_populates="nodes")


class ChainEdge(Base):
    __tablename__ = "chain_edges"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    chain_id: Mapped[str] = mapped_column(String(36), ForeignKey("chains.id"), nullable=False)
    source_node_id: Mapped[str] = mapped_column(String(36), ForeignKey("chain_nodes.id"), nullable=False)
    target_node_id: Mapped[str] = mapped_column(String(36), ForeignKey("chain_nodes.id"), nullable=False)

    # Deterministic text assertion on the source node's output.
    # Shape: {"op": "contains"|"equals"|"regex"|"startswith"|"endswith", "value": "<string>",
    #         "case_sensitive": bool, "negate": bool}
    # Null = unconditional edge. Stored as JSON text for SQLite simplicity.
    assertion_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    chain = relationship("Chain", back_populates="edges")


class ChainRun(Base):
    """One execution of a chain — captures top-level state and artifacts.

    Per-node artifacts live in ChainNodeRun rows linked to this run.
    """

    __tablename__ = "chain_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    chain_id: Mapped[str] = mapped_column(String(36), ForeignKey("chains.id"), nullable=False)
    # status: pending | running | completed | failed
    status: Mapped[str] = mapped_column(String(20), default="pending")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    # JSON map of every node's output, keyed by node name. The "single result"
    # of the chain — consumed downstream (e.g. Batch Compare using a chain as
    # the runnable). Populated when the run reaches a terminal state.
    final_output: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Optional per-run override for the *root* node's input_text. Set by
    # callers that want to run the chain against a specific input without
    # mutating the saved chain (e.g. Batch Compare feeding a TestCase's
    # input_text into the chain). Null → root nodes use their own input_text.
    input_override: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    chain = relationship("Chain", back_populates="runs")
    node_runs = relationship(
        "ChainNodeRun",
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="ChainNodeRun.created_at.asc()",
    )


class ChainNodeRun(Base):
    """Per-node execution record. Created up front (status=pending) so the UI
    can render the full graph state immediately, then transitioned as work flows.
    """

    __tablename__ = "chain_node_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("chain_runs.id"), nullable=False)
    node_id: Mapped[str] = mapped_column(String(36), ForeignKey("chain_nodes.id"), nullable=False)
    # status: pending | running | completed | skipped | failed
    status: Mapped[str] = mapped_column(String(20), default="pending")
    skip_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Resolved input that actually went into the model (after template substitution).
    resolved_input: Mapped[str | None] = mapped_column(Text, nullable=True)
    output_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(nullable=True)
    # For traceability — the underlying InferenceRun row, if we created one.
    inference_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    run = relationship("ChainRun", back_populates="node_runs")
