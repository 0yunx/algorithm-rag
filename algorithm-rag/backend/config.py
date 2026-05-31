from functools import lru_cache
import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = Path(__file__).resolve().parents[2]
load_dotenv(REPO_DIR / ".env")
load_dotenv(PROJECT_DIR / ".env")
load_dotenv()


def resolve_project_path(path: str) -> str:
    expanded = Path(path).expanduser()
    if expanded.is_absolute():
        return str(expanded)
    return str(PROJECT_DIR / expanded)


def resolve_repo_path(path: str) -> str:
    expanded = Path(path).expanduser()
    if expanded.is_absolute():
        return str(expanded)
    return str(REPO_DIR / expanded)


def sqlite_url_for_project_path(path: str) -> str:
    return f"sqlite:///{Path(resolve_project_path(path)).as_posix()}"


def resolve_database_url(url: str | None) -> str:
    if not url:
        return sqlite_url_for_project_path("data/app.db")
    if not url.startswith("sqlite:///"):
        return url
    db_path = url.replace("sqlite:///", "", 1)
    if db_path == ":memory:":
        return url
    path = Path(db_path).expanduser()
    if path.is_absolute():
        return f"sqlite:///{path.as_posix()}"
    return f"sqlite:///{(PROJECT_DIR / path).as_posix()}"


class Settings:
    openai_api_key: str | None = os.getenv("OPENAI_API_KEY")
    openai_base_url: str | None = os.getenv("OPENAI_BASE_URL")
    chat_model: str = os.getenv("CHAT_MODEL", "gpt-4o-mini")
    embedding_model: str = os.getenv("EMBEDDING_MODEL", "BAAI/bge-m3")
    embedding_device: str = os.getenv("EMBEDDING_DEVICE", "cpu")
    embedding_cache_dir: str = resolve_repo_path(os.getenv("EMBEDDING_CACHE_DIR", ".venv/huggingface"))

    database_url: str = resolve_database_url(os.getenv("DATABASE_URL"))
    chroma_dir: str = resolve_project_path(os.getenv("CHROMA_DIR", "data/chroma"))
    upload_dir: str = resolve_project_path(os.getenv("UPLOAD_DIR", "data/uploads"))

    jwt_secret_key: str = os.getenv("JWT_SECRET_KEY", "change-me-before-sharing")
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))

    rag_top_k: int = int(os.getenv("RAG_TOP_K", "8"))
    rerank_top_k: int = int(os.getenv("RERANK_TOP_K", "4"))
    max_upload_mb: int = int(os.getenv("MAX_UPLOAD_MB", "20"))
    max_chat_message_chars: int = int(os.getenv("MAX_CHAT_MESSAGE_CHARS", "4000"))
    frontend_origin: str = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
    Path(settings.chroma_dir).mkdir(parents=True, exist_ok=True)
    Path(settings.embedding_cache_dir).mkdir(parents=True, exist_ok=True)
    if settings.database_url.startswith("sqlite:///"):
        db_path = settings.database_url.replace("sqlite:///", "", 1)
        if db_path != ":memory:":
            Path(db_path).expanduser().parent.mkdir(parents=True, exist_ok=True)
    return settings
