from pydantic import PostgresDsn
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    API_PREFIX: str = "/api/v1"
    ADMIN_PREFIX: str
    DATABASE_URL: PostgresDsn


settings = Settings()
