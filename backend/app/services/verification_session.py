"""
verification_session.py — desktop<->mobile pairing for the NFC step.

A "verification session" is the same trust/UX pattern as a WalletConnect
QR pairing: the desktop creates a short-lived row, renders its id as a
QR code, and polls GET /sessions/{id} for status. Whoever scans that QR
controls the session — that's the entire security model, same as
WalletConnect. Sessions expire (see expires_at) and are effectively
single-use, since routes_nfc.py only drives one row to 'submitted'/
'failed' per session.

IMPORTANT — this module does NOT perform any NFC chip reading itself.
It only tracks pairing state. The actual chip read happens in a native
mobile context (see /mobile-companion) because browser Web NFC
(NDEFReader) cannot do the raw APDU exchange ePassport reading needs —
see that folder's README for why. This service doesn't care whether
the "mobile" side ends up being a native app or, eventually, something
else; it just needs whoever finishes the flow to call update_status()
and routes_nfc.py to call the terminal transitions.
"""
from datetime import datetime, timezone
from uuid import UUID
import asyncpg


class SessionNotFound(Exception):
    pass


class SessionExpired(Exception):
    pass


class InvalidTransition(Exception):
    pass


# Client-reported states (via PATCH /sessions/{id}, see routes_sessions.py)
# stop at 'proof_generated'. 'submitted' and 'confirmed' are set ONLY by
# routes_nfc.py itself after it actually talks to Soroban — never trust
# a client to self-report success.
VALID_TRANSITIONS = {
    "pending": {"wallet_connected", "scanning", "expired", "failed"},
    "wallet_connected": {"scanning", "expired", "failed"},
    "scanning": {"proof_generated", "expired", "failed"},
    "proof_generated": {"submitted", "failed"},
    "submitted": {"confirmed", "failed"},
}


async def create_session(db: asyncpg.Connection, integrator_id, document_type: str) -> dict:
    row = await db.fetchrow(
        """
        INSERT INTO verification_sessions (integrator_id, document_type)
        VALUES ($1, $2)
        RETURNING id, integrator_id, document_type, status, created_at, expires_at
        """,
        integrator_id, document_type,
    )
    return dict(row)


async def get_session(db: asyncpg.Connection, session_id: UUID) -> dict:
    row = await db.fetchrow("SELECT * FROM verification_sessions WHERE id = $1", session_id)
    if not row:
        raise SessionNotFound(str(session_id))

    session = dict(row)
    if session["status"] not in ("confirmed", "failed", "expired") and session["expires_at"] < datetime.now(timezone.utc):
        await db.execute(
            "UPDATE verification_sessions SET status = 'expired', updated_at = NOW() WHERE id = $1",
            session_id,
        )
        session["status"] = "expired"
    return session


async def update_status(
    db: asyncpg.Connection,
    session_id: UUID,
    new_status: str,
    *,
    user_stellar_address: str | None = None,
    nullifier_hex: str | None = None,
    tx_hash: str | None = None,
    error_message: str | None = None,
) -> dict:
    session = await get_session(db, session_id)
    current = session["status"]

    if current in ("confirmed", "failed", "expired"):
        raise SessionExpired(f"Session {session_id} is already terminal ({current})")
    if new_status not in VALID_TRANSITIONS.get(current, set()):
        raise InvalidTransition(f"Invalid transition {current} -> {new_status}")

    row = await db.fetchrow(
        """
        UPDATE verification_sessions
        SET status = $1,
            user_stellar_address = COALESCE($2, user_stellar_address),
            nullifier_hex = COALESCE($3, nullifier_hex),
            tx_hash = COALESCE($4, tx_hash),
            error_message = COALESCE($5, error_message),
            updated_at = NOW()
        WHERE id = $6
        RETURNING *
        """,
        new_status, user_stellar_address, nullifier_hex, tx_hash, error_message, session_id,
    )
    return dict(row)


async def mark_failed_silently(db: asyncpg.Connection, session_id: UUID, error_message: str) -> None:
    """
    Best-effort session bookkeeping for failure paths inside routes_nfc.py.
    Swallows errors on purpose — a session-tracking hiccup must never mask
    or replace the real HTTPException already being raised to the client.
    """
    try:
        await update_status(db, session_id, "failed", error_message=error_message)
    except Exception:
        pass