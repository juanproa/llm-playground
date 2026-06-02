import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import settings
from app.database import Base, engine
from app.routers import health, projects, prompts, documents, models, inference, post_training, knowledge_base, chat, input_datasets, chains, prompt_builder

# Import post-training models so Base.metadata.create_all picks them up
from app.models.post_training import (  # noqa: F401
    Dataset,
    DatasetItem,
    TrainingJob,
    FeedbackRun,
    FeedbackItem,
    TestCase,
    BacktestRun,
    BacktestResult,
    FusionJob,
    InferenceCache,
    ComparisonRun,
    ComparisonChild,
    ComparisonResult,
    ComparisonInputItem,
)
from app.models.knowledge_base import KnowledgeBase, KnowledgeBaseItem, KnowledgeBaseChunk  # noqa: F401
from app.models.input_dataset import InputDataset, InputDatasetItem  # noqa: F401
from app.models.chat import ChatSession, ChatMessage  # noqa: F401
from app.models.chain import Chain, ChainNode, ChainEdge, ChainRun, ChainNodeRun  # noqa: F401

logger = logging.getLogger(__name__)


def _run_migrations(conn) -> None:
    """Lightweight column-add migrations for SQLite (create_all won't add cols to existing tables)."""
    migrations = [
        ("pt_backtest_runs", "pass_threshold", "ALTER TABLE pt_backtest_runs ADD COLUMN pass_threshold FLOAT DEFAULT 0.5"),
        ("pt_backtest_runs", "judge_model_config_id", "ALTER TABLE pt_backtest_runs ADD COLUMN judge_model_config_id VARCHAR(36)"),
        ("pt_backtest_runs", "input_signature", "ALTER TABLE pt_backtest_runs ADD COLUMN input_signature VARCHAR(64)"),
        ("pt_backtest_runs", "reverse_order", "ALTER TABLE pt_backtest_runs ADD COLUMN reverse_order BOOLEAN DEFAULT 0"),
        ("pt_inference_cache", "input_hash", "ALTER TABLE pt_inference_cache ADD COLUMN input_hash VARCHAR(64)"),
        ("pt_test_cases", "pii_status", "ALTER TABLE pt_test_cases ADD COLUMN pii_status VARCHAR(20) DEFAULT 'unchecked'"),
        ("pt_test_cases", "pii_masked_content", "ALTER TABLE pt_test_cases ADD COLUMN pii_masked_content TEXT"),
        ("model_configs", "adapter_path", "ALTER TABLE model_configs ADD COLUMN adapter_path VARCHAR(500)"),
        ("model_configs", "enable_thinking", "ALTER TABLE model_configs ADD COLUMN enable_thinking BOOLEAN DEFAULT 1"),
        ("model_configs", "top_p", "ALTER TABLE model_configs ADD COLUMN top_p FLOAT"),
        ("model_configs", "top_k", "ALTER TABLE model_configs ADD COLUMN top_k INTEGER"),
        ("model_configs", "min_p", "ALTER TABLE model_configs ADD COLUMN min_p FLOAT"),
        ("model_configs", "yarn_factor", "ALTER TABLE model_configs ADD COLUMN yarn_factor FLOAT"),
        ("model_configs", "yarn_original_max_position_embeddings", "ALTER TABLE model_configs ADD COLUMN yarn_original_max_position_embeddings INTEGER"),
        ("model_configs", "q_bits", "ALTER TABLE model_configs ADD COLUMN q_bits INTEGER"),
        ("model_configs", "q_group_size", "ALTER TABLE model_configs ADD COLUMN q_group_size INTEGER"),
        ("model_configs", "kv_bits", "ALTER TABLE model_configs ADD COLUMN kv_bits INTEGER"),
        ("model_configs", "kv_group_size", "ALTER TABLE model_configs ADD COLUMN kv_group_size INTEGER"),
        ("model_configs", "max_kv_size", "ALTER TABLE model_configs ADD COLUMN max_kv_size INTEGER"),
        ("pt_test_cases", "assertions", "ALTER TABLE pt_test_cases ADD COLUMN assertions TEXT"),
        ("pt_test_cases", "pass_threshold", "ALTER TABLE pt_test_cases ADD COLUMN pass_threshold FLOAT"),
        ("pt_test_cases", "source_kb_item_id", "ALTER TABLE pt_test_cases ADD COLUMN source_kb_item_id VARCHAR(36)"),
        ("pt_test_cases", "source_input_dataset_item_id", "ALTER TABLE pt_test_cases ADD COLUMN source_input_dataset_item_id VARCHAR(36)"),
        ("pt_backtest_results", "assertion_results", "ALTER TABLE pt_backtest_results ADD COLUMN assertion_results TEXT"),
        ("pt_backtest_results", "cache_hit", "ALTER TABLE pt_backtest_results ADD COLUMN cache_hit BOOLEAN DEFAULT 0"),
        # Knowledge Base RAG columns — added when RAG support was introduced.
        ("knowledge_bases", "embedding_provider", "ALTER TABLE knowledge_bases ADD COLUMN embedding_provider VARCHAR(50) DEFAULT 'mlx_local'"),
        ("knowledge_bases", "embedding_model", "ALTER TABLE knowledge_bases ADD COLUMN embedding_model VARCHAR(255) DEFAULT 'mlx-community/Qwen3-Embedding-0.6B-4bit-DWQ'"),
        ("knowledge_bases", "embedding_dim", "ALTER TABLE knowledge_bases ADD COLUMN embedding_dim INTEGER"),
        ("knowledge_bases", "chunk_size_tokens", "ALTER TABLE knowledge_bases ADD COLUMN chunk_size_tokens INTEGER DEFAULT 800"),
        ("knowledge_bases", "chunk_overlap_tokens", "ALTER TABLE knowledge_bases ADD COLUMN chunk_overlap_tokens INTEGER DEFAULT 100"),
        ("knowledge_bases", "chunk_count", "ALTER TABLE knowledge_bases ADD COLUMN chunk_count INTEGER DEFAULT 0"),
        ("knowledge_bases", "dictionary_content", "ALTER TABLE knowledge_bases ADD COLUMN dictionary_content TEXT"),
        ("knowledge_bases", "dictionary_filename", "ALTER TABLE knowledge_bases ADD COLUMN dictionary_filename VARCHAR(500)"),
        ("knowledge_base_items", "metadata_json", "ALTER TABLE knowledge_base_items ADD COLUMN metadata_json TEXT"),
        ("knowledge_base_items", "embedding_status", "ALTER TABLE knowledge_base_items ADD COLUMN embedding_status VARCHAR(20) DEFAULT 'pending'"),
        ("knowledge_base_items", "embedding_error", "ALTER TABLE knowledge_base_items ADD COLUMN embedding_error TEXT"),
        ("knowledge_base_items", "parse_status", "ALTER TABLE knowledge_base_items ADD COLUMN parse_status VARCHAR(20) DEFAULT 'ready'"),
        ("knowledge_base_items", "parse_error", "ALTER TABLE knowledge_base_items ADD COLUMN parse_error TEXT"),
        # Prompt-version RAG defaults
        ("prompt_versions", "kb_id", "ALTER TABLE prompt_versions ADD COLUMN kb_id VARCHAR(36)"),
        ("prompt_versions", "kb_top_k", "ALTER TABLE prompt_versions ADD COLUMN kb_top_k INTEGER DEFAULT 5"),
        # InputDatasetItem PDF support
        ("input_dataset_items", "source_type", "ALTER TABLE input_dataset_items ADD COLUMN source_type VARCHAR(50) DEFAULT 'text'"),
        ("input_dataset_items", "mime_type", "ALTER TABLE input_dataset_items ADD COLUMN mime_type VARCHAR(100)"),
        ("input_dataset_items", "file_size_bytes", "ALTER TABLE input_dataset_items ADD COLUMN file_size_bytes INTEGER"),
        ("input_dataset_items", "parse_status", "ALTER TABLE input_dataset_items ADD COLUMN parse_status VARCHAR(20) DEFAULT 'ready'"),
        ("input_dataset_items", "parse_error", "ALTER TABLE input_dataset_items ADD COLUMN parse_error TEXT"),
        # Chain node now carries an optional document attachment alongside text input
        ("chain_nodes", "input_document_id", "ALTER TABLE chain_nodes ADD COLUMN input_document_id VARCHAR(36)"),
        # Explicit RAG retrieval-query template per chain node (supports {{node.output}} refs).
        ("chain_nodes", "kb_query_template", "ALTER TABLE chain_nodes ADD COLUMN kb_query_template TEXT"),
        # Chain runs gain a compiled JSON of every node's output (used as the chain's "single result").
        ("chain_runs", "final_output", "ALTER TABLE chain_runs ADD COLUMN final_output TEXT"),
        # Per-model prompt overrides on a comparison run
        ("pt_comparison_runs", "prompt_version_overrides", "ALTER TABLE pt_comparison_runs ADD COLUMN prompt_version_overrides TEXT"),
        # Track file paths for PDFs so we can retry parsing
        ("input_dataset_items", "file_path", "ALTER TABLE input_dataset_items ADD COLUMN file_path VARCHAR(500)"),
        # LLM-driven quality evaluation on parsed items
        ("input_dataset_items", "quality_status", "ALTER TABLE input_dataset_items ADD COLUMN quality_status VARCHAR(20) DEFAULT 'unchecked'"),
        ("input_dataset_items", "quality_reason", "ALTER TABLE input_dataset_items ADD COLUMN quality_reason TEXT"),
        ("input_datasets", "eval_status", "ALTER TABLE input_datasets ADD COLUMN eval_status VARCHAR(20) DEFAULT 'idle'"),
        ("input_dataset_items", "pii_status", "ALTER TABLE input_dataset_items ADD COLUMN pii_status VARCHAR(20) DEFAULT 'unchecked'"),
        ("input_dataset_items", "pii_masked_content", "ALTER TABLE input_dataset_items ADD COLUMN pii_masked_content TEXT"),
        ("input_datasets", "mask_status", "ALTER TABLE input_datasets ADD COLUMN mask_status VARCHAR(20) DEFAULT 'idle'"),
        # Batch Compare can use a Chain as a column (one chain == one runnable producing
        # one output per test case). chain_id on the BacktestRun child + chain_ids JSON
        # list on the parent ComparisonRun parallel the existing model_config columns.
        ("pt_backtest_runs", "chain_id", "ALTER TABLE pt_backtest_runs ADD COLUMN chain_id VARCHAR(36)"),
        ("pt_comparison_runs", "chain_ids", "ALTER TABLE pt_comparison_runs ADD COLUMN chain_ids TEXT"),
        # Per-run override for a chain's root input — Batch Compare feeds TestCase.input_text in here.
        ("chain_runs", "input_override", "ALTER TABLE chain_runs ADD COLUMN input_override TEXT"),
        # Display label for Batch Compare rows, copied from InputDatasetItem.name at create time.
        ("pt_comparison_input_items", "name", "ALTER TABLE pt_comparison_input_items ADD COLUMN name VARCHAR(255)"),
        # SFT DatasetItem enrichment (Phase 1): per-item label + provenance back-link
        # to TestCase, plus a self-link reserved for synthetic-data Phase 3.
        # These are curation/analysis metadata only — NOT written to training JSONL.
        ("pt_dataset_items", "name", "ALTER TABLE pt_dataset_items ADD COLUMN name VARCHAR(255)"),
        ("pt_dataset_items", "source_test_case_id", "ALTER TABLE pt_dataset_items ADD COLUMN source_test_case_id VARCHAR(36)"),
        ("pt_dataset_items", "parent_item_id", "ALTER TABLE pt_dataset_items ADD COLUMN parent_item_id VARCHAR(36)"),
        # Phase 3 (synthetic data): per-variant verification state. Null for
        # non-synthetic items. The pt_synthetic_jobs table itself is created
        # by Base.metadata.create_all (brand-new table, not an ALTER).
        ("pt_dataset_items", "verified_status", "ALTER TABLE pt_dataset_items ADD COLUMN verified_status VARCHAR(20)"),
    ]
    for table, column, ddl in migrations:
        try:
            conn.execute(text(f"SELECT {column} FROM {table} LIMIT 1"))
        except Exception:
            try:
                conn.execute(text(ddl))
                logger.info("Migration: added %s.%s", table, column)
            except Exception as e:
                logger.warning("Migration failed for %s.%s: %s", table, column, e)

    # One-shot cleanup: Batch Compare used to write into pt_backtest_runs /
    # pt_test_cases, polluting the Backtest UI. The schema is now hard-split
    # into pt_comparison_children / _results / _input_items. Old comparison
    # runs can't be displayed under the new code, so drop them along with
    # the BacktestRun rows they spawned. Idempotent.
    import json as _json
    stale_comparison_ids = [
        "36a72970-8ac1-4537-bc0b-f0a3d2f63412",
        "e182c072-f147-4bac-a51a-25e8e0c76bb9",
        "842f1a4a-e0e1-46ca-9b38-03c7c2c3047b",
    ]
    try:
        bt_ids: list[str] = []
        removed = 0
        for cid in stale_comparison_ids:
            row = conn.execute(
                text("SELECT child_backtest_run_ids FROM pt_comparison_runs WHERE id = :id"),
                {"id": cid},
            ).fetchone()
            if not row:
                continue
            removed += 1
            (raw,) = row
            if raw:
                try:
                    bt_ids.extend(_json.loads(raw) or [])
                except Exception:
                    pass
            conn.execute(text("DELETE FROM pt_comparison_runs WHERE id = :id"), {"id": cid})
        for bid in bt_ids:
            conn.execute(text("DELETE FROM pt_backtest_results WHERE backtest_run_id = :id"), {"id": bid})
            conn.execute(text("DELETE FROM pt_backtest_runs WHERE id = :id"), {"id": bid})
        if removed:
            logger.info("Cleanup: removed %d stale Batch-Compare comparison runs", removed)
    except Exception as e:
        logger.warning("Stale-comparison cleanup skipped: %s", e)

    # One-shot backfill: completed BacktestRuns whose pass/fail aggregates were
    # never written because of the SQLAlchemy identity-map staleness bug (the
    # outer session's cached BacktestResult rows hid the children's status
    # updates from the aggregate SELECT). Recompute from BacktestResult rows.
    # Idempotent — only touches runs that look unaggregated.
    try:
        broken = conn.execute(text(
            "SELECT id FROM pt_backtest_runs "
            "WHERE status = 'completed' AND passed_cases = 0 AND failed_cases = 0 AND total_cases > 0"
        )).fetchall()
        for (run_id,) in broken:
            counts = conn.execute(text(
                "SELECT status, COUNT(*) FROM pt_backtest_results "
                "WHERE backtest_run_id = :id GROUP BY status"
            ), {"id": run_id}).fetchall()
            by_status = {s: c for s, c in counts}
            passed = by_status.get("passed", 0)
            failed = by_status.get("failed", 0) + by_status.get("error", 0)
            scored = passed + failed
            total = sum(by_status.values())
            pass_rate = (passed / scored) if scored > 0 else None
            conn.execute(text(
                "UPDATE pt_backtest_runs SET passed_cases = :p, failed_cases = :f, "
                "total_cases = :t, pass_rate = :r WHERE id = :id"
            ), {"p": passed, "f": failed, "t": total, "r": pass_rate, "id": run_id})
        if broken:
            logger.info("Backfill: recomputed aggregates for %d backtest run(s)", len(broken))
    except Exception as e:
        logger.warning("Backtest aggregate backfill skipped: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_run_migrations)
    os.makedirs(settings.UPLOADS_DIR, exist_ok=True)
    yield
    await engine.dispose()


app = FastAPI(
    title="LLM Playground",
    description="LLM experimentation and optimization platform",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api/v1")
app.include_router(projects.router, prefix="/api/v1")
app.include_router(prompts.router, prefix="/api/v1")
app.include_router(documents.router, prefix="/api/v1")
app.include_router(models.router, prefix="/api/v1")
app.include_router(inference.router, prefix="/api/v1")
app.include_router(post_training.router, prefix="/api/v1")
app.include_router(knowledge_base.router, prefix="/api/v1")
app.include_router(input_datasets.router, prefix="/api/v1")
app.include_router(chat.router, prefix="/api/v1")
app.include_router(chains.router, prefix="/api/v1")
app.include_router(prompt_builder.router, prefix="/api/v1")
