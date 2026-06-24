"""
webhook_service.py — delivers `{"status": "verified"}`-style events to
an integrator's webhook_url after on-chain confirmation, using an
outbox pattern (the webhook_deliveries table) so delivery survives
this process restarting and can be retried with backoff.

Two entry points:
  - enqueue_webhook(): called right after a submission's on-chain
    result is known (see routes_proof.py); just inserts a row.
  - process_pending_webhooks(): a background loop (run via APScheduler
    or a simple asyncio task, see main.py) that picks up pending rows
    and attempts delivery.

Every payload is HMAC-signed with the integrator's own webhook_secret
(generated at integrator creation, see routes_integrator.py) so they
can verify a webhook actually came from this service and wasn't spoofed
by a third party who guessed their webhook URL.
"""
import hashlib
import hmac
import json
import httpx
from datetime import datetime, timezone, timedelta
from uuid import UUID
import asyncpg
from loguru import logger

from app.core.config import settings
from app.db.models import WebhookPayload


def sign_payload(payload_json: str, secret: str) -> str:
    """HMAC-SHA256 signature, hex-encoded. Integrators verify by
    recomputing this over the raw request body with their own secret
    and comparing against the X-Webhook-Signature header — same
    pattern as Stripe/GitHub webhook verification."""
    return hmac.new(secret.encode(), payload_json.encode(), hashlib.sha256).hexdigest()


async def enqueue_webhook(
    db: asyncpg.Connection,
    submission_id: UUID,
    integrator_id: UUID,
    payload: WebhookPayload,
) -> None:
    await db.execute(
        """
        INSERT INTO webhook_deliveries (submission_id, integrator_id, payload, status, next_retry_at)
        VALUES ($1, $2, $3, 'pending', NOW())
        """,
        submission_id,
        integrator_id,
        payload.model_dump_json(),
    )


async def _attempt_delivery(
    db: asyncpg.Connection,
    delivery_id: UUID,
    webhook_url: str,
    webhook_secret: str,
    payload_json: str,
    attempt_count: int,
) -> bool:
    """Returns True if delivered successfully (2xx response)."""
    signature = sign_payload(payload_json, webhook_secret)

    try:
        async with httpx.AsyncClient(timeout=settings.WEBHOOK_TIMEOUT_SECONDS) as client:
            resp = await client.post(
                webhook_url,
                content=payload_json,
                headers={
                    "Content-Type": "application/json",
                    "X-Webhook-Signature": signature,
                },
            )
        success = 200 <= resp.status_code < 300

        if success:
            await db.execute(
                """
                UPDATE webhook_deliveries
                SET status = 'delivered', attempt_count = $1, last_attempt_at = NOW(),
                    last_response_code = $2
                WHERE id = $3
                """,
                attempt_count + 1, resp.status_code, delivery_id,
            )
        else:
            await _schedule_retry_or_fail(db, delivery_id, attempt_count, resp.status_code, None)

        return success

    except (httpx.TimeoutException, httpx.ConnectError, httpx.HTTPError) as e:
        await _schedule_retry_or_fail(db, delivery_id, attempt_count, None, str(e))
        return False


async def _schedule_retry_or_fail(
    db: asyncpg.Connection,
    delivery_id: UUID,
    attempt_count: int,
    response_code: int | None,
    error: str | None,
) -> None:
    new_attempt_count = attempt_count + 1

    if new_attempt_count >= settings.WEBHOOK_MAX_RETRIES:
        await db.execute(
            """
            UPDATE webhook_deliveries
            SET status = 'failed', attempt_count = $1, last_attempt_at = NOW(),
                last_response_code = $2, last_error = $3
            WHERE id = $4
            """,
            new_attempt_count, response_code, error, delivery_id,
        )
        logger.warning(f"Webhook delivery {delivery_id} failed permanently after {new_attempt_count} attempts")
        return

    # Exponential backoff: base * 2^attempt, e.g. 30s, 60s, 120s, 240s...
    backoff = timedelta(seconds=settings.WEBHOOK_RETRY_BACKOFF_SECONDS * (2 ** attempt_count))
    next_retry = datetime.now(timezone.utc) + backoff

    await db.execute(
        """
        UPDATE webhook_deliveries
        SET status = 'pending', attempt_count = $1, last_attempt_at = NOW(),
            next_retry_at = $2, last_response_code = $3, last_error = $4
        WHERE id = $5
        """,
        new_attempt_count, next_retry, response_code, error, delivery_id,
    )


async def process_pending_webhooks(db: asyncpg.Connection) -> int:
    """
    Picks up all pending deliveries whose next_retry_at has passed and
    attempts delivery. Returns count processed. Call this periodically
    (e.g. every 10-30s) from a background task — see main.py.
    """
    rows = await db.fetch(
        """
        SELECT wd.id, wd.payload, wd.attempt_count, i.webhook_url, i.webhook_secret
        FROM webhook_deliveries wd
        JOIN integrators i ON i.id = wd.integrator_id
        WHERE wd.status = 'pending' AND wd.next_retry_at <= NOW()
          AND i.webhook_url IS NOT NULL
        LIMIT 100
        """
    )

    for row in rows:
        await _attempt_delivery(
            db,
            row["id"],
            row["webhook_url"],
            row["webhook_secret"],
            json.dumps(row["payload"]) if not isinstance(row["payload"], str) else row["payload"],
            row["attempt_count"],
        )

    return len(rows)