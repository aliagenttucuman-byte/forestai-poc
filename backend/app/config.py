from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://forestai:forestai2026@db:5432/forestai"
    REDIS_URL: str = "redis://redis:6379/0"
    UPLOAD_DIR: str = "/app/uploads"
    MAX_UPLOAD_MB: int = 500
    SECRET_KEY: str = "dev-secret"

    class Config:
        env_file = ".env"

settings = Settings()
