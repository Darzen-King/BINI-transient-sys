"""
db.py — SQLAlchemy engine, session factory, Base declaration.
DB path is resolved relative to project root (parent of app/),
so it works regardless of which directory uvicorn is launched from.
"""
from pathlib import Path as _Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# Absolute path: <project_root>/bini_blooms.db
# This ensures the DB is always in the same place regardless of CWD
_PROJECT_ROOT = _Path(__file__).parent.parent
_DB_PATH      = _PROJECT_ROOT / "bini_blooms.db"
SQLITE_URL    = f"sqlite:///{_DB_PATH}"

engine = create_engine(
    SQLITE_URL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
