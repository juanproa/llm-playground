from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    connect_args={
        "check_same_thread": False,
        # Lock-wait before raising "database is locked".  30s handles the
        # occasional contention between concurrent comparison-run writers.
        "timeout": 30,
    },
)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


# ── SQLite pragmas for concurrent use ─────────────────────────────────────
# Without these, the comparison service can hit "database is locked" when
# multiple child BacktestRuns try to write results in parallel:
#   - journal_mode=WAL: allows concurrent readers while a writer is active;
#     writers still serialise, but no one reader blocks the others.
#   - synchronous=NORMAL: still durable with WAL, just doesn't fsync on every
#     commit — much faster, safe for our workload.
#   - busy_timeout=30000: SQLite retries on lock contention for up to 30s
#     before surfacing "database is locked" as a real error.
#   - foreign_keys=ON: FK constraints enforced (matches model expectations).

@event.listens_for(engine.sync_engine, "connect")
def _set_sqlite_pragmas(dbapi_connection, _connection_record):
    if "sqlite" not in settings.DATABASE_URL:
        return
    cur = dbapi_connection.cursor()
    try:
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA busy_timeout=30000")
        cur.execute("PRAGMA foreign_keys=ON")
    finally:
        cur.close()
