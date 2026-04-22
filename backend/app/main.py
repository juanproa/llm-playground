import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import settings
from app.database import Base, engine
from app.routers import health, projects, prompts, documents, models, inference, post_training, knowledge_base, chat

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
)
from app.models.knowledge_base import KnowledgeBase, KnowledgeBaseItem  # noqa: F401
from app.models.chat import ChatSession, ChatMessage  # noqa: F401

logger = logging.getLogger(__name__)


def _run_migrations(conn) -> None:
    """Lightweight column-add migrations for SQLite (create_all won't add cols to existing tables)."""
    migrations = [
        ("pt_backtest_runs", "pass_threshold", "ALTER TABLE pt_backtest_runs ADD COLUMN pass_threshold FLOAT DEFAULT 0.5"),
        ("pt_backtest_runs", "judge_model_config_id", "ALTER TABLE pt_backtest_runs ADD COLUMN judge_model_config_id VARCHAR(36)"),
        ("model_configs", "adapter_path", "ALTER TABLE model_configs ADD COLUMN adapter_path VARCHAR(500)"),
        ("pt_test_cases", "assertions", "ALTER TABLE pt_test_cases ADD COLUMN assertions TEXT"),
        ("pt_test_cases", "pass_threshold", "ALTER TABLE pt_test_cases ADD COLUMN pass_threshold FLOAT"),
        ("pt_test_cases", "source_kb_item_id", "ALTER TABLE pt_test_cases ADD COLUMN source_kb_item_id VARCHAR(36)"),
        ("pt_backtest_results", "assertion_results", "ALTER TABLE pt_backtest_results ADD COLUMN assertion_results TEXT"),
        ("pt_backtest_results", "cache_hit", "ALTER TABLE pt_backtest_results ADD COLUMN cache_hit BOOLEAN DEFAULT 0"),
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
app.include_router(chat.router, prefix="/api/v1")
