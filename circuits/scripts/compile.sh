#!/usr/bin/env bash
# compile.sh — compiles kyc_ocr.circom to R1CS + WASM witness generator.
#
# Requires: circom >= 2.1.6, circomlib in node_modules (npm install
# circomlib at the circuits/ directory level so the relative includes
# in kyc_ocr.circom resolve).
#
# Output goes to circuits/build/, which is gitignored — these are the
# artifacts the SDK fetches from a CDN at proving time (see
# sdk/src/prover/snarkjs_worker.ts), NOT something you commit or ship
# in a repo.
set -euo pipefail

CIRCUIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$CIRCUIT_DIR/build"
mkdir -p "$BUILD_DIR"

echo "Compiling kyc_ocr.circom..."
circom "$CIRCUIT_DIR/ocr_tier/kyc_ocr.circom" \
    --r1cs --wasm --sym \
    -l "$CIRCUIT_DIR/node_modules" \
    -o "$BUILD_DIR"

echo "Done. Artifacts in $BUILD_DIR:"
ls -la "$BUILD_DIR"

echo ""
echo "Constraint count:"
npx snarkjs r1cs info "$BUILD_DIR/kyc_ocr.r1cs"
