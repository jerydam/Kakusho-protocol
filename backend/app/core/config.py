"""
config.py — environment-driven settings for the relayer backend.

Deliberately small relative to the original KYC Passport backend's
config: there's no MAIL_*, no OCR/face model paths, no KYC document
storage settings, because none of that lives in this service anymore.
This backend's entire job is: verify a proof off-chain (cheap sanity
check before spending real fees), submit it to Soroban paying gas on
the user's behalf, manage which integrators are allowed to do that,
and notify integrators when verification completes.
"""
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # ── Database ──
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/zk_kyc_relayer"

    # ── Stellar / Soroban ──
    STELLAR_NETWORK: str = "testnet"  # "testnet" | "public"
    STELLAR_RPC_URL: str = "https://soroban-testnet.stellar.org"
    KYC_REGISTRY_CONTRACT_ID: str = ""

    # Sponsor (relayer) account — pays XLM fees on behalf of integrators'
    # users. This secret key controls real funds; load it from a proper
    # secrets manager in production, never commit it, and consider a
    # dedicated low-balance "hot" sponsor account refilled periodically
    # from cold storage rather than holding a large balance directly.
    SPONSOR_STELLAR_SECRET: str = ""

    # ── Per-integrator spend limits ──
    # Hard ceiling on sponsored transactions per integrator per day,
    # independent of whatever rate limit the integrator's own API key
    # enforces — this is what stops a single compromised or malicious
    # integrator from draining the sponsor wallet even if their API key
    # rate limit is set too high by mistake.
    DEFAULT_DAILY_SPONSORED_TX_LIMIT: int = 1000

    # ── Webhooks ──
    WEBHOOK_MAX_RETRIES: int = 5
    WEBHOOK_RETRY_BACKOFF_SECONDS: int = 30
    WEBHOOK_TIMEOUT_SECONDS: int = 10
    WEBHOOK_SIGNING_SECRET_LENGTH: int = 32  # bytes, per-integrator HMAC secret

    # ── API key auth ──
    API_KEY_PREFIX: str = "zkyc_"

    # ── CORS ──
    CORS_ORIGINS: list[str] = ["*"]  # tighten before production

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()