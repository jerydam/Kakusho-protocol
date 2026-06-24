#!/usr/bin/env bash
# trusted_setup.sh — runs the Groth16 trusted setup ceremony for the
# UNIVERSAL kyc_ocr circuit.
#
# IMPORTANT — this is run ONCE for the whole protocol, not per
# integrator. Every integrator on the platform shares this same
# proving/verifying key pair, because they all share the same circuit
# (see kyc_ocr.circom's header). This is the entire point of the
# global-VK design: the cost and ceremony complexity of trusted setup
# is paid once, not N times.
#
# For a real production launch, the Powers-of-Tau phase (ptau file)
# should come from a public, multi-party ceremony (e.g. the Hermez/
# Polygon ceremony's published ptau files, or run your own MPC ceremony
# with multiple independent contributors) — DO NOT use a single-party
# ptau for anything beyond testnet, since whoever holds the toxic waste
# from a single-contributor setup could forge proofs undetectably.
set -euo pipefail

CIRCUIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$CIRCUIT_DIR/build"
PTAU_FILE="$BUILD_DIR/pot15_prepared.ptau"   # 2^15 constraints; check r1cs info from compile.sh first

if [ ! -f "$PTAU_FILE" ]; then
    echo "Downloading Powers-of-Tau file (phase 1, public ceremony)..."
    curl -L -o "$PTAU_FILE" \
        "https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_15.ptau"
fi

echo "Phase 2 setup (circuit-specific)..."
npx snarkjs groth16 setup \
    "$BUILD_DIR/kyc_ocr.r1cs" \
    "$PTAU_FILE" \
    "$BUILD_DIR/kyc_ocr_0000.zkey"

echo "Contributing entropy (replace with real multi-party contributions for mainnet)..."
npx snarkjs zkey contribute \
    "$BUILD_DIR/kyc_ocr_0000.zkey" \
    "$BUILD_DIR/kyc_ocr_final.zkey" \
    --name="contributor-1" -v -e="$(head -c 64 /dev/urandom | base64)"

echo "Exporting verification key..."
npx snarkjs zkey export verificationkey \
    "$BUILD_DIR/kyc_ocr_final.zkey" \
    "$BUILD_DIR/verification_key.json"

echo ""
echo "Done. To deploy:"
echo "  1. Run scripts/export_vk_to_rust.js to generate the Rust VK constants"
echo "  2. Paste those constants into contracts/groth16_verifier/src/lib.rs"
echo "  3. Host kyc_ocr_final.zkey + kyc_ocr_js/kyc_ocr.wasm on your CDN"
echo "     (sdk/src/prover/snarkjs_worker.ts fetches them from there)"
