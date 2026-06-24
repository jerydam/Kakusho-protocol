"""
snarkjs_verify.py — fast off-chain Groth16 verification using snarkjs's
CLI/Node bindings, run BEFORE this backend spends any real XLM
submitting a proof to Soroban.

Why this exists as a separate step from the on-chain check: Soroban's
verify() call costs real fees once submitted, and a malformed or
deliberately invalid proof submitted repeatedly is a cheap way to drain
a sponsor wallet through pure spam, even though each individual
submission would correctly return `false` or fail on-chain. Rejecting
obviously-bad proofs HERE, off-chain, for free, before they ever reach
stellar_sponsor.py, is the main defense against that — combined with
the integrator-scoped daily spend limit in stellar_sponsor.py for
defense in depth.

This does NOT replace the on-chain check. It uses the SAME verification
key as the Soroban contract (same circuit, same trusted setup output)
to run the identical Groth16 pairing check via snarkjs's pure-JS/WASM
implementation, which is much cheaper to run here than to fail on-chain
after paying a fee. A proof that passes this check still goes through
kyc_registry.verify() on-chain for the authoritative result — this is a
filter, not a replacement.
"""
import json
import subprocess
import tempfile
import os
from pathlib import Path
from loguru import logger

# Path to the SAME verification_key.json produced by
# circuits/scripts/trusted_setup.sh — keep this file in sync with
# whatever's baked into kyc_registry's default_vk constants. A mismatch
# here means this pre-check and the on-chain check could disagree,
# which defeats the point (either rejecting valid proofs or, worse,
# accepting proofs the contract will reject, wasting a submission fee
# anyway).
VK_PATH = Path(__file__).parent.parent / "zk" / "verification_key.json"


class OffChainVerificationError(Exception):
    pass


def _build_snarkjs_input(
    proof_a_hex: str,
    proof_b_hex: str,
    proof_c_hex: str,
    public_signals_hex: list[str],
) -> tuple[dict, list[str]]:
    """
    Converts the hex-encoded uncompressed point bytes (the same format
    the SDK sends to kyc_registry.verify()) back into snarkjs's
    decimal-string proof JSON shape, since snarkjs's CLI verifier
    expects its own native format, not raw Soroban bytes.

    NOTE: this conversion is the byte-format inverse of
    sdk/src/prover/index.ts's g1ToUncompressedBytes/g2ToUncompressedBytes
    — if you change the component ordering or byte layout on the SDK
    side, this function must change to match, or this off-chain check
    will reject every legitimately valid proof. Treat these two as a
    matched pair across the repo, not independent implementations.
    """
    def bytes_to_decimal(hex_str: str) -> str:
        return str(int(hex_str, 16))

    a_bytes = bytes.fromhex(proof_a_hex)
    c_bytes = bytes.fromhex(proof_c_hex)
    b_bytes = bytes.fromhex(proof_b_hex)

    proof = {
        "pi_a": [
            bytes_to_decimal(a_bytes[:32].hex()),
            bytes_to_decimal(a_bytes[32:64].hex()),
            "1",
        ],
        # G2 component order must match sdk/src/prover/index.ts's
        # g2ToUncompressedBytes layout: x_c1 || x_c0 || y_c1 || y_c0
        "pi_b": [
            [
                bytes_to_decimal(b_bytes[32:64].hex()),  # x_c0
                bytes_to_decimal(b_bytes[0:32].hex()),   # x_c1
            ],
            [
                bytes_to_decimal(b_bytes[96:128].hex()),  # y_c0
                bytes_to_decimal(b_bytes[64:96].hex()),   # y_c1
            ],
            ["1", "0"],
        ],
        "pi_c": [
            bytes_to_decimal(c_bytes[:32].hex()),
            bytes_to_decimal(c_bytes[32:64].hex()),
            "1",
        ],
        "protocol": "groth16",
        "curve": "bn128",
    }

    public_signals = [bytes_to_decimal(h) for h in public_signals_hex]
    return proof, public_signals


def verify_proof_off_chain(
    proof_a_hex: str,
    proof_b_hex: str,
    proof_c_hex: str,
    public_signals_hex: list[str],
) -> bool:
    """
    Returns True if the proof verifies against VK_PATH's verification
    key, False if it's cryptographically invalid. Raises
    OffChainVerificationError for malformed input (wrong byte lengths,
    missing VK file, etc.) — callers should treat that as a hard
    rejection too, just with a different log signature for debugging.
    """
    if not VK_PATH.exists():
        raise OffChainVerificationError(
            f"{VK_PATH} not found — copy circuits/build/verification_key.json here "
            f"after running circuits/scripts/trusted_setup.sh"
        )

    try:
        proof, public_signals = _build_snarkjs_input(
            proof_a_hex, proof_b_hex, proof_c_hex, public_signals_hex
        )
    except (ValueError, IndexError) as e:
        raise OffChainVerificationError(f"Malformed proof bytes: {e}")

    with tempfile.TemporaryDirectory() as tmpdir:
        proof_file = os.path.join(tmpdir, "proof.json")
        public_file = os.path.join(tmpdir, "public.json")

        with open(proof_file, "w") as f:
            json.dump(proof, f)
        with open(public_file, "w") as f:
            json.dump(public_signals, f)

        try:
            result = subprocess.run(
                ["npx", "snarkjs", "groth16", "verify", str(VK_PATH), public_file, proof_file],
                capture_output=True,
                text=True,
                timeout=30,
            )
        except subprocess.TimeoutExpired:
            logger.error("snarkjs verify timed out")
            return False

        # snarkjs's CLI prints "[INFO]  snarkJS: OK!" on success and
        # exits 0; non-zero exit or missing "OK!" means invalid.
        passed = result.returncode == 0 and "OK!" in result.stdout
        if not passed:
            logger.warning(f"Off-chain proof verification failed: {result.stdout} {result.stderr}")
        return passed