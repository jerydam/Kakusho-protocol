"""
spend_limit.py — enforces each integrator's daily_sponsored_tx_limit
before stellar_sponsor.py is allowed to spend real fees on their
behalf. This is the defense-in-depth layer on top of
snarkjs_verify.py's off-chain check: snarkjs_verify rejects garbage
proofs for free; this rejects a FLOOD of legitimately-formed proofs
(e.g. an integrator's own compromised frontend, or a bug that retries
submission in a loop) once it crosses a sane daily ceiling, independent
of whether each individual proof is valid.
"""
from datetime import datetime, timezone, timedelta
import asyncpg


class SpendLimitExceeded(Exception):
    def __init__(self, integrator_id: str, limit: int, used: int):
        self.integrator_id = integrator_id
        self.limit = limit
        self.used = used
        super().__init__(
            f"Integrator {integrator_id} has used {used}/{limit} sponsored "
            f"transactions in the last 24h"
        )


async def check_and_reserve(db: asyncpg.Connection, integrator_id: str, daily_limit: int) -> None:
    """
    Raises SpendLimitExceeded if this integrator has already hit their
    daily ceiling. Does NOT itself record the new submission — that
    happens via the normal sponsored_tx_log INSERT in routes_proof.py
    once submission actually proceeds, so a request that fails for
    other reasons (off-chain check failure, etc.) doesn't count against
    the limit.

    Race condition note: this check-then-insert pattern has a narrow
    race window under concurrent requests for the same integrator (two
    requests could both pass the check before either inserts). For the
    volumes this service is likely to see, that's an acceptable
    imprecision — it can let the limit be exceeded by a handful of
    transactions in a burst, not drained entirely. If you need a hard
    guarantee, wrap this in a `SELECT ... FOR UPDATE` against a
    per-integrator counter row instead of counting log rows, but that
    adds lock contention this simpler version avoids.
    """
    window_start = datetime.now(timezone.utc) - timedelta(hours=24)

    used = await db.fetchval(
        """
        SELECT COUNT(*) FROM sponsored_tx_log
        WHERE integrator_id = $1 AND created_at >= $2
        """,
        integrator_id,
        window_start,
    )

    if used >= daily_limit:
        raise SpendLimitExceeded(integrator_id, daily_limit, used)