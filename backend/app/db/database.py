"""
database.py — asyncpg connection pool for the relayer backend.
Supabase uses pgbouncer in transaction mode which doesn't support
prepared statements — statement_cache_size=0 disables them.
"""
import asyncpg
from app.core.config import settings

_pool: asyncpg.Pool | None = None


async def create_pool() -> asyncpg.Pool:
    global _pool
    _pool = await asyncpg.create_pool(
        dsn=settings.DATABASE_URL,
        min_size=2,
        max_size=10,
        statement_cache_size=0,
    )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def get_db() -> asyncpg.Connection:
    if _pool is None:
        raise RuntimeError("DB pool not initialised — call create_pool() at startup")
    async with _pool.acquire() as conn:
        yield conn
