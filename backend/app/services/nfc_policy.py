"""
nfc_policy.py — resolves an integrator's document-type and NFC
requirements into a single decision: "does THIS document type, for
THIS integrator, require an NFC chip proof, or is an OCR-only proof
acceptable?"

This is intentionally the ONLY place that encodes this rule, so
routes_proof.py (OCR path) and routes_nfc.py (NFC path) can't drift
out of sync on what "passport requires NFC" means.

Policy lives in two integrator-operational columns (same layer as
webhook_url / daily_sponsored_tx_limit — see routes_integrator.py's
module docstring, NOT on-chain rules):
  integrators.allowed_document_types  — jsonb array of DocumentType values
  integrators.nfc_policy               — one of NFCPolicy

If you later want this enforced on-chain too (so an integrator can't
quietly relax it without anyone noticing), you'd add a parallel field
to kyc_registry's IntegratorConfig and check it in verify() — that's
out of scope here; this module only gates which relayer endpoint will
accept a given submission.
"""
import json
from enum import Enum


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