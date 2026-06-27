"""
routes_sessions.py — desktop<->mobile QR handoff for NFC verification.
See app/services/verification_session.py for the full design rationale.

Flow:
  1. Desktop, on hitting an NFC-required step, POSTs /sessions to create
     one, then renders a QR code linking to a deep link for the native
     scanner companion (see /mobile-companion/README.md) carrying this
     session_id, and starts polling GET /sessions/{id}.
  2. Whoever scans the QR (the native app) reports lightweight progress
     via PATCH /sessions/{id} (wallet_connected / scanning / proof_generated),
     then calls the existing /nfc/verify-chip + /nfc/submit-proof
     endpoints with this session_id attached, so routes_nfc.py can mark
     the session 'submitted'/'failed' itself.
  3. The desktop's poll loop sees the status change and proceeds.

Remember to register this router in main.py:
    app.include_router(routes_sessions.router)
"""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
import asyncpg

from app.db.database import get_db
from app.services import verification_session as session_service
from app.services.nfc_policy import DocumentType

router = APIRouter(prefix="/sessions", tags=["sessions"])


class CreateSessionRequest(BaseModel):
    integrator_id: str
    document_type: DocumentType = DocumentType.PASSPORT


class SessionResponse(BaseModel):
    id: str
    status: str
    document_type: str | None = None
    user_stellar_address: str | None = None
    nullifier_hex: str | None = None
    tx_hash: str | None = None
    error_message: str | None = None


class UpdateSessionStatusRequest(BaseModel):
    status: str = Field(..., description="wallet_connected | scanning | proof_generated | failed")
    user_stellar_address: str | None = None
    error_message: str | None = None


@router.post("", response_model=SessionResponse)
async def create_session(
    body: CreateSessionRequest,
    db: asyncpg.Connection = Depends(get_db),
):
    integrator = await db.fetchrow(
    "SELECT id FROM integrators WHERE integrator_id_hex = $1 AND is_active = TRUE",
    body.integrator_id,
)

    if not integrator:
        raise HTTPException(status_code=404, detail="Integrator not found or inactive")

    session = await session_service.create_session(db, integrator["id"], body.document_type.value)
    return SessionResponse(id=str(session["id"]), status=session["status"], document_type=session["document_type"])


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session_status(
    session_id: UUID,
    db: asyncpg.Connection = Depends(get_db),
):
    """
    Polled by the desktop tab every ~2s. Returns no integrator secrets —
    just enough for the desktop UI to react (status text, and on
    'submitted', the tx_hash to link to a Soroban explorer).
    """
    try:
        session = await session_service.get_session(db, session_id)
    except session_service.SessionNotFound:
        raise HTTPException(status_code=404, detail="Session not found or expired")

    return SessionResponse(
        id=str(session["id"]),
        status=session["status"],
        document_type=session["document_type"],
        user_stellar_address=session["user_stellar_address"],
        nullifier_hex=session["nullifier_hex"],
        tx_hash=session["tx_hash"],
        error_message=session["error_message"],
    )


@router.patch("/{session_id}", response_model=SessionResponse)
async def update_session_status(
    session_id: UUID,
    body: UpdateSessionStatusRequest,
    db: asyncpg.Connection = Depends(get_db),
):
    """
    Covers only the pre-submission states. 'submitted'/'confirmed' are
    set by routes_nfc.py itself, never accepted here — so a buggy or
    malicious mobile client can't self-report a fake success.
    """
    if body.status in ("submitted", "confirmed"):
        raise HTTPException(
            status_code=400,
            detail="submitted/confirmed are set automatically by the proof submission endpoint",
        )
    try:
        session = await session_service.update_status(
            db, session_id, body.status,
            user_stellar_address=body.user_stellar_address,
            error_message=body.error_message,
        )
    except session_service.SessionNotFound:
        raise HTTPException(status_code=404, detail="Session not found")
    except session_service.SessionExpired as e:
        raise HTTPException(status_code=409, detail=str(e))
    except session_service.InvalidTransition as e:
        raise HTTPException(status_code=400, detail=str(e))

    return SessionResponse(
        id=str(session["id"]),
        status=session["status"],
        document_type=session["document_type"],
        user_stellar_address=session["user_stellar_address"],
    )