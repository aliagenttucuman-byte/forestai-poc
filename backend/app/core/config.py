"""Configuracion de la aplicacion."""

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Settings con carga desde .env."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # App
    APP_NAME: str = "Nelson App"
    APP_VERSION: str = "0.1.0"
    ENV: Literal["development", "staging", "production"] = "development"
    DEBUG: bool = False
    PORT: int = 8000

    # Security
    SECRET_KEY: str = Field(default="change-me-in-production-32-chars")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    ALGORITHM: str = "HS256"

    # Database
    DATABASE_URL: str = "postgresql://nelson:secret@db:5432/appdb"

    # Redis
    REDIS_URL: str = "redis://redis:6379/0"

    # Qdrant
    QDRANT_HOST: str = "qdrant"
    QDRANT_PORT: int = 6333
    QDRANT_API_KEY: str | None = None

    # LLM
    LLM_PROVIDER: Literal["openai", "ollama", "anthropic", "groq"] = "ollama"
    LLM_MODEL: str = "llama3.2:3b"
    LLM_TEMPERATURE: float = 0.7
    LLM_MAX_TOKENS: int = 2048

    OPENAI_API_KEY: str | None = None
    ANTHROPIC_API_KEY: str | None = None
    GROQ_API_KEY: str | None = None

    # Embeddings
    EMBEDDING_PROVIDER: Literal["openai", "local", "ollama"] = "ollama"
    EMBEDDING_MODEL: str = "nomic-embed-text"
    EMBEDDING_DIMENSION: int = 768

    # Logging
    LOG_LEVEL: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    """Retorna settings cacheados."""
    return Settings()
