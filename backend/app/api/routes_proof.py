"""
routes_proof.py — the single most important route in this service:
accepts a proof from an integrator's frontend, runs the off-chain
snarkjs check, enforces the daily spend limit, submits to Soroban,
logs the result, and enqueues a webhook delivery.

CHANGE IN THIS REVISION: added a document-type / NFC-policy gate at
the top. This endpoint is the OCR-only proof path — if the integrator's
policy (see app/services/nfc_policy.py) requires NFC for the document
type the caller declares, this rejects the submission and points the
caller at /nfc/verify-chip + /nfc/submit-proof instead. Without this
check, an integrator could set nfc_policy='required_for_passport' on
their dashboard and a client could simply ignore that and post a
passport OCR-only proof here anyway — the policy needs to be enforced
server-side, not just reflected in frontend UI.
"""
from fastapi import APIRouter, Depends, HTTPException
from uuid import uuid4
from datetime import datetime, timezone
import asyncpg
from loguru import logger

from app.api.auth import get_current_integrator
from app.db.database import get_db
from app.db.models import SubmitProofRequest, SubmitProofResponse, VerificationStatus, WebhookPayload
from app.services.snarkjs_verify import verify_proof_off_chain, OffChainVerificationError
from app.services.spend_limit import check_and_reserve, SpendLimitExceeded
from app.services.stellar_sponsor import submit_verification
from app.services.webhook_service import enqueue_webhook
from app.services.nfc_policy import (
    DocumentType,
    DocumentTypeNotAllowed,
    assert_document_type_allowed,
    nfc_required,
)

router = APIRouter(prefix="/proof", tags=["Proof"])


@router.post("/submit", response_model=SubmitProofResponse)
async def submit_proof(
    body: SubmitProofRequest,
    integrator: dict = Depends(get_current_integrator),
    db: asyncpg.Connection = Depends(get_db),
):
    integrator_id = integrator["id"]
    integrator_id_hex = integrator["integrator_id_hex"]

    # ── 0. Document-type / NFC policy gate ──
    # `document_type` isn't on SubmitProofRequest yet in db/models.py —
    # add it there (see app/db/models_to_add.py); defaulting to passport
    # here only preserves behavior for callers that haven't been updated
    # to send it yet, it isn't a safe long-term default once you have
    # integrators relying on this gate.
    document_type = getattr(body, "document_type", DocumentType.PASSPORT.value)

    try:
        assert_document_type_allowed(document_type, integrator)
    except DocumentTypeNotAllowed as e:
        raise HTTPException(status_code=422, detail=str(e))

    if nfc_required(document_type, integrator):
        raise HTTPException(
            status_code=422,
            detail=(
                f"'{document_type}' requires NFC chip verification for this integrator. "
                "Use POST /nfc/verify-chip then POST /nfc/submit-proof instead of /proof/submit."
            ),
        )

    # ── 1. Off-chain snarkjs pre-check (free, rejects garbage before spending fees) ──
    try:
        off_chain_ok = verify_proof_off_chain(
            body.proof_a_hex,
            body.proof_b_hex,
            body.proof_c_hex,
            body.public_signals_hex,
        )
    except OffChainVerificationError as e:
        logger.warning(f"Off-chain check error for {integrator_id_hex}: {e}")
        raise HTTPException(status_code=400, detail=f"Malformed proof: {e}")

    if not off_chain_ok:
        # Log it but don't count against spend limit — this is a cryptographic rejection
        await db.execute(
            """
            INSERT INTO sponsored_tx_log
              (integrator_id, nullifier_hex, user_stellar_address,
               status, off_chain_check_passed, error_message)
            VALUES ($1, $2, $3, 'rejected', FALSE, 'off-chain verification failed')
            """,
            integrator_id, body.nullifier_hex, body.user_stellar_address,
        )
        raise HTTPException(status_code=400, detail="Proof failed off-chain verification")

    # ── 2. Daily spend limit check ──
    try:
        await check_and_reserve(db, str(integrator_id), integrator["daily_sponsored_tx_limit"])
    except SpendLimitExceeded as e:
        raise HTTPException(status_code=429, detail=str(e))

    # ── 3. Submit to Soroban ──
    result = await submit_verification(
        integrator_id_hex=integrator_id_hex,
        nullifier_hex=body.nullifier_hex,
        current_timestamp=body.current_timestamp,
        proof_a_hex=body.proof_a_hex,
        proof_b_hex=body.proof_b_hex,
        proof_c_hex=body.proof_c_hex,
        public_signals_hex=body.public_signals_hex,
    )

    status = VerificationStatus.SUBMITTED if result.success else VerificationStatus.REJECTED
    error_msg = result.error if not result.success else None

    # ── 4. Log the submission ──
    submission_id = uuid4()
    await db.execute(
        """
        INSERT INTO sponsored_tx_log
          (id, integrator_id, nullifier_hex, user_stellar_address,
           status, tx_hash, off_chain_check_passed, error_message)
        VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7)
        """,
        submission_id, integrator_id, body.nullifier_hex,
        body.user_stellar_address, status.value, result.tx_hash, error_msg,
    )

    # ── 5. Enqueue webhook if integrator has a webhook_url ──
    if integrator.get("webhook_url") and result.success:
        payload = WebhookPayload(
            integrator_id_hex=integrator_id_hex,
            nullifier_hex=body.nullifier_hex,
            status=status,
            tx_hash=result.tx_hash,
            submission_id=submission_id,
            timestamp=datetime.now(timezone.utc),
        )
        await enqueue_webhook(db, submission_id, integrator_id, payload)

    if not result.success:
        raise HTTPException(status_code=502, detail=f"Soroban submission failed: {result.error}")

    return SubmitProofResponse(
        submission_id=submission_id,
        status=status,
        tx_hash=result.tx_hash,
        message="Proof submitted to Soroban. Poll /proof/status/{tx_hash} for confirmation.",
    )


@router.get("/status/{tx_hash}")
async def get_submission_status(
    tx_hash: str,
    integrator: dict = Depends(get_current_integrator),
    db: asyncpg.Connection = Depends(get_db),
):
    row = await db.fetchrow(
        """
        SELECT id, nullifier_hex, status, tx_hash, error_message, created_at
        FROM sponsored_tx_log
        WHERE tx_hash = $1 AND integrator_id = $2
        """,
        tx_hash, integrator["id"],
    )
    if not row:
        raise HTTPException(status_code=404, detail="Submission not found")
    return dict(row)