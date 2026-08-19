"""Application configuration loaded from environment variables."""

from __future__ import annotations

from functools import lru_cache

from pydantic import computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Strongly-typed settings bound to backend/.env.

    The .env.example next to this module documents every key. Defaults assume
    local development against the docker-compose Postgres and Redis services.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Database ─────────────────────────────────────────────
    postgres_user: str = "forgecore"
    postgres_password: str = "forgecore_dev"
    postgres_db: str = "forgecore"
    postgres_host: str = "localhost"
    postgres_port: int = 5440
    database_url: str | None = None

    # ── Redis ────────────────────────────────────────────────
    redis_url: str = "redis://localhost:6380/0"

    # ── Auth ──────────────────────────────────────────────────
    jwt_secret_key: str = "change-me-to-a-long-random-string"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7

    # ── CORS ─────────────────────────────────────────────────
    cors_origins: str = "http://localhost:4173,http://127.0.0.1:4173"

    # ── LLM (reserved for B8 agent phase) ───────────────────
    llm_provider: str | None = None
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o"
    llm_base_url: str = "https://api.openai.com/v1"
    agent_llm_timeout_seconds: float = 15
    agent_session_ttl_seconds: int = 86400

    # ── App ──────────────────────────────────────────────────
    app_env: str = "development"
    app_log_level: str = "info"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def effective_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def is_dev(self) -> bool:
        return self.app_env == "development"


@lru_cache
def get_settings() -> Settings:
    """Cached settings instance; overridden in tests via cache_clear()."""
    return Settings()
