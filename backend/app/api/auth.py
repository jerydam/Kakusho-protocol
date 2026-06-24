"""
auth.py — API key authentication for integrator-facing routes.

API keys are generated once at integrator creation (see
routes_integrator.py), shown to the integrator exactly once, and stored
here only as a salted hash — same principle as password storage, for
the same reason: if this database is ever compromised, the attacker
shouldn't be able to use the leaked data to impersonate integrators
against the relayer.
"""
import hashlib
import secrets
from fastapi import Header, HTTPException, Depends
import asyncpg

from app.core.config import settings
from app.db.database import get_db


def generate_api_key() -> str:
    return settings.API_KEY_PREFIX + secrets.token_urlsafe(32)


def hash_api_key(api_key: str) -> str:
    return hashlib.sha256(api_key.encode()).hexdigest()


async def get_current_integrator(
    x_api_key: str = Header(..., alias="X-API-Key"),
    db: asyncpg.Connection = Depends(get_db),
) -> dict:
    if not x_api_key.startswith(settings.API_KEY_PREFIX):
        raise HTTPException(status_code=401, detail="Invalid API key format")

    key_hash = hash_api_key(x_api_key)
    integrator = await db.fetchrow(
        "SELECT * FROM integrators WHERE api_key_hash = $1 AND is_active = TRUE",
        key_hash,
    )
    if not integrator:
        raise HTTPException(status_code=401, detail="Invalid or inactive API key")

    return dict(integrator)