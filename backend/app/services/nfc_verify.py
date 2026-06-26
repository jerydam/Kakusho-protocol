"""
nfc_verify.py — Passive Authentication for ePassport / eID NFC chips.

Passive Authentication verifies that the data on an NFC chip was signed
by the issuing country's Document Signer (DS) certificate, which itself
chains to that country's Country Signing CA (CSCA). It proves the chip
is genuine without requiring the chip to perform any cryptography itself
(unlike Active Authentication or PACE/BAC).

VERIFICATION CHAIN:
  DG1 raw bytes
    → SHA-256 hash
      → matches SOD's recorded DG1 hash?          (hash check)
  SOD's DG hash list
    → signed by DS certificate pubkey?             (RSA/ECDSA sig check)
  DS certificate
    → signed by CSCA certificate?                  (cert chain check)
  CSCA certificate
    → in our trusted CSCA master list?             (trust anchor check)

The result of this chain is a go/no-go for witness generation:
if it passes, nfc_verify.py calls nfc_witness_builder (via Node) with
the verified DG1 hash + SOD hash as paired inputs for the ZK circuit.

CALLED FROM: routes_nfc.py, which receives the chip payload from the
frontend (Web NFC API on Android, or USB reader relay on desktop).

DOES NOT replace on-chain verification. Same relationship to
kyc_registry as snarkjs_verify.py has to the contract: this is a
pre-filter so bad chips never reach proof generation at all.
"""
import hashlib
import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from asn1crypto import cms, core, pem, x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from cryptography.x509 import load_der_x509_certificate
from loguru import logger

# CSCA master list — a PEM bundle of all ICAO member state root
# certificates. Download from:
#   https://www.icao.int/Security/FAL/PKD/Pages/ICAO-Master-List.aspx
# (free to download, requires registration)
# Or use the OpenMDL open-source version:
#   https://github.com/UsePassport/open-csca-masterlist
# Keep this updated annually. Stale trust anchors = stale verification.
CSCA_MASTERLIST_PATH = Path(__file__).parent.parent.parent / "data" / "csca_masterlist.pem"


class NFCVerificationError(Exception):
    """Raised for any failure in the Passive Authentication chain."""
    pass


class CSCANotFoundError(NFCVerificationError):
    """Raised when the DS cert's issuer isn't in our trusted CSCA list."""
    pass


@dataclass
class PassiveAuthResult:
    """
    Returned by verify_passive_auth() when verification succeeds.
    All fields are needed downstream: dg1_bytes → parsed for DOB/expiry/country,
    dg1_hash_hex + sod_dg1_hash_hex → paired inputs to the ZK circuit (they
    must match — that's what the circuit proves), ds_cert_subject → logged for
    audit.
    """
    dg1_bytes: bytes
    dg1_hash_hex: str        # SHA-256 of dg1_bytes, computed here
    sod_dg1_hash_hex: str    # SHA-256 hash of DG1 as recorded in the SOD
    ds_cert_subject: str     # issuing DS cert DN, for audit logging
    country_code_alpha2: str # 2-letter country code from DS cert


def _load_csca_certs() -> list:
    """
    Loads all PEM certificates from CSCA_MASTERLIST_PATH.
    Returns a list of cryptography.x509.Certificate objects.
    Cached at module level after first load — these don't change at runtime.
    """
    if not CSCA_MASTERLIST_PATH.exists():
        raise NFCVerificationError(
            f"CSCA master list not found at {CSCA_MASTERLIST_PATH}. "
            "Download from https://www.icao.int/Security/FAL/PKD/Pages/ICAO-Master-List.aspx "
            "or use the open-source bundle at https://github.com/UsePassport/open-csca-masterlist"
        )
    certs = []
    with open(CSCA_MASTERLIST_PATH, "rb") as f:
        data = f.read()
    # PEM files can contain multiple certificates
    for _, _, der_bytes in pem.unarmor(data, multiple=True):
        try:
            certs.append(load_der_x509_certificate(der_bytes))
        except Exception as e:
            logger.warning(f"Skipping unparseable CSCA cert: {e}")
    if not certs:
        raise NFCVerificationError("CSCA master list loaded but contained no parseable certificates")
    logger.debug(f"Loaded {len(certs)} CSCA trust anchors")
    return certs


_csca_cache: Optional[list] = None


def _get_csca_certs() -> list:
    global _csca_cache
    if _csca_cache is None:
        _csca_cache = _load_csca_certs()
    return _csca_cache


def _parse_sod(sod_bytes: bytes) -> tuple[dict[int, bytes], bytes, object]:
    """
    Parses the Document Security Object (SOD), which is a CMS SignedData
    structure as defined in ICAO 9303 Part 10.

    Returns:
        dg_hashes: dict mapping DG number → expected SHA-256 hash bytes
        sod_signature: the DS certificate's signature bytes
        ds_cert: the signer's X.509 certificate (as asn1crypto x509.Certificate)

    SOD structure (simplified):
        ContentInfo
          └─ SignedData
               ├─ encapContentInfo (LDSSecurityObject)
               │    └─ dataGroups: [(dg_number, hash_bytes), ...]
               ├─ certificates: [DS certificate]
               └─ signerInfos: [{ signature, digestAlgorithm }]
    """
    try:
        content_info = cms.ContentInfo.load(sod_bytes)
        signed_data = content_info["content"].parsed
    except Exception as e:
        raise NFCVerificationError(f"Failed to parse SOD as CMS SignedData: {e}")

    # Extract the embedded DS certificate
    certs = signed_data["certificates"]
    if len(certs) == 0:
        raise NFCVerificationError("SOD contains no embedded DS certificate")
    ds_cert_asn1 = certs[0].chosen  # asn1crypto Certificate

    # Extract DG hash map from LDSSecurityObject inside encapContentInfo
    try:
        lds_obj = signed_data["encap_content_info"]["content"].parsed
        dg_hashes = {}
        for dg_hash_entry in lds_obj["data_group_hash_values"]:
            dg_number = int(dg_hash_entry["data_group_number"])
            hash_bytes = bytes(dg_hash_entry["data_group_hash_value"])
            dg_hashes[dg_number] = hash_bytes
    except Exception as e:
        raise NFCVerificationError(f"Failed to parse LDSSecurityObject from SOD: {e}")

    # Extract the signature from signerInfos
    signer_infos = signed_data["signer_infos"]
    if len(signer_infos) == 0:
        raise NFCVerificationError("SOD contains no signer info")
    sod_signature = bytes(signer_infos[0]["signature"])

    return dg_hashes, sod_signature, ds_cert_asn1


def _verify_sod_signature(signed_data_bytes: bytes, signature: bytes, ds_cert_der: bytes) -> None:
    """
    Verifies that `signature` is a valid signature by the DS certificate
    over `signed_data_bytes`. Supports both RSA (most passports) and
    ECDSA (newer passports, many EU eIDs).

    Raises NFCVerificationError on failure.
    """
    ds_cert = load_der_x509_certificate(ds_cert_der)
    pubkey = ds_cert.public_key()

    try:
        if isinstance(pubkey, rsa.RSAPublicKey):
            pubkey.verify(
                signature,
                signed_data_bytes,
                padding.PKCS1v15(),
                hashes.SHA256(),
            )
        elif isinstance(pubkey, ec.EllipticCurvePublicKey):
            pubkey.verify(
                signature,
                signed_data_bytes,
                ec.ECDSA(hashes.SHA256()),
            )
        else:
            raise NFCVerificationError(
                f"Unsupported DS certificate key type: {type(pubkey).__name__}. "
                "Only RSA and ECDSA are supported."
            )
    except Exception as e:
        # Distinguish crypto failure from our error
        if isinstance(e, NFCVerificationError):
            raise
        raise NFCVerificationError(f"SOD signature verification failed: {e}")


def _find_csca_for_ds_cert(ds_cert_der: bytes) -> None:
    """
    Checks that the DS certificate was signed by a CSCA in our trusted
    master list. Matches by issuer name then verifies the signature.

    Raises CSCANotFoundError if no matching trusted CSCA is found.

    NOTE: This is "path building" without full RFC 5280 path validation
    (no revocation checking, no constraint checking). For production use,
    consider using OpenSSL's full verification path via subprocess or a
    dedicated PKI library. The depth here (DS → CSCA) is only 1 level,
    so the simplified approach is reasonable for ePassports.
    """
    ds_cert = load_der_x509_certificate(ds_cert_der)
    ds_issuer = ds_cert.issuer

    for csca_cert in _get_csca_certs():
        if csca_cert.subject != ds_issuer:
            continue
        # Issuer name matches — verify the DS cert signature
        try:
            csca_pubkey = csca_cert.public_key()
            if isinstance(csca_pubkey, rsa.RSAPublicKey):
                csca_pubkey.verify(
                    ds_cert.signature,
                    ds_cert.tbs_certificate_bytes,
                    padding.PKCS1v15(),
                    hashes.SHA256(),
                )
            elif isinstance(csca_pubkey, ec.EllipticCurvePublicKey):
                csca_pubkey.verify(
                    ds_cert.signature,
                    ds_cert.tbs_certificate_bytes,
                    ec.ECDSA(hashes.SHA256()),
                )
            else:
                continue
            logger.debug(
                f"DS cert verified against CSCA: {csca_cert.subject.rfc4514_string()}"
            )
            return  # Found and verified
        except Exception:
            continue  # This CSCA didn't sign it; keep looking

    raise CSCANotFoundError(
        f"No trusted CSCA found for DS certificate issuer: "
        f"{ds_issuer.rfc4514_string()}. "
        "Ensure your CSCA master list is current."
    )


def verify_passive_auth(
    dg1_bytes: bytes,
    sod_bytes: bytes,
) -> PassiveAuthResult:
    """
    Performs ICAO 9303 Passive Authentication on an ePassport chip read.

    Args:
        dg1_bytes: raw bytes of Data Group 1 (MRZ data), as read from
                   the chip via SELECT FILE 0101 + READ BINARY.
        sod_bytes: raw bytes of the Document Security Object (EF.SOD),
                   as read from the chip via SELECT FILE 011D + READ BINARY.

    Returns:
        PassiveAuthResult with both hash values ready for ZK witness generation.

    Raises:
        NFCVerificationError: if any step in the chain fails.

    HOW THE HASH PAIR FEEDS THE ZK CIRCUIT:
        result.dg1_hash_hex    → circuit private input dg1_data_bits
        result.sod_dg1_hash_hex → circuit public input sod_dg1_hash_bits
    The circuit constrains that these two 256-bit values are identical.
    The DS signature check (which this function performs) is what gives
    sod_dg1_hash_hex its trustworthiness — it came from a cert chain we
    verified. The circuit proves the prover knows DG1 data that hashes
    to the DS-certified value.
    """
    # Step 1: Hash the actual DG1 bytes we read from the chip
    dg1_hash = hashlib.sha256(dg1_bytes).digest()
    dg1_hash_hex = dg1_hash.hex()

    # Step 2: Parse the SOD to get the DS-signed DG hash table + signature
    dg_hashes, sod_signature, ds_cert_asn1 = _parse_sod(sod_bytes)

    # DG1 is data group 1
    if 1 not in dg_hashes:
        raise NFCVerificationError(
            "SOD does not contain a hash for DG1. This chip may be incomplete or malformed."
        )
    sod_dg1_hash = dg_hashes[1]
    sod_dg1_hash_hex = sod_dg1_hash.hex()

    # Step 3: Verify the DG1 hash we computed matches the SOD's recorded hash
    # (This is the check the ZK circuit will ALSO perform — we do it here
    # as a fast fail before attempting proof generation)
    if dg1_hash != sod_dg1_hash:
        raise NFCVerificationError(
            f"DG1 hash mismatch: chip data hashes to {dg1_hash_hex[:16]}... "
            f"but SOD records {sod_dg1_hash_hex[:16]}... — chip data may be tampered."
        )

    # Step 4: Verify the SOD's signature against the embedded DS certificate
    # The SOD's signed data (the LDSSecurityObject bytes + signedAttrs) is
    # what the DS cert actually signed. We use asn1crypto to get the DER
    # encoding of the signedAttrs for verification.
    try:
        content_info = cms.ContentInfo.load(sod_bytes)
        signed_data = content_info["content"].parsed
        signer_info = signed_data["signer_infos"][0]

        # ICAO 9303 requires signed attributes (signedAttrs) when present.
        # The DS cert signs the DER encoding of the signedAttrs set.
        signed_attrs = signer_info["signed_attrs"]
        if signed_attrs.native is not None:
            # signed_attrs is a SET — must be DER-encoded with 0x31 tag
            data_to_verify = signed_attrs.dump()
        else:
            # No signedAttrs: sign the raw content (less common)
            data_to_verify = bytes(signed_data["encap_content_info"]["content"])

        ds_cert_der = ds_cert_asn1.dump()
        _verify_sod_signature(data_to_verify, sod_signature, ds_cert_der)
    except NFCVerificationError:
        raise
    except Exception as e:
        raise NFCVerificationError(f"SOD signature verification failed: {e}")

    # Step 5: Verify the DS certificate chains to a trusted CSCA
    _find_csca_for_ds_cert(ds_cert_der)

    # Extract country code from DS cert subject (C= attribute = ISO 3166-1 alpha-2)
    try:
        country_code = ds_cert_asn1.subject.human_friendly.split("C=")[1].split(",")[0].strip()
    except (IndexError, AttributeError):
        country_code = "XX"  # Unknown — non-fatal; logged for audit

    logger.info(
        f"Passive Authentication succeeded: DG1 hash {dg1_hash_hex[:16]}..., "
        f"DS issuer: {ds_cert_asn1.subject.human_friendly[:60]}, "
        f"country: {country_code}"
    )

    return PassiveAuthResult(
        dg1_bytes=dg1_bytes,
        dg1_hash_hex=dg1_hash_hex,
        sod_dg1_hash_hex=sod_dg1_hash_hex,
        ds_cert_subject=ds_cert_asn1.subject.human_friendly,
        country_code_alpha2=country_code,
    )