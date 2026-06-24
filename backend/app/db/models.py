"""
models.py — schema (as raw SQL, run via migrations — see schema.sql)
and Pydantic request/response models for the relayer backend.

Three tables, intentionally minimal:
  integrators          — one row per dApp using the protocol
  sponsored_tx_log      — every sponsored submission, for spend-limit
                          enforcement and abuse investigation
  webhook_deliveries    — outbox pattern for webhook delivery + retries

No table here stores anything about an end user beyond a nullifier
(which is meaningless outside its own integrator namespace — see
nullifier.circom) and a wallet address. No name, no document data, no
date of birth. If a future migration adds a column that holds PII,
that's almost certainly the wrong design for this service.
"""
from pydantic import BaseModel
from datetime import datetime
from uuid import UUID
from typing import Optional
from enum import Enum


class WebhookStatus(str, Enum):
    PENDING = "pending"
    DELIVERED = "delivered"
    FAILED = "failed"  # exhausted retries


class VerificationStatus(str, Enum):
    SUBMITTED = "submitted"
    CONFIRMED = "confirmed"
    REJECTED = "rejected"  # on-chain verify() returned false or errored


# ─── Request/response models ──────────────────────────────────────────────

class IntegratorCreateRequest(BaseModel):
    integrator_id_hex: str  # the same 32-byte ID registered on-chain via kyc_registry
    name: str
    webhook_url: Optional[str] = None
    owner_stellar_address: str  # must match the `owner` registered on-chain — checked at relay time


class IntegratorResponse(BaseModel):
    id: UUID
    integrator_id_hex: str
    name: str
    api_key: Optional[str] = None  # only populated once, at creation/rotation time
    webhook_url: Optional[str]
    daily_sponsored_tx_limit: int
    is_active: bool
    created_at: datetime


class SubmitProofRequest(BaseModel):
    """What an integrator's frontend (via this relayer) submits after
    the SDK has produced a proof client-side. This payload contains NO
    PII — proofA/B/C and public_signals are opaque cryptographic
    material; nullifier is a per-integrator-namespaced hash."""
    nullifier_hex: str
    current_timestamp: int
    proof_a_hex: str  # 64 bytes, hex-encoded
    proof_b_hex: str  # 128 bytes, hex-encoded
    proof_c_hex: str  # 64 bytes, hex-encoded
    public_signals_hex: list[str]  # 5 field elements, each 32 bytes hex-encoded
    user_stellar_address: Optional[str] = None  # for sponsorship fee-bump targeting, if known


class SubmitProofResponse(BaseModel):
    submission_id: UUID
    status: VerificationStatus
    tx_hash: Optional[str] = None
    message: str


class WebhookPayload(BaseModel):
    """The payload POSTed to an integrator's webhook_url. Mirrors the
    shape sketched in the original scaffold's webhook_service.py
    (`{"status": "verified"}`), extended with enough context for the
    integrator to correlate it to their own request without us ever
    including PII."""
    event: str = "kyc.verification.completed"
    integrator_id_hex: str
    nullifier_hex: str
    status: VerificationStatus
    tx_hash: Optional[str]
    submission_id: UUID
    timestamp: datetime