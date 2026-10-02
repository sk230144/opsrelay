from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """
    Runtime configuration.

    Defaults to SQLite so the backend starts with no infrastructure at all.
    Point DATABASE_URL at Postgres (docker compose up) for the real thing.
    """

    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = f"sqlite:///{BASE_DIR / 'opsrelay.db'}"

    # Override in production. The app refuses to start with this value when
    # DEBUG is off (see main.py).
    secret_key: str = "dev-only-insecure-change-me"
    algorithm: str = "HS256"
    access_token_minutes: int = 30
    refresh_token_days: int = 30

    debug: bool = True

    upload_dir: Path = BASE_DIR / "uploads"
    # Public base used to build absolute attachment URLs for mobile clients.
    public_base_url: str = "http://localhost:8000"

    # SLA windows in minutes, keyed by priority. Mirrors SLA_MINUTES on mobile.
    sla_minutes: dict[str, int] = {
        "critical": 30,
        "high": 120,
        "medium": 480,
        "low": 1440,
    }


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    return settings
