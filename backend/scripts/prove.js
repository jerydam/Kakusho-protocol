/**
 * scripts/prove.js
 * 
 * Witness builder for nfc_chip_verify.circom.
 * 
 * Circuit private inputs:
 *   dg1_data_bits[256]    — SHA-256 of DG1 bytes as 256 individual bits
 *   doc_id                — document number as field element
 *   user_secret           — user's secret scalar
 *   dob_timestamp         — date of birth as Unix seconds
 *   doc_issue_timestamp   — document issue date as Unix seconds
 *   country_code          — numeric ISO 3166-1 code
 * 
 * Circuit public inputs:
 *   sod_dg1_hash_bits[256] — SOD hash as 256 individual bits
 *   integrator_id          — field element
 *   current_timestamp      — Unix seconds
 * 
 * Circuit outputs (also public):
 *   chip_commitment
 *   nullifier
 */
const snarkjs = require('snarkjs');
const path = require('path');

// Convert a hex string to an array of 256 bits (MSB first)
function hexToBits256(hex) {
  const clean = hex.replace(/^0x/, '').padStart(64, '0');
  const bits = [];
  for (const char of clean) {
    const nibble = parseInt(char, 16);
    for (let i = 3; i >= 0; i--) {
      bits.push((nibble >> i) & 1);
    }
  }
  // Should be exactly 256 bits for a 32-byte hash
  if (bits.length !== 256) throw new Error(`Expected 256 bits, got ${bits.length}`);
  return bits;
}

async function main() {
  const input = JSON.parse(
    await new Promise((res) => {
      let buf = '';
      process.stdin.on('data', (d) => (buf += d));
      process.stdin.on('end', () => res(buf));
    })
  );

  // Build the circuit witness from the fields sent by /nfc/generate-proof
  const witness = {
    // Private inputs
    dg1_data_bits:        hexToBits256(input.dg1_hash_hex),
    doc_id:               input.document_no_hash,   // sha256ToFieldElement(docNo)
    user_secret:          input.user_secret,
    dob_timestamp:        input.dob_timestamp        ?? "0",
    doc_issue_timestamp:  input.doc_issue_timestamp  ?? "0",
    country_code:         input.country_code         ?? "0",

    // Public inputs
    sod_dg1_hash_bits:    hexToBits256(input.sod_dg1_hash_hex),
    integrator_id:        input.integrator_id_field, // field element form
    current_timestamp:    input.timestamp,
  };

  const root     = path.resolve(__dirname, '..');
  const wasmPath = path.join(root, 'zk', 'nfc_chip_verify.wasm');
  const zkeyPath = path.join(root, 'zk', 'nfc_chip_verify_final.zkey');

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    witness, wasmPath, zkeyPath
  );

  const pad64    = (n) => BigInt(n).toString(16).padStart(64, '0');
  const encodeG1 = (p) => pad64(p[0]) + pad64(p[1]);
  const encodeG2 = (p) =>
    pad64(p[0][1]) + pad64(p[0][0]) +
    pad64(p[1][1]) + pad64(p[1][0]);

 process.stdout.write(JSON.stringify({
  proof_a_hex:        encodeG1(proof.pi_a),
  proof_b_hex:        encodeG2(proof.pi_b),
  proof_c_hex:        encodeG1(proof.pi_c),
  public_signals_hex: publicSignals.map(pad64),
  nullifier_hex:      pad64(publicSignals[259]),  // ← was [0], now [259]
}));
}

main().catch((e) => {
  process.stderr.write(e.stack ?? e.message);
  process.exit(1);
});