from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://localhost:5432/shop"
    ROUTER_PREFIX: str = "/v1"


settings = Settings()
