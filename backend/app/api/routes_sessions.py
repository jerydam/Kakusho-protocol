"""
routes_sessions.py — desktop<->mobile QR handoff for NFC verification.

Flow:
  1. Desktop POSTs /sessions, gets a session_id, renders a QR code, then
     subscribes to GET /sessions/{id}/stream (SSE) for real-time updates —
     no more polling.
  2. Mobile scans the QR, opens the deeplink, checks /credential/check to
     see if already self-verified; if yes, auto-delegates. If no, runs NFC.
  3. The SSE stream pushes every status change instantly to the desktop tab.
"""
import asyncio
import json
from uuid import UUID
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import asyncpg

from app.db.database import get_db
from app.services import verification_session as session_service
from app.services.nfc_policy import DocumentType

router = APIRouter(prefix="/sessions", tags=["sessions"])

# How often to push a keepalive comment while waiting (seconds)
SSE_KEEPALIVE_INTERVAL = 15
# Max time to hold an SSE connection open before forcing client reconnect (seconds)
SSE_MAX_DURATION = 300
# How often to poll the DB for status changes inside the SSE handler (seconds)
SSE_POLL_INTERVAL = 1


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


@router.get("/{session_id}/stream")
async def stream_session_status(
    session_id: UUID,
    request: Request,
    db: asyncpg.Connection = Depends(get_db),
):
    """
    Server-Sent Events stream for real-time session status.

    The desktop tab subscribes here instead of polling GET /sessions/{id}
    every 2 s. Each DB status change is pushed immediately as an SSE event.
    The stream closes itself when the session reaches a terminal state
    (confirmed / failed / expired) or after SSE_MAX_DURATION seconds.

    Event format:
        event: session_update
        data: {"id": "...", "status": "...", "tx_hash": "...", ...}

    Keepalive comments (": keepalive") are sent every SSE_KEEPALIVE_INTERVAL
    seconds so load-balancers / proxies don't kill the connection.

    Usage (browser):
        const es = new EventSource(`/sessions/${id}/stream`);
        es.addEventListener('session_update', e => {
            const session = JSON.parse(e.data);
            if (['confirmed','failed','expired'].includes(session.status)) es.close();
        });
    """
    async def event_generator() -> AsyncGenerator[str, None]:
        terminal = {"confirmed", "failed", "expired"}
        last_status: str | None = None
        elapsed = 0

        while elapsed < SSE_MAX_DURATION:
            # Check if the client disconnected
            if await request.is_disconnected():
                break

            try:
                session = await session_service.get_session(db, session_id)
            except session_service.SessionNotFound:
                yield "event: error\ndata: {\"detail\": \"Session not found or expired\"}\n\n"
                return

            current_status = session["status"]

            # Push an update whenever status changes
            if current_status != last_status:
                payload = {
                    "id": str(session["id"]),
                    "status": current_status,
                    "document_type": session.get("document_type"),
                    "user_stellar_address": session.get("user_stellar_address"),
                    "nullifier_hex": session.get("nullifier_hex"),
                    "tx_hash": session.get("tx_hash"),
                    "error_message": session.get("error_message"),
                }
                yield f"event: session_update\ndata: {json.dumps(payload)}\n\n"
                last_status = current_status

                if current_status in terminal:
                    return

            # Keepalive comment
            if elapsed % SSE_KEEPALIVE_INTERVAL == 0 and elapsed > 0:
                yield ": keepalive\n\n"

            await asyncio.sleep(SSE_POLL_INTERVAL)
            elapsed += SSE_POLL_INTERVAL

        # Max duration hit — tell the client to reconnect
        yield "event: timeout\ndata: {\"detail\": \"Stream timeout — reconnect to continue\"}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # disable nginx buffering
            "Connection": "keep-alive",
        },
    )



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