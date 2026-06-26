"""
routes_nfc.py — HTTP endpoints for NFC chip verification.

Two endpoints:
  POST /nfc/verify-chip
    Receives raw DG1 + SOD bytes from the frontend (or a USB reader relay),
    runs Passive Authentication via nfc_verify.py, and returns a signed
    witness-input payload ready for the frontend to pass into the ZK
    proof generation step.

  POST /nfc/submit-proof
    Receives a completed ZK proof (generated client-side from the
    nfc_chip_verify.circom witness) and submits it to kyc_registry on
    Soroban — same submission path as routes_proof.py uses for OCR proofs.

RELATIONSHIP TO routes_proof.py:
routes_nfc.py does NOT duplicate routes_proof.py's Soroban submission
logic. Instead, /nfc/submit-proof reuses the same off-chain snarkjs
pre-check and spend-limit guard, then calls stellar_sponsor.submit_verification()
with the NFC proof's signals. The only difference from OCR proofs is
which public signals the circuit produces — the Soroban contract
doesn't care which circuit generated the proof, only that it verifies
against the registered VK for that circuit type.

NOTE: If you support BOTH ocr and nfc proof types in the same registry,
you'll need separate verification keys (one per compiled circuit) and
the integrator registration must record which VK to use for each type.
The current kyc_registry has a single DEFAULT_VK — extend storage.rs's
IntegratorConfig to add a nfc_vk field if you want per-integrator NFC VKs.
"""
import base64
from uuid import UUID
import json
from enum import Enum
from fastapi import APIRouter, Depends, HTTPException, Request
from loguru import logger
from pydantic import BaseModel, Field

from app.core.config import settings
from app.db.database import get_db
from app.services.nfc_verify import NFCVerificationError, verify_passive_auth
from app.services.snarkjs_verify import OffChainVerificationError, verify_proof_off_chain
from app.services.spend_limit import SpendLimitExceeded, check_and_reserve
from app.services.stellar_sponsor import submit_verification
from app.services.webhook_service import WebhookPayload, enqueue_webhook

router = APIRouter(prefix="/nfc", tags=["nfc"])


class NFCChipPayload(BaseModel):
    """
    Sent by the frontend after reading the NFC chip.

    dg1_b64: base64-encoded raw DG1 bytes (MRZ data group).
              The frontend reads this via Web NFC / ISO 14443-4 APDU:
              SELECT FILE [01 01] then READ BINARY.

    sod_b64: base64-encoded raw SOD bytes (EF.SOD — Document Security Object).
             SELECT FILE [01 1D] then READ BINARY.

    integrator_id: hex-encoded 32-byte integrator ID, same as OCR proofs.

    Both fields are base64 to avoid JSON encoding issues with binary data.
    Max sizes are generous — a real SOD is ~2-4 KB; DG1 is ~100 bytes.
    """
    dg1_b64: str = Field(..., description="Base64-encoded DG1 bytes from NFC chip")
    sod_b64: str = Field(..., description="Base64-encoded SOD bytes from NFC chip")
    integrator_id: str = Field(..., description="Hex-encoded 32-byte integrator ID")


class NFCVerifyResponse(BaseModel):
    """
    Returned to the frontend after successful Passive Authentication.
    These fields are the PRIVATE + PUBLIC inputs for nfc_chip_verify.circom.
    The frontend passes them to nfc_witness_builder.ts / snarkjs to generate
    the ZK proof, then calls /nfc/submit-proof with the result.

    dg1_hash_hex: SHA-256 of the DG1 bytes — feeds circuit's dg1_data_bits.
    sod_dg1_hash_hex: the same hash as recorded in the SOD — feeds
                      circuit's public sod_dg1_hash_bits. They must match.
    country_alpha2: 2-letter country code from DS cert — for logging/display.
    """
    dg1_hash_hex: str
    sod_dg1_hash_hex: str
    country_alpha2: str
    integrator_id: str


class NFCProofSubmitPayload(BaseModel):
    """
    Sent by the frontend after generating a ZK proof from the NFC witness.
    Same structure as the OCR proof submission — proof_a/b/c + public signals.

    public_signals is a list of hex-encoded 32-byte field elements. For the
    nfc_chip_verify circuit with the current template, there are 3 public signals:
      [0] chip_commitment (output)
      [1] nullifier (output)
      [2] current_timestamp

    Plus the 256-bit sod_dg1_hash is packed into the public signal list as
    8 × 32-byte chunks by nfc_witness_builder.ts — see that file's comment
    for the packing scheme. Adjust public_signals ordering to match whatever
    snarkjs produces for the compiled circuit.
    """
    integrator_id: str
    nullifier_hex: str
    current_timestamp: int
    proof_a_hex: str
    proof_b_hex: str
    proof_c_hex: str
    public_signals_hex: list[str]
class DocumentType(str, Enum):
    PASSPORT = "passport"
    NATIONAL_ID = "national_id"
    DRIVERS_LICENSE = "drivers_license"
 
 
class NFCPolicy(str, Enum):
    OPTIONAL = "optional"                              # NFC never required, OCR always accepted
    REQUIRED_FOR_PASSPORT = "required_for_passport"     # default — ICAO chip docs only
    ALWAYS_REQUIRED = "always_required"                 # every accepted document type must use NFC
    NEVER = "never"                                     # NFC path disabled entirely for this integrator
 
 
DEFAULT_ALLOWED_DOCUMENT_TYPES = [DocumentType.PASSPORT.value]
DEFAULT_NFC_POLICY = NFCPolicy.REQUIRED_FOR_PASSPORT.value
 
ALL_DOCUMENT_TYPES = [d.value for d in DocumentType]
ALL_NFC_POLICIES = [p.value for p in NFCPolicy]
 
 
class DocumentTypeNotAllowed(Exception):
    def __init__(self, document_type: str, allowed: list[str]):
        self.document_type = document_type
        self.allowed = allowed
        super().__init__(
            f"Document type '{document_type}' is not accepted by this integrator. "
            f"Allowed: {allowed}"
        )
 
 
def parse_allowed_document_types(integrator: dict) -> list[str]:
    """
    integrators.allowed_document_types is jsonb. asyncpg returns jsonb
    as a raw string UNLESS you've registered a json codec on your pool
    (see app/db/database.py) — handle both shapes defensively so this
    doesn't silently misbehave depending on how the connection was set up.
    """
    raw = integrator.get("allowed_document_types")
    if raw is None:
        return DEFAULT_ALLOWED_DOCUMENT_TYPES
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return DEFAULT_ALLOWED_DOCUMENT_TYPES
        return parsed
    return raw
 
 
def get_nfc_policy(integrator: dict) -> str:
    return integrator.get("nfc_policy") or DEFAULT_NFC_POLICY
 
 
def assert_document_type_allowed(document_type: str, integrator: dict) -> None:
    """Raises DocumentTypeNotAllowed if this integrator doesn't accept this doc type."""
    allowed = parse_allowed_document_types(integrator)
    if document_type not in allowed:
        raise DocumentTypeNotAllowed(document_type, allowed)
 
 
def nfc_required(document_type: str, integrator: dict) -> bool:
    """
    True if `document_type`, under this integrator's nfc_policy, must
    go through the NFC chip-read flow (routes_nfc.py) rather than the
    OCR-only flow (routes_proof.py).
    """
    policy = get_nfc_policy(integrator)
 
    if policy == NFCPolicy.ALWAYS_REQUIRED.value:
        return True
    if policy == NFCPolicy.NEVER.value:
        return False
    if policy == NFCPolicy.REQUIRED_FOR_PASSPORT.value:
        return document_type == DocumentType.PASSPORT.value
    # OPTIONAL, or an unrecognized stored value — fail open to "not
    # required", since this only gates which endpoint is acceptable,
    # not whether a proof is required at all.
    return False
 

@router.post("/verify-chip", response_model=NFCVerifyResponse)
async def verify_nfc_chip(
    payload: NFCChipPayload,
    db=Depends(get_db),
):
    """
    Step 1 of NFC verification: Passive Authentication.

    Receives raw chip bytes, runs the CSCA→DS→SOD→DG1 hash chain,
    and returns the hash pair ready for ZK witness generation.

    DOES NOT generate or verify the ZK proof — that happens client-side
    (witness generation is CPU-intensive and contains the user's
    user_secret, which must never leave their device).
    """
    # Decode base64 payload
    try:
        dg1_bytes = base64.b64decode(payload.dg1_b64)
        sod_bytes = base64.b64decode(payload.sod_b64)
    except Exception:
        raise HTTPException(status_code=400, detail="dg1_b64 or sod_b64 is not valid base64")

    # Sanity-check sizes before doing any crypto
    if len(dg1_bytes) < 50 or len(dg1_bytes) > 512:
        raise HTTPException(
            status_code=400,
            detail=f"DG1 length {len(dg1_bytes)} is outside expected range (50–512 bytes)"
        )
    if len(sod_bytes) < 500 or len(sod_bytes) > 16384:
        raise HTTPException(
            status_code=400,
            detail=f"SOD length {len(sod_bytes)} is outside expected range (500–16384 bytes)"
        )

    # Validate integrator exists and is active
    integrator = await db.fetchrow(
        "SELECT daily_sponsored_tx_limit, active FROM integrators WHERE id = $1",
        payload.integrator_id,
    )
    if not integrator:
        raise HTTPException(status_code=404, detail="Integrator not found")
    if not integrator["active"]:
        raise HTTPException(status_code=403, detail="Integrator is inactive")

    # Run Passive Authentication chain: DG1 hash ↔ SOD hash ↔ DS cert ↔ CSCA
    try:
        result = verify_passive_auth(dg1_bytes, sod_bytes)
    except NFCVerificationError as e:
        logger.warning(
            f"NFC Passive Authentication failed for integrator {payload.integrator_id}: {e}"
        )
        raise HTTPException(status_code=422, detail=f"NFC verification failed: {e}")

    logger.info(
        f"NFC Passive Authentication passed: integrator={payload.integrator_id}, "
        f"country={result.country_code_alpha2}, "
        f"dg1_hash={result.dg1_hash_hex[:16]}..."
    )

    return NFCVerifyResponse(
        dg1_hash_hex=result.dg1_hash_hex,
        sod_dg1_hash_hex=result.sod_dg1_hash_hex,
        country_alpha2=result.country_code_alpha2,
        integrator_id=payload.integrator_id,
    )


@router.post("/submit-proof")
async def submit_nfc_proof(
    payload: NFCProofSubmitPayload,
    db=Depends(get_db),
):
    """
    Step 2 of NFC verification: ZK proof submission.

    Receives a completed Groth16 proof from nfc_chip_verify.circom,
    runs the same off-chain pre-check and spend-limit guard as
    routes_proof.py, then submits to kyc_registry on Soroban.

    This is intentionally near-identical to routes_proof.py's POST /proof
    handler. The only structural difference is the circuit that produced
    the proof (nfc vs ocr) — the Soroban submission and webhook delivery
    are identical. If you factor out a shared _submit_verified_proof()
    helper, both routes can call it.
    """
    # Validate integrator
    integrator = await db.fetchrow(
        "SELECT daily_sponsored_tx_limit, active, webhook_url, webhook_secret, id "
        "FROM integrators WHERE id = $1",
        payload.integrator_id,
    )
    if not integrator:
        raise HTTPException(status_code=404, detail="Integrator not found")
    if not integrator["active"]:
        raise HTTPException(status_code=403, detail="Integrator is inactive")

    # Off-chain ZK pre-check (same as snarkjs_verify.py used in routes_proof.py)
    # Uses the NFC circuit's verification key — keep a separate vk file for
    # each circuit type at zk/nfc_verification_key.json after trusted setup.
    try:
        valid = verify_proof_off_chain(
            payload.proof_a_hex,
            payload.proof_b_hex,
            payload.proof_c_hex,
            payload.public_signals_hex,
            # Pass the NFC VK path — verify_proof_off_chain will need a vk_path
            # parameter (minor extension to snarkjs_verify.py) or a separate
            # NFCOffChainVerifier class pointing to the NFC verification key.
            # For now, assume verify_proof_off_chain accepts an optional vk_path:
            # vk_path=settings.NFC_VK_PATH
        )
    except OffChainVerificationError as e:
        logger.warning(f"NFC proof malformed (integrator {payload.integrator_id}): {e}")
        raise HTTPException(status_code=400, detail=f"Malformed proof: {e}")

    if not valid:
        logger.warning(f"NFC off-chain proof check failed: integrator={payload.integrator_id}")
        raise HTTPException(status_code=400, detail="Proof failed off-chain verification")

    # Spend-limit guard (same as routes_proof.py)
    try:
        await check_and_reserve(
            db, payload.integrator_id, integrator["daily_sponsored_tx_limit"]
        )
    except SpendLimitExceeded as e:
        raise HTTPException(
            status_code=429,
            detail=f"Daily spend limit reached: {e.used}/{e.limit} transactions used",
        )

    # Submit to Soroban
    submission = await submit_verification(
        integrator_id_hex=payload.integrator_id,
        nullifier_hex=payload.nullifier_hex,
        current_timestamp=payload.current_timestamp,
        proof_a_hex=payload.proof_a_hex,
        proof_b_hex=payload.proof_b_hex,
        proof_c_hex=payload.proof_c_hex,
        public_signals_hex=payload.public_signals_hex,
    )

    if not submission.success:
        logger.error(
            f"Soroban submission failed: integrator={payload.integrator_id}, "
            f"error={submission.error}"
        )
        raise HTTPException(status_code=502, detail=f"Soroban submission failed: {submission.error}")

    # Log the sponsored transaction (same table as OCR proofs)
    submission_id = await db.fetchval(
        """
        INSERT INTO sponsored_tx_log
          (integrator_id, nullifier, tx_hash, proof_type, created_at)
        VALUES ($1, $2, $3, 'nfc', NOW())
        RETURNING id
        """,
        integrator["id"],
        payload.nullifier_hex,
        submission.tx_hash,
    )

    # Enqueue webhook delivery (same outbox pattern as routes_proof.py)
    if integrator["webhook_url"]:
        await enqueue_webhook(
            db,
            submission_id,
            integrator["id"],
            WebhookPayload(
                event="nfc.verified",
                nullifier=payload.nullifier_hex,
                tx_hash=submission.tx_hash,
                integrator_id=payload.integrator_id,
            ),
        )

    return {
        "tx_hash": submission.tx_hash,
        "nullifier": payload.nullifier_hex,
        "proof_type": "nfc",
    }