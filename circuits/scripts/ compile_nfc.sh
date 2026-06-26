#!/usr/bin/env bash
# compile_nfc.sh — compiles nfc_chip_verify.circom and runs trusted setup.
#
# Run from circuits/ directory:
#   bash scripts/compile_nfc.sh
#
# Prerequisites (same as compile.sh for kyc_ocr):
#   - circom 2.1.6+  (https://docs.circom.io/getting-started/installation/)
#   - snarkjs        (npm install -g snarkjs)
#   - circomlibjs    (npm install circomlibjs)
#   - pot15_final.ptau already exists in circuits/build/ (reused from OCR setup)
#
# Output artifacts in circuits/build/:
#   nfc_chip_verify.wasm       — witness generator (browser + Node)
#   nfc_chip_verify.r1cs       — constraint system
#   nfc_chip_verify.sym        — symbol table (for debugging)
#   nfc_chip_verify_0000.zkey  — initial zkey (phase 2 start)
#   nfc_chip_verify_final.zkey — final proving key (after contribution)
#   nfc_verification_key.json  — verifying key (for snarkjs_verify.py + contract)
#
# TRUSTED SETUP NOTE:
# This script runs a minimal single-contribution ceremony for development.
# For production, run a multi-party ceremony (same as the OCR circuit's
# trusted_setup.sh). The NFC circuit is SMALLER than kyc_ocr (no OCR
# field extraction constraints) so pot15_final.ptau (2^15 = 32768
# constraints) should be sufficient — verify with:
#   snarkjs r1cs info build/nfc_chip_verify.r1cs
# If nConstraints > 32768, use pot16_final.ptau or larger.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CIRCUITS_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$CIRCUITS_DIR/build"
COMMON_DIR="$CIRCUITS_DIR/common"
NFC_TIER_DIR="$CIRCUITS_DIR/nfc_tier"

mkdir -p "$BUILD_DIR"
mkdir -p "$NFC_TIER_DIR"

# Copy nfc_chip_verify.circom to nfc_tier/ (mirrors kyc_ocr in ocr_tier/)
cp "$CIRCUITS_DIR/../nfc_chip_verify.circom" "$NFC_TIER_DIR/nfc_chip_verify.circom" 2>/dev/null || true

echo "=== Step 1: Compile nfc_chip_verify.circom ==="
circom "$NFC_TIER_DIR/nfc_chip_verify.circom" \
    --r1cs \
    --wasm \
    --sym \
    -l node_modules \
    -o "$BUILD_DIR"

echo "Constraint count:"
snarkjs r1cs info "$BUILD_DIR/nfc_chip_verify.r1cs"

# Move .wasm out of the generated subdirectory to match kyc_ocr layout
if [ -d "$BUILD_DIR/nfc_chip_verify_js" ]; then
    cp "$BUILD_DIR/nfc_chip_verify_js/nfc_chip_verify.wasm" "$BUILD_DIR/"
    cp "$BUILD_DIR/nfc_chip_verify_js/witness_calculator.js" "$BUILD_DIR/nfc_witness_calculator.js" 2>/dev/null || true
    echo "Moved .wasm from nfc_chip_verify_js/"
fi

echo ""
echo "=== Step 2: Phase 2 trusted setup (NFC circuit) ==="

PTAU="$BUILD_DIR/pot15_final.ptau"
if [ ! -f "$PTAU" ]; then
    echo "ERROR: $PTAU not found."
    echo "Run circuits/scripts/trusted_setup.sh first (for OCR circuit) to generate pot15_final.ptau,"
    echo "or download from https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_15.ptau"
    exit 1
fi

echo "Using existing $PTAU"

echo ""
echo "=== Step 3: Phase 2 — generate initial .zkey ==="
snarkjs groth16 setup \
    "$BUILD_DIR/nfc_chip_verify.r1cs" \
    "$PTAU" \
    "$BUILD_DIR/nfc_chip_verify_0000.zkey"

echo ""
echo "=== Step 4: Contribute to ceremony (single-party for dev) ==="
# For production: collect contributions from multiple parties using
# snarkjs zkey contribute with different entropy sources.
echo "dev_entropy_nfc_$(date +%s)_$(hostname)" | \
snarkjs zkey contribute \
    "$BUILD_DIR/nfc_chip_verify_0000.zkey" \
    "$BUILD_DIR/nfc_chip_verify_final.zkey" \
    --name="NFC Circuit Dev Contribution 1" \
    -v

echo ""
echo "=== Step 5: Export verification key ==="
snarkjs zkey export verificationkey \
    "$BUILD_DIR/nfc_chip_verify_final.zkey" \
    "$BUILD_DIR/nfc_verification_key.json"

echo ""
echo "=== Step 6: Copy verification key to backend ==="
# The backend's snarkjs_verify.py needs to know the NFC VK path.
# Copy to backend/zk/ alongside the OCR verification_key.json.
BACKEND_ZK="$CIRCUITS_DIR/../backend/zk"
mkdir -p "$BACKEND_ZK"
cp "$BUILD_DIR/nfc_verification_key.json" "$BACKEND_ZK/nfc_verification_key.json"
echo "Copied to $BACKEND_ZK/nfc_verification_key.json"

echo ""
echo "=== Step 7: Copy .wasm + .zkey to frontend public/ ==="
# The frontend's buildNFCProof() fetches these at proof-generation time.
FRONTEND_PUBLIC="$CIRCUITS_DIR/../frontend/public/circuits"
mkdir -p "$FRONTEND_PUBLIC"
cp "$BUILD_DIR/nfc_chip_verify.wasm" "$FRONTEND_PUBLIC/nfc_chip_verify.wasm"
cp "$BUILD_DIR/nfc_chip_verify_final.zkey" "$FRONTEND_PUBLIC/nfc_chip_verify_final.zkey"
echo "Copied WASM + zkey to $FRONTEND_PUBLIC/"
echo ""
echo "NOTE: nfc_chip_verify_final.zkey can be large (~100MB+). Consider"
echo "hosting it on a CDN and passing the URL to snarkjs.groth16.fullProve()"
echo "instead of serving from /public — see nfc_witness_builder.ts."

echo ""
echo "=== NFC circuit build complete ==="
echo ""
echo "Summary:"
echo "  Proving key:      $BUILD_DIR/nfc_chip_verify_final.zkey"
echo "  Verifying key:    $BUILD_DIR/nfc_verification_key.json"
echo "  WASM witness gen: $BUILD_DIR/nfc_chip_verify.wasm"
echo ""
echo "Next steps:"
echo "  1. Register the NFC VK hash in kyc_registry if you need per-integrator overrides"
echo "  2. Add NFC_VK_PATH to backend .env: NFC_VK_PATH=backend/zk/nfc_verification_key.json"
echo "  3. Update main.py to include router from routes_nfc.py"
echo "  4. Add /dashboard/nfc-verify to your Next.js app router"