import os
from pathlib import Path
from sqlalchemy import event
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import NullPool

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = Path("/tmp/flowbudget.db") if os.getenv("VERCEL") else ROOT / "flowbudget.db"
DATABASE_URL_KEYS = (
    "FLOWBUDGET_DATABASE_URL", "FLOWBUDGET_POSTGRES_URL",
    "DATABASE_URL", "FLOWBUDGET_URL", "POSTGRES_URL",
    "FLOWBUDGET_DATABASE_URL_UNPOOLED", "DATABASE_URL_UNPOOLED",
    "FLOWBUDGET_URL_UNPOOLED",
)
DATABASE_URL = next((os.environ[key].strip() for key in DATABASE_URL_KEYS if os.getenv(key, "").strip()), f"sqlite:///{DEFAULT_DB}")
IS_SQLITE = DATABASE_URL.startswith("sqlite")
IS_EPHEMERAL_VERCEL_SQLITE = bool(os.getenv("VERCEL")) and IS_SQLITE and os.getenv("ALLOW_EPHEMERAL_SQLITE", "").lower() not in {"1", "true", "yes"}
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len("postgres://"):]
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len("postgresql://"):]

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
if not IS_SQLITE:
    connect_args = {"connect_timeout": 10}
engine_options = {"poolclass": NullPool} if os.getenv("VERCEL") and not IS_SQLITE else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True, **engine_options)


@event.listens_for(engine, "connect")
def configure_sqlite(dbapi_connection, _):
    if DATABASE_URL.startswith("sqlite"):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
