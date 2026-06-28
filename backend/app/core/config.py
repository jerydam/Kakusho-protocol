"""
config.py — environment-driven settings for the relayer backend.
"""
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # ── Database ──
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/zk_kyc_relayer"

    # ── Stellar / Soroban ──
    STELLAR_NETWORK: str = "testnet"
    STELLAR_RPC_URL: str = "https://soroban-testnet.stellar.org"
    KYC_REGISTRY_CONTRACT_ID: str = ""
    SPONSOR_STELLAR_SECRET: str = ""

    # ── Self-protocol integrator ──────────────────────────────────────────
    # The integrator_id_hex registered as "Kakushō Self" via POST /integrators.
    # All self-verifications are stored under this ID.
    # Third-party integrators check against this ID via GET /credential/check.
    KAKUSHO_SELF_INTEGRATOR_ID: str = ""

    # ── Per-integrator spend limits ──
    DEFAULT_DAILY_SPONSORED_TX_LIMIT: int = 1000

    # ── Webhooks ──
    WEBHOOK_MAX_RETRIES: int = 5
    WEBHOOK_RETRY_BACKOFF_SECONDS: int = 30
    WEBHOOK_TIMEOUT_SECONDS: int = 10
    WEBHOOK_SIGNING_SECRET_LENGTH: int = 32

    # ── API key auth ──
    API_KEY_PREFIX: str = "zkyc_"

    # ── CORS ──
    CORS_ORIGINS: list[str] = ["*"]

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()