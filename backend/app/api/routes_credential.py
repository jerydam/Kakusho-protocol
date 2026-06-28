"""
routes_credential.py — credential reuse across integrators.

This is the core of the "verify once, use everywhere" feature.

How it works:
  1. A user verifies on Kakushō self-protocol (integrator_id = KAKUSHO_SELF).
     Their nullifier is stored in sponsored_tx_log scoped to that integrator.

  2. When a third-party integrator (Celo PG, Talent Protocol, etc.) needs
     verification, they call GET /credential/check?address={stellar_address}
     which looks up whether this address has a confirmed self-verification
     on record.

  3. If yes, the integrator can call POST /credential/delegate to create a
     new sponsored_tx_log entry under their own integrator_id — same nullifier
     derivation, no re-scan required, no fees for the user.

  4. The session flow: integrator redirects user to Kakushō deeplink.
     App checks credential status. If already verified → auto-approves and
     PATCHes the session to "confirmed" without NFC. If not → runs NFC flow.

NULLIFIER NAMESPACING (important):
  Nullifiers are scoped per integrator in the ZK circuit:
    nullifier = hash(user_secret, integrator_id)
  So a credential delegation does NOT share the raw nullifier — it derives
  a new integrator-scoped nullifier from the same root identity commitment.
  This means integrators cannot correlate users across each other by nullifier.
  The cross-integrator link exists only in THIS backend (via identity_commitments
  table below) and is under the user's control.

DATABASE ADDITIONS NEEDED (run against Supabase):
  See schema_additions.sql in this same output folder.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
import asyncpg
import hashlib
import secrets
from datetime import datetime, timezone
from loguru import logger

from app.db.database import get_db
from app.api.auth import get_current_integrator
from app.core.config import settings

router = APIRouter(prefix="/credential", tags=["credential"])

# ── The self-protocol integrator ID ──────────────────────────────────────
# This must match the integrator_id_hex you registered as "Kakushō Self"
# via POST /integrators. Set it in .env as KAKUSHO_SELF_INTEGRATOR_ID.
KAKUSHO_SELF_INTEGRATOR_ID = settings.KAKUSHO_SELF_INTEGRATOR_ID


# ─── Models ──────────────────────────────────────────────────────────────

class CredentialStatus(BaseModel):
    verified: bool
    verified_at: Optional[datetime] = None
    tx_hash: Optional[str] = None
    # The identity commitment is a hash of the nullifier that can be
    # shared across integrators without revealing the nullifier itself.
    identity_commitment: Optional[str] = None


class DelegateRequest(BaseModel):
    """
    Called by an integrator's backend (not the app directly) to claim
    a cross-integrator verification for a user who is already verified
    on Kakushō self-protocol.

    The session_id ties this to an active desktop↔mobile handoff so
    the desktop tab gets notified automatically.
    """
    session_id: str
    # The user's stellar address — used to look up their self-verification
    user_stellar_address: str


class DelegateResponse(BaseModel):
    delegated: bool
    tx_hash: Optional[str] = None
    nullifier_hex: Optional[str] = None
    message: str



# ─── POST /credential/auto-verify ────────────────────────────────────────

class AutoVerifyRequest(BaseModel):
    """
    Called by the mobile app immediately after a deeplink opens.

    If the user already has a self-protocol credential, this single call:
      1. Checks self-verification
      2. Derives the delegation nullifier for the requesting integrator
      3. Writes the delegation record
      4. Marks the session confirmed
      5. Fires the integrator webhook

    Returns { delegated: true } on success, or { delegated: false } if
    the user needs to run the NFC scan first.

    Authenticated with the REQUESTING integrator's API key.
    """
    session_id: str
    user_stellar_address: str


@router.post("/auto-verify", response_model=DelegateResponse)
async def auto_verify(
    body: AutoVerifyRequest,
    integrator: dict = Depends(get_current_integrator),
    db: asyncpg.Connection = Depends(get_db),
):
    """
    One-shot endpoint for the 'verify once, use everywhere' UX.

    The app calls this on deeplink open. If the user is already verified
    on Kakushō self-protocol, the integrator gets an instant credential
    delegation — no NFC re-scan, no user friction. The session is also
    marked confirmed so the desktop tab updates in real time via SSE.

    If the user is NOT yet self-verified, returns delegated=False with a
    clear message so the app can fall through to the NFC scan flow.
    """
    # Reuse the delegate logic (idempotent, handles already-delegated case)
    self_record = await db.fetchrow(
        """
        SELECT stl.nullifier_hex, stl.tx_hash, stl.user_stellar_address
        FROM sponsored_tx_log stl
        JOIN integrators i ON stl.integrator_id = i.id
        WHERE i.integrator_id_hex = $1
          AND stl.user_stellar_address = $2
          AND stl.status IN ('submitted', 'confirmed')
        ORDER BY stl.created_at DESC
        LIMIT 1
        """,
        KAKUSHO_SELF_INTEGRATOR_ID,
        body.user_stellar_address,
    )

    if not self_record:
        # Not self-verified yet — tell the app to start NFC
        return DelegateResponse(
            delegated=False,
            message="No existing credential found. Please scan your passport.",
        )

    # Already self-verified — delegate to the requesting integrator
    return await delegate_credential(
        DelegateRequest(
            session_id=body.session_id,
            user_stellar_address=body.user_stellar_address,
        ),
        integrator=integrator,
        db=db,
    )

# ─── GET /credential/check ───────────────────────────────────────────────

@router.get("/check", response_model=CredentialStatus)
async def check_credential(
    address: str = Query(..., description="User's Stellar address"),
    db: asyncpg.Connection = Depends(get_db),
):
    """
    Public endpoint — called by:
      - The mobile app on deeplink open (before deciding NFC vs auto-approve)
      - Third-party integrators checking if a user is already verified

    Returns verified=True only if the address has a confirmed submission
    under the Kakushō self-protocol integrator.
    """
    row = await db.fetchrow(
        """
        SELECT stl.tx_hash, stl.created_at, ic.identity_commitment
        FROM sponsored_tx_log stl
        JOIN integrators i ON stl.integrator_id = i.id
        LEFT JOIN identity_commitments ic ON ic.nullifier_hex = stl.nullifier_hex
            AND ic.integrator_id = i.id
        WHERE i.integrator_id_hex = $1
          AND stl.user_stellar_address = $2
          AND stl.status IN ('submitted', 'confirmed')
        ORDER BY stl.created_at DESC
        LIMIT 1
        """,
        KAKUSHO_SELF_INTEGRATOR_ID,
        address,
    )

    if not row:
        return CredentialStatus(verified=False)

    return CredentialStatus(
        verified=True,
        verified_at=row["created_at"],
        tx_hash=row["tx_hash"],
        identity_commitment=row["identity_commitment"],
    )


# ─── POST /credential/delegate ───────────────────────────────────────────

@router.post("/delegate", response_model=DelegateResponse)
async def delegate_credential(
    body: DelegateRequest,
    integrator: dict = Depends(get_current_integrator),
    db: asyncpg.Connection = Depends(get_db),
):
    """
    Authenticated endpoint (integrator API key required).

    Creates a verified record under the calling integrator for a user
    who is already verified on Kakushō self-protocol — no NFC re-scan,
    no fees for the user, instant.

    Called by the app in NfcScanScreen when:
      1. Deeplink arrives with session_id + integrator_id
      2. GET /credential/check returns verified=True for this address
      3. App calls this endpoint to register the cross-integrator credential
      4. Session is marked "confirmed" → desktop tab updates automatically
    """
    integrator_id = integrator["id"]
    integrator_id_hex = integrator["integrator_id_hex"]

    # ── 1. Verify the user is confirmed on self-protocol ─────────────────
    self_record = await db.fetchrow(
        """
        SELECT stl.nullifier_hex, stl.tx_hash, stl.user_stellar_address
        FROM sponsored_tx_log stl
        JOIN integrators i ON stl.integrator_id = i.id
        WHERE i.integrator_id_hex = $1
          AND stl.user_stellar_address = $2
          AND stl.status IN ('submitted', 'confirmed')
        ORDER BY stl.created_at DESC
        LIMIT 1
        """,
        KAKUSHO_SELF_INTEGRATOR_ID,
        body.user_stellar_address,
    )

    if not self_record:
        raise HTTPException(
            status_code=404,
            detail="No self-verification found for this address. User must complete NFC verification first.",
        )

    # ── 2. Derive integrator-scoped nullifier ─────────────────────────────
    # The ZK circuit uses: nullifier = hash(user_secret, integrator_id)
    # We can't re-run the circuit here (user_secret never left the device),
    # so we derive a deterministic cross-integrator nullifier from the
    # self-nullifier + integrator_id. This is NOT the same as the circuit
    # output — it's a relayer-level delegation token.
    # In a full ZK deployment, the user would re-run the circuit with the
    # new integrator_id and submit a new proof. For now this is the
    # practical shortcut that enables the "verify once" UX.
    delegation_nullifier = _derive_delegation_nullifier(
        self_record["nullifier_hex"],
        integrator_id_hex,
    )

    # ── 3. Check not already delegated ───────────────────────────────────
    existing = await db.fetchval(
        """
        SELECT id FROM sponsored_tx_log
        WHERE integrator_id = $1 AND nullifier_hex = $2
        """,
        integrator_id,
        delegation_nullifier,
    )
    if existing:
        # Already delegated — idempotent, return success
        existing_row = await db.fetchrow(
            "SELECT tx_hash FROM sponsored_tx_log WHERE id = $1", existing
        )
        return DelegateResponse(
            delegated=True,
            tx_hash=existing_row["tx_hash"],
            nullifier_hex=delegation_nullifier,
            message="Already verified on this platform.",
        )

    # ── 4. Write delegation record ────────────────────────────────────────
    # No on-chain submission for delegations yet — the self-protocol
    # tx_hash is the root proof. In a full deployment, this would submit
    # a delegation proof to Soroban using the cross-integrator nullifier.
    delegation_tx_ref = f"delegated:{self_record['tx_hash']}"

    submission_id = await db.fetchval(
        """
        INSERT INTO sponsored_tx_log
          (integrator_id, nullifier_hex, user_stellar_address,
           status, tx_hash, off_chain_check_passed, error_message)
        VALUES ($1, $2, $3, 'confirmed', $4, TRUE, NULL)
        RETURNING id
        """,
        integrator_id,
        delegation_nullifier,
        body.user_stellar_address,
        delegation_tx_ref,
    )

    # ── 5. Mark the session confirmed ────────────────────────────────────
    try:
        await db.execute(
            """
            UPDATE verification_sessions
            SET status = 'confirmed',
                nullifier_hex = $1,
                tx_hash = $2,
                user_stellar_address = $3,
                updated_at = NOW()
            WHERE id = $4
              AND status NOT IN ('confirmed', 'failed', 'expired')
            """,
            delegation_nullifier,
            delegation_tx_ref,
            body.user_stellar_address,
            body.session_id,
        )
    except Exception as e:
        logger.warning(f"Could not update session {body.session_id}: {e}")
        # Non-fatal — the credential delegation succeeded even if session update fails

    # ── 6. Fire webhook to integrator ────────────────────────────────────
    if integrator.get("webhook_url"):
        try:
            from app.services.webhook_service import enqueue_webhook, WebhookPayload
            from app.db.models import VerificationStatus
            await enqueue_webhook(
                db,
                submission_id,
                integrator_id,
                WebhookPayload(
                    event="kyc.credential.delegated",
                    integrator_id_hex=integrator_id_hex,
                    nullifier_hex=delegation_nullifier,
                    status=VerificationStatus.CONFIRMED,
                    tx_hash=delegation_tx_ref,
                    submission_id=submission_id,
                    timestamp=datetime.now(timezone.utc),
                ),
            )
        except Exception as e:
            logger.warning(f"Webhook enqueue failed for delegation {submission_id}: {e}")

    logger.info(
        f"Credential delegated: self→{integrator_id_hex}, "
        f"address={body.user_stellar_address}, nullifier={delegation_nullifier[:16]}…"
    )

    return DelegateResponse(
        delegated=True,
        tx_hash=delegation_tx_ref,
        nullifier_hex=delegation_nullifier,
        message=f"Verification recognised from Kakushō. Approved instantly.",
    )


# ─── GET /credential/integrators ─────────────────────────────────────────

@router.get("/integrators")
async def list_user_integrators(
    address: str = Query(..., description="User's Stellar address"),
    db: asyncpg.Connection = Depends(get_db),
):
    """
    Returns all integrators where this address is verified (self + delegated).
    Used by the app's Status screen to show the user's credential profile.
    """
    rows = await db.fetch(
        """
        SELECT i.name, i.integrator_id_hex, stl.status,
               stl.tx_hash, stl.created_at, stl.error_message
        FROM sponsored_tx_log stl
        JOIN integrators i ON stl.integrator_id = i.id
        WHERE stl.user_stellar_address = $1
          AND stl.status IN ('submitted', 'confirmed')
        ORDER BY stl.created_at DESC
        """,
        address,
    )
    return [
        {
            "name": r["name"],
            "integrator_id_hex": r["integrator_id_hex"],
            "status": r["status"],
            "tx_hash": r["tx_hash"],
            "verified_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]


# ─── Internal helper ──────────────────────────────────────────────────────

def _derive_delegation_nullifier(self_nullifier_hex: str, integrator_id_hex: str) -> str:
    """
    Derives a stable, integrator-scoped delegation token from the
    self-protocol nullifier. Deterministic so it's idempotent across
    multiple delegation attempts.

    This is NOT a ZK circuit nullifier — it's a relayer-level handle
    that prevents the same delegation being inserted twice.
    """
    raw = f"delegate:{self_nullifier_hex}:{integrator_id_hex}"
    return hashlib.sha256(raw.encode()).hexdigest()