"""
routes_integrator.py — integrator account management for the relayer.

Note the layering: an integrator's RULES (min age, restricted root,
doc max age) live ONLY on-chain via kyc_registry.register_integrator()
— this backend never duplicates or overrides those. What lives here is
purely relayer-operational: an API key to authenticate calls to this
service, a webhook URL/secret, and a daily sponsorship spend limit. An
integrator could in principle use the protocol entirely without this
backend (calling kyc_registry directly from their own infrastructure
and paying their own fees) — this service exists only for integrators
who want fee sponsorship and/or webhook delivery.
"""
import secrets
from fastapi import APIRouter, Depends, HTTPException
import asyncpg
from datetime import datetime, timezone, timedelta
from loguru import logger
from stellar_sdk import Keypair, Network, TransactionBuilder, SorobanServer, xdr, scval


import asyncio
from app.db.database import get_db
from app.db.models import IntegratorCreateRequest, IntegratorResponse
from app.api.auth import generate_api_key, hash_api_key, get_current_integrator
from app.core.config import settings
from app.db.database import get_db
from app.api.auth import get_current_integrator
import hashlib

router = APIRouter(prefix="/integrators", tags=["Integrators"])

from pydantic import BaseModel

BASE_FEE = 100  # 100 stroops


class RotateByOwnerRequest(BaseModel):
    stellar_address: str
    signed_message: str
    message: str
    integrator_id: str 

def _sep53_hash(message: str) -> bytes:
    prefix = b"Stellar Signed Message:\n"
    payload = prefix + message.encode("utf-8")
    return hashlib.sha256(payload).digest()

@router.post("/rotate-by-owner")
async def rotate_by_owner(
    body: RotateByOwnerRequest,
    db: asyncpg.Connection = Depends(get_db),
):
    from stellar_sdk import Keypair
    import base64

    try:
        kp = Keypair.from_public_key(body.stellar_address)
        message_hash = _sep53_hash(body.message)
        kp.verify(message_hash, base64.b64decode(body.signed_message))
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid signature")

    row = await db.fetchrow(
        """
        SELECT id FROM integrators 
        WHERE id = $1 AND owner_stellar_address = $2 AND is_active = TRUE
        """,
        body.integrator_id,
        body.stellar_address,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Project not found for this address")

    new_key = generate_api_key()
    await db.execute(
        "UPDATE integrators SET api_key_hash = $1, updated_at = NOW() WHERE id = $2",
        hash_api_key(new_key), row["id"],
    )
    return {"api_key": new_key}

@router.post("", response_model=IntegratorResponse)
async def create_integrator(
    body: IntegratorCreateRequest,
    db: asyncpg.Connection = Depends(get_db),
):
    existing = await db.fetchrow(
        "SELECT id FROM integrators WHERE integrator_id_hex = $1",
        body.integrator_id_hex,
    )
    if existing:
        raise HTTPException(status_code=409, detail="integrator_id_hex already has a relayer account")

    api_key = generate_api_key()
    webhook_secret = secrets.token_urlsafe(settings.WEBHOOK_SIGNING_SECRET_LENGTH)

    row = await db.fetchrow(
        """
        INSERT INTO integrators (
            integrator_id_hex, name, owner_stellar_address,
            api_key_hash, webhook_url, webhook_secret, daily_sponsored_tx_limit
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
        """,
        body.integrator_id_hex,
        body.name,
        body.owner_stellar_address,
        hash_api_key(api_key),
        body.webhook_url,
        webhook_secret,
        settings.DEFAULT_DAILY_SPONSORED_TX_LIMIT,
    )

    logger.info(f"Created relayer account for integrator {body.integrator_id_hex}")

    # Register on-chain atomically
    if settings.KYC_REGISTRY_CONTRACT_ID and settings.BACKEND_STELLAR_SECRET:
        try:
            await _register_integrator_on_chain(
                integrator_id_hex=body.integrator_id_hex,
                min_age_seconds=getattr(body, 'min_age_seconds', 568025136),
                doc_max_age_seconds=getattr(body, 'doc_max_age_seconds', 315360000),
            )
            logger.info(f"On-chain registration succeeded for {body.integrator_id_hex}")
        except Exception as e:
            # Roll back the DB row — don't leave a half-registered integrator
            await db.execute("DELETE FROM integrators WHERE id = $1", row["id"])
            logger.error(f"On-chain registration failed for {body.integrator_id_hex}: {e}")
            raise HTTPException(status_code=500, detail=f"On-chain registration failed: {e}")

    return IntegratorResponse(
        id=row["id"],
        integrator_id_hex=row["integrator_id_hex"],
        name=row["name"],
        api_key=api_key,
        webhook_url=row["webhook_url"],
        daily_sponsored_tx_limit=row["daily_sponsored_tx_limit"],
        is_active=row["is_active"],
        created_at=row["created_at"],
    )


async def _register_integrator_on_chain(
    integrator_id_hex: str,
    min_age_seconds: int,
    doc_max_age_seconds: int,
):
    server = SorobanServer(settings.STELLAR_RPC_URL)
    keypair = Keypair.from_secret(settings.BACKEND_STELLAR_SECRET)

    account = await asyncio.get_event_loop().run_in_executor(
        None, server.load_account, keypair.public_key
    )

    tx = (
        TransactionBuilder(account, Network.TESTNET_NETWORK_PASSPHRASE, base_fee=BASE_FEE)
        .append_invoke_contract_function_op(
            contract_id=settings.KYC_REGISTRY_CONTRACT_ID,
            function_name="register_integrator",
            parameters=[
                xdr.ScVal.scv_bytes(bytes.fromhex(integrator_id_hex)),
                scval.to_uint32(min_age_seconds),
                xdr.ScVal.scv_bytes(bytes.fromhex("0" * 64)),
                scval.to_uint32(doc_max_age_seconds),
            ],
        )
        .set_timeout(30)
        .build()
    )

    prepared = await asyncio.get_event_loop().run_in_executor(
        None, server.prepare_transaction, tx
    )
    prepared.sign(keypair)

    result = await asyncio.get_event_loop().run_in_executor(
        None, server.send_transaction, prepared
    )

    if result.status == "ERROR":
        raise Exception(f"Transaction error: {result.error_result_xdr}")

    # Poll for confirmation
    for _ in range(10):
        await asyncio.sleep(2)
        status = await asyncio.get_event_loop().run_in_executor(
            None, server.get_transaction, result.hash
        )
        if status.status == "SUCCESS":
            return result.hash
        if status.status == "FAILED":
            raise Exception(f"Transaction failed: {result.hash}")

    raise Exception("On-chain registration timed out")


@router.get("/me", response_model=IntegratorResponse)
async def get_my_integrator(
    integrator: dict = Depends(get_current_integrator),
):
    return IntegratorResponse(
        id=integrator["id"],
        integrator_id_hex=integrator["integrator_id_hex"],
        name=integrator["name"],
        api_key=None,  # never returned after creation
        webhook_url=integrator["webhook_url"],
        daily_sponsored_tx_limit=integrator["daily_sponsored_tx_limit"],
        is_active=integrator["is_active"],
        created_at=integrator["created_at"],
    )

@router.get("/me/stats")
async def get_my_stats(
    integrator: dict = Depends(get_current_integrator),
    db: asyncpg.Connection = Depends(get_db),
):
    """Daily usage stats for the dashboard overview."""
    window_start = datetime.now(timezone.utc) - timedelta(hours=24)
 
    used_today = await db.fetchval(
        """
        SELECT COUNT(*) FROM sponsored_tx_log
        WHERE integrator_id = $1 AND created_at >= $2
        """,
        integrator["id"],
        window_start,
    )
 
    total = await db.fetchval(
        "SELECT COUNT(*) FROM sponsored_tx_log WHERE integrator_id = $1",
        integrator["id"],
    )
 
    return {
        "used_today": used_today or 0,
        "limit": integrator["daily_sponsored_tx_limit"],
        "total_submissions": total or 0,
    }
 
 
@router.get("/by-owner/{stellar_address}")
async def get_by_owner(
    stellar_address: str,
    db: asyncpg.Connection = Depends(get_db),
):
    rows = await db.fetch(
        """
        SELECT id, integrator_id_hex, name, owner_stellar_address,
               webhook_url, daily_sponsored_tx_limit, is_active, created_at
        FROM integrators
        WHERE owner_stellar_address = $1 AND is_active = TRUE
        ORDER BY created_at DESC
        """,
        stellar_address,
    )
    if not rows:
        raise HTTPException(status_code=404, detail=f"No integrators found for {stellar_address}")

    return [
        {
            "id": str(r["id"]),
            "integrator_id_hex": r["integrator_id_hex"],
            "name": r["name"],
            "owner_stellar_address": r["owner_stellar_address"],
            "webhook_url": r["webhook_url"],
            "daily_sponsored_tx_limit": r["daily_sponsored_tx_limit"],
            "is_active": r["is_active"],
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]
    
 
@router.get("/me/webhook-secret")
async def get_webhook_secret(
    integrator: dict = Depends(get_current_integrator),
):
    """
    Returns the HMAC secret for webhook signing.
    Only used server-side (by the dashboard's test-webhook route) —
    never expose this to the browser directly.
    """
    return {"webhook_secret": integrator.get("webhook_secret", "")}

@router.post("/me/rotate-key")
async def rotate_api_key(
    integrator: dict = Depends(get_current_integrator),
    db: asyncpg.Connection = Depends(get_db),
):
    """Invalidates the current API key and issues a new one. The old
    key stops working the instant this completes — callers must update
    every client using the old key before calling this, there's no
    grace period / dual-key window in this simple implementation."""
    new_key = generate_api_key()
    await db.execute(
        "UPDATE integrators SET api_key_hash = $1, updated_at = NOW() WHERE id = $2",
        hash_api_key(new_key), integrator["id"],
    )
    return {"api_key": new_key, "message": "API key rotated. Update your integration immediately."}


@router.patch("/me/webhook")
async def update_webhook(
    webhook_url: str | None,
    integrator: dict = Depends(get_current_integrator),
    db: asyncpg.Connection = Depends(get_db),
):
    await db.execute(
        "UPDATE integrators SET webhook_url = $1, updated_at = NOW() WHERE id = $2",
        webhook_url, integrator["id"],
    )
    return {"message": "Webhook URL updated", "webhook_url": webhook_url}