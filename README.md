# Kakushō Protocol — 確証

**Zero-Knowledge, Zero-Liability B2B2C KYC for Stellar & Soroban**

Kakushō lets dApps enforce compliance — age gates, jurisdiction restrictions, document freshness — without ever seeing a user's identity documents. Users prove they qualify. The math guarantees it. No PII ever leaves their device.

---

## The Problem

Every Web3 platform that does KYC today creates the same vulnerability: a centralized honeypot of passport scans, selfies, and date-of-birth records sitting on a server somewhere, waiting to be breached. Beyond the security risk, this model puts heavy regulatory, storage, and liability burdens on developers who just want to ship compliant products.

Existing ZK identity solutions don't solve this well — they require every dApp to build custom circuits, maintain separate codebases, and run expensive trusted setup ceremonies. There's no shared infrastructure.

Kakushō solves both problems at once.

---

## The Solution

A **universal ZK circuit** that any dApp can plug into. Users scan their ID document locally in the browser, generate a Groth16 zero-knowledge proof that they meet the dApp's compliance rules, and submit only the proof — never the document.

The dApp receives a mathematically guaranteed boolean result and a Sybil-resistant nullifier. Nothing else. We call this **Zero Liability**.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    BROWSER (USER DEVICE)                     │
│                                                             │
│  ID Card ──► Tesseract.js OCR Worker ──► Private Attributes │
│  Selfies ──► MediaPipe Liveness      ──► Biometric Pass     │
│                                                             │
│  Private Attributes + Integrator Rules ──► Witness Builder  │
│  Full Witness ──► SnarkJS WASM Prover ──► Groth16 ZK Proof  │
└──────────────────────────┬──────────────────────────────────┘
                           │  Proof + Public Signals only
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   FASTAPI RELAYER ENGINE                     │
│                                                             │
│  snarkjs off-chain pre-check ──► Spend limit enforcement    │
│  Sponsor wallet signs & pays XLM fees on behalf of user     │
└──────────────────────────┬──────────────────────────────────┘
                           │  Sponsored Soroban invocation
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  STELLAR / SOROBAN LEDGER                    │
│                                                             │
│  kyc_registry.verify() ──► binds proof to integrator rules  │
│  groth16_verifier crate ──► BN254 pairing check ──► commit  │
└─────────────────────────────────────────────────────────────┘
```

---

## Deployed Contract

| | |
|---|---|
| **Network** | Soroban Testnet |
| **Contract ID** | `CBNKGIVBI4ANASWZS7AVSEQHSTOK2YYN5OYIII2ZKKQ7WS5FGFKRHDW2` |
| **Admin Address** | `GB6OKZKFU65XJCF3EAEYP7KLCV3BABQBTE57IS5WJYPIKWMDCPPKW23Y` |
| **Circuit constraints** | 5,494 |
| **Public signals** | 6 (nullifier, timestamp, min_age, restricted_root, doc_max_age, integrator_id) |

---

## How It Works

### For Integrators (B2B)

**1. Define your rules.**
Decide your compliance parameters: minimum user age, maximum document age, and which nationalities are restricted. There is no code to write for this step.

**2. Build your country restriction tree.**

```bash
# From the circuits/ directory
echo '[408, 364, 760, 192]' > restricted_codes.json
node scripts/build_restricted_tree.js restricted_codes.json restricted_tree.json
```

This produces a `restricted_tree.json` and prints the 32-byte `restricted_root` Merkle root. Host the JSON file on your CDN — your users' SDK will fetch it at proof time.

**3. Register on-chain.**

```bash
stellar contract invoke \
  --id CBNKGIVBI4ANASWZS7AVSEQHSTOK2YYN5OYIII2ZKKQ7WS5FGFKRHDW2 \
  --source YOUR_KEY --network testnet \
  -- register_integrator \
  --integrator_id YOUR_32_BYTE_HEX_ID \
  --owner YOUR_STELLAR_ADDRESS \
  --min_age_seconds 568025136 \
  --restricted_root YOUR_MERKLE_ROOT_HEX \
  --doc_max_age_seconds 315360000
```

**4. Create your relayer account.**
Hit the dashboard at `/dashboard/register`, connect Freighter, and save the API key that is shown once. Then set your webhook URL to receive on-chain confirmation events.

**5. Install the SDK in your frontend.**

```bash
npm install @Kakushō/zk-kyc-sdk snarkjs tesseract.js @mediapipe/tasks-vision
```

---

### For Users (B2C)

The user experience is four steps inside your frontend:

1. Upload an ID document photo (passport, national ID, or driver's licence).
2. Take four selfies looking left, right, up, and down.
3. Wait for the proof to generate locally (10–60 seconds depending on device).
4. Done. No document is uploaded anywhere.

---

## Circuit Architecture

### The Universal Circuit (`kyc_ocr.circom`)

The circuit validates five predicates in a single proof:

| Predicate | Method | Private inputs used |
|-----------|--------|-------------------|
| User is old enough | `current_timestamp - dob_timestamp >= min_age_seconds` | `dob_timestamp` |
| Document is fresh | `current_timestamp - doc_issue_timestamp <= doc_max_age_seconds` | `doc_issue_timestamp` |
| Nationality is allowed | Merkle bracket non-membership proof | `nationality_code`, `bracket_low`, `bracket_high`, `path_elements`, `path_indices` |
| Proof belongs to this integrator | Public input binding | `integrator_id` (public) |
| Sybil resistance | Poseidon hash of doc_id + user_secret + integrator_id | `doc_id`, `user_secret` |

### The Public Signal Vector

```
publicSignals = [
  nullifier,          // output — Poseidon(doc_id, user_secret, integrator_id)
  current_timestamp,  // must be within 1 hour of ledger time (enforced on-chain)
  min_age_seconds,    // must match integrator's registered config (enforced on-chain)
  restricted_root,    // must match integrator's registered root (enforced on-chain)
  doc_max_age_seconds,// must match integrator's registered config (enforced on-chain)
  integrator_id       // must match the integrator_id passed to verify() (enforced on-chain)
]
```

The on-chain `kyc_registry.verify()` call re-reads all registered values from ledger storage and compares them against the proof's public signals before running the Groth16 pairing check. A proof generated against forged public inputs will not pass this binding check, even if the pairing equations are internally valid.

### Country Restriction: Sorted Bracket Merkle Tree

Standard non-membership proofs in ZK circuits are expensive — checking 20 restricted countries requires 20 comparators in the circuit. Kakushō uses a sorted bracket scheme instead:

```
Restricted codes (sorted): [0, 192, 364, 408, 760, 999999999]
                                 ↓
Adjacent pairs become leaves: Hash(0,192), Hash(192,364), Hash(364,408), ...
                                 ↓
                           Merkle tree root = restricted_root
```

To prove nationality `566` (Nigeria) is allowed, the user finds the open bracket that contains it — `(408, 760)` — and proves Merkle inclusion of that bracket's hash. The circuit enforces:

- `bracket_low (408) < nationality_code (566) < bracket_high (760)` — the code sits inside an open gap
- `MerkleInclusionProof(Hash(408, 760), path...) == restricted_root` — the bracket is in the registered tree
- `CalculatedRoot === restricted_root` — ties to the public input that the contract validates

The result: proving non-membership costs O(log N) constraints regardless of list size, and the integrator can change their restricted list anytime by rebuilding the tree and calling `update_integrator_rules()`.

---

## SDK Integration

### Install

```bash
npm install @Kakushō/zk-kyc-sdk snarkjs tesseract.js @mediapipe/tasks-vision
```

### Environment variables

```env
NEXT_PUBLIC_Kakushō_RELAYER_URL=https://your-relayer.com
NEXT_PUBLIC_Kakushō_API_KEY=zkkyc_...
NEXT_PUBLIC_WASM_URL=https://cdn.your-org.com/kyc_ocr.wasm
NEXT_PUBLIC_ZKEY_URL=https://cdn.your-org.com/kyc_ocr_final.zkey
```

### Generate and submit a proof

```typescript
import { generateKycProof, submitProof, KycRejectedError } from '@Kakushō/zk-kyc-sdk';

// Load integrator assets (fetch once, cache in state)
const integratorAssets = {
  integratorId: '0101...01',            // your 32-byte hex integrator ID
  minAgeSeconds: BigInt(568025136),      // 18 years in seconds
  docMaxAgeSeconds: BigInt(315360000),   // 10 years in seconds
  countryCodeMap: await fetch('/assets/country_codes.json').then(r => r.json()),
  restrictedTree:  await fetch('/assets/restricted_tree.json').then(r => r.json()),
};

try {
  // All processing happens locally — nothing is uploaded
  const proof = await generateKycProof({
    idDocument: documentFile,                            // File from <input>
    selfies: [leftFile, rightFile, upFile, downFile],    // 4 photos
    integratorAssets,
    proverAssets: {
      wasmUrl: process.env.NEXT_PUBLIC_WASM_URL!,
      zkeyUrl: process.env.NEXT_PUBLIC_ZKEY_URL!,
    },
    onProgress: (stage) => console.log('Stage:', stage),
    // stages: ocr | liveness | fetching_wasm | fetching_zkey |
    //         computing_witness | generating_proof | done
  });

  // Submit proof to relayer — pays Stellar fees for the user
  const result = await submitProof(
    proof,
    process.env.NEXT_PUBLIC_Kakushō_RELAYER_URL!,
    process.env.NEXT_PUBLIC_Kakushō_API_KEY!,
    userStellarAddress, // optional
  );

  console.log('Verified on-chain:', result.tx_hash);

} catch (e) {
  if (e instanceof KycRejectedError) {
    // e.reason: 'ocr_failed' | 'liveness_failed' | 'predicate_failed'
    // e.message: user-facing explanation of what failed
    console.error(e.reason, e.message);
  }
}
```

### Error types

| Error | `reason` | Meaning |
|-------|----------|---------|
| `KycRejectedError` | `ocr_failed` | Document unreadable — ask user to retake |
| `KycRejectedError` | `liveness_failed` | Missing head poses — `e.message` lists which ones |
| `KycRejectedError` | `predicate_failed` | User doesn't meet age or country rules |
| `OCRError` | — | Tesseract failed entirely — image too dark/blurry |
| `WitnessBuildError` | — | Date parse failed or nationality not in country map |

---

## Relayer API

All routes require `X-API-Key: zkkyc_...` header (from the dashboard).

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/proof/submit` | Submit a proof for sponsorship and on-chain verification |
| `GET` | `/proof/status/{tx_hash}` | Poll verification result |
| `POST` | `/integrators` | Register a new integrator account |
| `GET` | `/integrators/me` | Get current integrator + config |
| `GET` | `/integrators/me/stats` | Daily usage stats |
| `POST` | `/integrators/me/rotate-key` | Invalidate and reissue API key |
| `PATCH` | `/integrators/me/webhook` | Update webhook URL |
| `GET` | `/integrators/by-owner/{address}` | Lookup by Stellar owner address |

### Proof submission payload

```json
{
  "nullifier_hex":        "64 hex chars",
  "current_timestamp":    1234567890,
  "proof_a_hex":          "128 hex chars (64 bytes)",
  "proof_b_hex":          "256 hex chars (128 bytes)",
  "proof_c_hex":          "128 hex chars (64 bytes)",
  "public_signals_hex":   ["64 hex chars × 5"],
  "user_stellar_address": "G... (optional)"
}
```

### Webhook payload

Delivered to your registered URL with `X-Webhook-Signature: <HMAC-SHA256>` for verification:

```json
{
  "event":             "kyc.verification.completed",
  "integrator_id_hex": "0101...01",
  "nullifier_hex":     "abcd...ef",
  "status":            "confirmed",
  "tx_hash":           "a8ae...ba",
  "submission_id":     "uuid",
  "timestamp":         "2025-01-01T00:00:00Z"
}
```

Verify the signature in your webhook handler:

```typescript
import crypto from 'crypto';

const expected = crypto
  .createHmac('sha256', process.env.Kakushō_WEBHOOK_SECRET!)
  .update(rawBody)
  .digest('hex');

if (sig !== expected) return res.status(401).end();
```

---

## Deployment

### Prerequisites

- Rust + `wasm32v1-none` target
- `stellar-cli` ≥ 27.0.0
- Node.js ≥ 18, `circom` ≥ 2.1.6, `snarkjs` ≥ 0.7
- Python 3.11, PostgreSQL (or Supabase)

### 1. Build and deploy contracts

```bash
cd contracts
rustup target add wasm32v1-none

cargo build --target wasm32v1-none --release

stellar contract deploy \
  --wasm target/wasm32v1-none/release/kyc_registry.wasm \
  --source admin --network testnet
```

### 2. Compile the circuit and run trusted setup

```bash
cd circuits
npm install

bash scripts/compile.sh          # produces build/kyc_ocr.wasm + kyc_ocr.r1cs
bash scripts/trusted_setup.sh    # produces kyc_ocr_final.zkey + verification_key.json

# Export VK constants into Rust contract
node scripts/generate_verifier.js build/verification_key.json
# Paste output into contracts/kyc_registry/src/lib.rs mod default_vk {}
# Then rebuild and redeploy the contract
```

### 3. Upload circuit assets to CDN

```bash
# Upload these two files — set immutable cache headers
circuits/build/kyc_ocr_js/kyc_ocr.wasm   → https://cdn.your-org.com/kyc_ocr.wasm
circuits/build/kyc_ocr_final.zkey         → https://cdn.your-org.com/kyc_ocr_final.zkey

# Cache-Control: public, max-age=31536000, immutable
# These only change when you rerun the trusted setup
```

### 4. Start the relayer backend

```bash
cd backend
python3.11 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Copy the verification key
cp ../circuits/build/verification_key.json zk/verification_key.json

# Configure environment
cp .env.example .env
# Edit .env — fill in DATABASE_URL, SPONSOR_STELLAR_SECRET, KYC_REGISTRY_CONTRACT_ID

uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 5. Run the dashboard

```bash
cd dashboard
npm install @stellar/freighter-api
cp .env.local.example .env.local
# Edit .env.local

npm run dev
# Open http://localhost:3000/dashboard/register
```

---

## Security Model

**What Kakushō guarantees:**

- The circuit predicate outputs (`age >= min`, `nationality not restricted`, `document fresh`) are mathematically enforced. They cannot be faked without breaking the Groth16 proof.
- The on-chain binding check ensures a proof generated for one integrator's rules cannot be replayed under a different integrator's config. Every field in `publicSignals` is verified against the ledger's stored values before the pairing check runs.
- The nullifier (`Poseidon(doc_id, user_secret, integrator_id)`) is unique per document per integrator. The same physical document cannot pass verification twice at the same dApp. Cross-app tracking is prevented because the nullifier is domain-separated by `integrator_id`.
- The sponsor wallet never has custody of user funds and cannot sign anything except the specific verify() call it prepares.

**What Kakushō does not guarantee (OCR-tier limitations):**

Kakushō is currently an **OCR-tier** protocol. The ZK cryptography is unforgeable, but the data fed into it comes from client-side text extraction. A sophisticated adversary with control over the browser runtime or with a carefully crafted document graphic could potentially feed false field values into the circuit without the circuit detecting the forgery. Kakushō confirms the *internal consistency* of a proof, not the physical authenticity of the source document.

---

## Roadmap

**Phase 2 — NFC chip reading**
Extend the browser SDK to read the cryptographically signed chip embedded in ICAO-compliant biometric passports via WebNFC. This replaces OCR with chip data that cannot be spoofed optically.

**Phase 3 — Government signature verification in ZK**
Extend the circuit to verify the RSA/ECDSA signature issued by the document's country authority inside the ZK proof. The circuit proves the document was signed by a recognized government key without revealing which government or document was used. This upgrades Kakushō to sovereign-grade tamper-proof verification.

**Phase 4 — Global document polymorphism**
Extend the witness layout to cover driver's licences, residence permits, and other ICAO-adjacent credential formats under the same universal circuit.

---

## License

MIT — see `LICENSE`.

---

## Acknowledgements

Built on [Stellar](https://stellar.org) and [Soroban](https://soroban.stellar.org).  
ZK proving via [snarkjs](https://github.com/iden3/snarkjs) and [circom](https://github.com/iden3/circom).  
Document OCR via [Tesseract.js](https://tesseract.projectnaptha.com).  
Liveness detection via [MediaPipe](https://mediapipe.dev).