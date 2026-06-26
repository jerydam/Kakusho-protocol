# Kakusho ZK-KYC Protocol — Developer Documentation

## Table of Contents

1. [What Is This?](#1-what-is-this)
2. [Why It Works This Way](#2-why-it-works-this-way)
3. [System Architecture](#3-system-architecture)
4. [The Two Verification Paths](#4-the-two-verification-paths)
5. [Data Flow — End to End](#5-data-flow--end-to-end)
6. [Components Reference](#6-components-reference)
7. [Integrator Guide — Getting Started](#7-integrator-guide--getting-started)
8. [User Journey](#8-user-journey)
9. [Security Model](#9-security-model)
10. [Known Limitations & TODOs](#10-known-limitations--todos)

---

## 1. What Is This?

Kakusho is a **privacy-preserving KYC (Know Your Customer) protocol** built on the Stellar/Soroban blockchain. It lets your users prove facts about their identity documents — *"I am over 18," "my document was issued within the last 5 years," "I am not from a restricted country"* — **without ever revealing the underlying document data** to you, to the relayer, or to the blockchain.

The cryptographic primitive doing the heavy lifting is **Groth16 zero-knowledge proofs**, generated entirely inside the user's browser. The only thing that ever leaves their device is a mathematical proof and a nullifier. No photo. No name. No date of birth. No document number.

### What a dApp (Integrator) Gets

- A **nullifier** — a unique, unlinkable identifier tied to one physical document + one integrator. You can use it to record "this person is verified" in your own database without knowing who they are.
- A **Soroban transaction hash** confirming the proof was accepted on-chain.
- A **webhook event** delivered to your server when the proof settles.

### What the User Proves (Without Revealing)

| Claim | How It's Proved |
|---|---|
| Age ≥ N years | Circuit computes `now - dob ≥ min_age_seconds` over private DOB |
| Not from restricted country | Merkle non-membership proof against integrator's banned-country tree |
| Document issued within N years | Circuit computes `now - issue_date ≤ doc_max_age_seconds` |
| Document is genuine (NFC path) | Passive Authentication hash chain, then ZK proof of hash binding |

---

## 2. Why It Works This Way

### The B2B2C Model

This is a **three-party protocol**:

```
User (browser)  ←→  Integrator's dApp  ←→  Kakusho Relayer  ←→  Soroban (kyc_registry)
```

- **Users** generate proofs in their browser and submit them through the integrator's frontend.
- **Integrators** (dApps) register their rules on-chain (minimum age, restricted countries, document freshness window). They never see user data.
- **The Relayer** (this backend) sponsors Stellar transaction fees, so users don't need to hold XLM to complete KYC. It also delivers webhook events and enforces daily spend limits.
- **`kyc_registry`** (the Soroban contract) stores integrator rules and nullifiers on-chain, and runs the final Groth16 pairing check.

### Why Zero-Knowledge Proofs?

Traditional KYC sends your document image to a third-party server, which stores it, processes it, and issues a "yes/no." That server becomes a data liability — a breach exposes millions of users' passport scans.

With ZK proofs, the server never sees the document. The user's browser runs the circuit locally, producing a proof that is mathematically equivalent to saying *"I know a secret (my document data) that satisfies these rules"* — without revealing the secret.

### Why One Shared Circuit?

There is **one compiled Groth16 circuit** (`kyc_ocr.circom`) and **one verification key** for the entire protocol. Every integrator uses the same circuit. Their specific rules (min age, restricted countries, etc.) are **public inputs** to the proof, not baked into the circuit itself.

The `kyc_registry` contract is what enforces that a proof's public inputs actually match a given integrator's registered configuration. Without that check, a proof generated for one integrator's rules could be replayed against another — this contract closes that gap.

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        User's Browser                        │
│                                                             │
│  ┌──────────────┐   ┌─────────────────┐   ┌─────────────┐  │
│  │  OCR Worker  │   │  NFC Reader     │   │ Face Worker │  │
│  │(Tesseract.js)│   │(Web NFC/ISO7816)│   │ (MediaPipe) │  │
│  └──────┬───────┘   └───────┬─────────┘   └─────────────┘  │
│         │                   │                               │
│         ▼                   ▼                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Witness Builder                         │   │
│  │  (witness_builder.ts / nfc_witness_builder.ts)       │   │
│  │  Converts document fields → circuit inputs           │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │         Prover (snarkjs_worker.ts — Web Worker)      │   │
│  │         Groth16 proof generation (WASM/zkey)         │   │
│  └──────────────────────┬──────────────────────────────┘   │
└─────────────────────────┼───────────────────────────────────┘
                           │ proof + nullifier (no PII)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Kakusho Relayer (FastAPI)                  │
│                                                             │
│  POST /proof/submit  or  POST /nfc/submit-proof             │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ snarkjs_     │  │ spend_limit  │  │ stellar_sponsor  │  │
│  │ verify.py    │  │ .py          │  │ .py              │  │
│  │(pre-check,   │  │(daily cap    │  │(pays XLM fees,   │  │
│  │ free, fast)  │  │ per integr.) │  │ calls contract)  │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐                        │
│  │ webhook_     │  │ Supabase     │                        │
│  │ service.py   │  │ (Postgres)   │                        │
│  │(HMAC-signed  │  │ sponsored_   │                        │
│  │  delivery)   │  │ tx_log, etc) │                        │
│  └──────────────┘  └──────────────┘                        │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  Soroban (kyc_registry contract)             │
│                                                             │
│  verify() →                                                 │
│    1. Integrator config lookup                              │
│    2. Public input binding check (against stored rules)     │
│    3. Timestamp drift check                                 │
│    4. Nullifier replay check                                │
│    5. Groth16 pairing check (groth16_verifier crate)        │
│    6. Store nullifier on success                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. The Two Verification Paths

### Path A — OCR (Optical Character Recognition)

The user photographs their document. The SDK processes the image entirely in the browser.

```
Photo (File/Blob)
  → loadImageToCanvas()
  → upscaleIfSmall() + contrastStretchGrayscale()   (preprocessing)
  → Tesseract.js (three PSM configs, best-score wins)
  → field extraction (name, DOB, doc number, expiry, issue date, nationality)
  → MRZ fallback parsing (passport TD3 format)
  → buildWitnessFromOcr()   →   Groth16 proof   →   /proof/submit
```

**Good for:** Any device with a camera. Works on desktop and mobile without special hardware.

**Limitation:** OCR accuracy depends on image quality. No cryptographic proof the document is real — only that the user typed/photographed something that looks like a valid document.

---

### Path B — NFC (Near Field Communication)

The user taps their ePassport or national eID to their phone's NFC reader. The phone reads the chip's raw bytes via ISO 7816-4 APDUs.

```
NFC Chip (DG1 + SOD bytes)
  → readNFCChip()           (APDU exchange, chunked READ BINARY)
  → POST /nfc/verify-chip   (Passive Authentication on the server)
      → SHA-256(DG1) ↔ SOD-recorded hash
      → DS cert signature check (RSA or ECDSA)
      → DS cert → CSCA master list chain check
  → Server returns: dg1_hash_hex + sod_dg1_hash_hex
  → buildWitnessFromNFC()   →   Groth16 proof   →   /nfc/submit-proof
```

**Good for:** Cryptographic proof the chip was issued by a real country. The DS→CSCA chain is verified against ICAO's published master list. A forged chip cannot pass this.

**Limitation:** Requires Chrome on Android 89+ with the ISO-DEP origin trial flag. Not available on iOS or desktop without a USB PC/SC reader relay. Passports using BAC (Basic Access Control) are not supported via Web NFC — a native app is required.

---

## 5. Data Flow — End to End

### 5.1 Integrator Registration (One-Time)

```
POST /integrators
{
  "integrator_id_hex": "abcd...32bytes...ef",
  "name": "My dApp",
  "owner_stellar_address": "GABC...",
  "webhook_url": "https://mydapp.com/webhooks/kyc",
  "min_age_seconds": 568025136,      // ≈18 years
  "doc_max_age_seconds": 157680000   // ≈5 years
}

Response (ONE-TIME — save the api_key):
{
  "api_key": "zkkyc_...",
  "webhook_secret": "...",
  ...
}
```

This simultaneously:
- Creates a relayer account (API key, webhook URL, daily spend limit)
- Calls `kyc_registry.register_integrator()` on Soroban with your rules

If the on-chain call fails, the DB row is rolled back — you never end up in a half-registered state.

---

### 5.2 OCR Proof Generation (SDK, Browser)

```typescript
import { generateKycProof, submitProof } from '@Kakusho/zk-kyc-sdk';

const result = await generateKycProof({
  documentFile: file,              // File | Blob from an <input type="file">
  integratorAssets: {
    integratorId: "abcd...ef",     // your 32-byte hex ID
    minAgeSeconds: 568025136n,
    docMaxAgeSeconds: 157680000n,
    countryCodeMap: { ... },       // ISO alpha-3 → numeric code
    restrictedTree: { root, pairs }, // Merkle tree of banned-country pairs
  },
  proverAssets: {
    wasmUrl: "https://cdn.example.com/kyc_ocr.wasm",
    zkeyUrl: "https://cdn.example.com/kyc_ocr_final.zkey",
  },
  onProgress: (stage) => console.log(stage),
});

// result.proofA/B/C, result.publicSignals, result.nullifier
await submitProof(result, "https://relayer.example.com", "zkkyc_...");
```

Internally, `generateKycProof` does:

1. **OCR** — runs Tesseract.js on the preprocessed image, extracts DOB, issue date, nationality, doc number
2. **Witness build** — converts fields to circuit inputs, picks the right Merkle bracket for the user's nationality, generates a random `user_secret`
3. **Proving** — spawns a Web Worker running `snarkjs.groth16.fullProve()` with the compiled WASM and zkey
4. **Point encoding** — converts snarkjs decimal-string G1/G2 points into uncompressed byte arrays matching the Soroban contract's `Bn254G1Affine`/`Bn254G2Affine`

---

### 5.3 NFC Proof Generation (SDK, Browser)

```typescript
import { readNFCChip, supportsNFC } from '@Kakusho/zk-kyc-sdk/nfc';

if (!supportsNFC()) { showOCRFallback(); return; }

const abort = new AbortController();
const chipRead = await readNFCChip(abort.signal);

// chipRead.dg1Bytes + chipRead.sodBytes → upload to relayer for Passive Auth
const paResult = await fetch(`${relayerUrl}/nfc/verify-chip`, {
  method: 'POST',
  body: JSON.stringify({
    dg1_b64: btoa(String.fromCharCode(...chipRead.dg1Bytes)),
    sod_b64: btoa(String.fromCharCode(...chipRead.sodBytes)),
    integrator_id: integratorId,
  })
}).then(r => r.json());

// paResult.dg1_hash_hex, paResult.sod_dg1_hash_hex
// → build witness → generate proof → POST /nfc/submit-proof
```

---

### 5.4 Relayer Proof Submission

When the relayer receives a proof (`POST /proof/submit` or `POST /nfc/submit-proof`), it runs three checks before spending any fees:

**Step 1 — Off-chain snarkjs pre-check (`snarkjs_verify.py`)**

Uses the same `verification_key.json` as the Soroban contract. Runs `npx snarkjs groth16 verify` locally. A structurally invalid proof is rejected here for free, before any XLM is spent.

**Step 2 — Daily spend limit (`spend_limit.py`)**

Counts `sponsored_tx_log` rows for this integrator in the last 24 hours. If `used >= daily_limit`, returns HTTP 429. Prevents a compromised or buggy frontend from draining the sponsor wallet.

**Step 3 — Soroban submission (`stellar_sponsor.py`)**

Builds a `TransactionBuilder` call to `kyc_registry.verify()`, signed by the relayer's own keypair. The relayer pays the XLM fee — the user needs zero XLM.

---

### 5.5 On-Chain Verification (`kyc_registry`)

`kyc_registry.verify()` in the Soroban contract does:

1. **Config lookup** — loads integrator's `min_age_seconds`, `restricted_root`, `doc_max_age_seconds`
2. **Input binding** — re-derives the expected public signal values from the stored config and the explicit `nullifier`/`current_timestamp` arguments, then compares against every element of `public_signals`. If ANY signal doesn't match, the call reverts with `PublicInputMismatch`. This is the critical guard against proof replay across integrators.
3. **Timestamp drift check** — `|current_timestamp - env.ledger().timestamp()| ≤ 3600s`. Prevents a stale proof from being submitted hours after generation.
4. **Nullifier replay check** — `DataKey::Nullifier(integrator_id, nullifier, proof_type)` must not already exist in storage.
5. **Groth16 pairing check** — delegates to `groth16_verifier::verify_proof()` with `DEFAULT_VK`. Returns `Ok(true)` or `Ok(false)`.
6. **Nullifier storage** — if valid, stores the nullifier so this document can't be reused.

---

### 5.6 Webhook Delivery

After a successful submission, the relayer inserts a row into `webhook_deliveries` and a background task retries delivery with exponential backoff (30s, 60s, 120s, 240s... up to `WEBHOOK_MAX_RETRIES`).

Every payload is HMAC-SHA256 signed with the integrator's `webhook_secret`. Verify it in your webhook handler:

```python
import hmac, hashlib

def verify_webhook(body: bytes, signature_header: str, secret: str) -> bool:
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)
```

Webhook payload shape:

```json
{
  "event": "proof.verified",
  "nullifier": "abcd...ef",
  "tx_hash": "stellar_tx_hash",
  "integrator_id": "your_integrator_id",
  "submission_id": "uuid"
}
```

---

## 6. Components Reference

### Backend (FastAPI)

| File | Role |
|---|---|
| `main.py` | App entry point, CORS, lifespan pool management |
| `auth.py` | API key generation, hashing, `get_current_integrator` dependency |
| `routes_integrator.py` | CRUD for integrator accounts + on-chain registration |
| `routes_proof.py` | OCR proof submission endpoint |
| `routes_nfc.py` | NFC Passive Auth + NFC proof submission endpoints |
| `snarkjs_verify.py` | Off-chain Groth16 pre-check via snarkjs CLI |
| `spend_limit.py` | Per-integrator daily transaction cap |
| `stellar_sponsor.py` | Soroban transaction builder + fee sponsorship |
| `nfc_verify.py` | ICAO 9303 Passive Authentication (DG1→SOD→DS→CSCA chain) |
| `webhook_service.py` | Outbox pattern webhook delivery with HMAC signing |

### SDK (TypeScript)

| File | Role |
|---|---|
| `index.ts` | Package exports |
| `types.ts` | `KycProofResult`, `KycWitness`, `IntegratorConfig`, etc. |
| `submit.ts` | `submitProof()` — formats payload, POSTs to relayer |
| `witness_builder.ts` | OCR result → circuit witness |
| `prover/index.ts` | Web Worker orchestration, G1/G2 point byte encoding |
| `prover/snarkjs_worker.ts` | `snarkjs.groth16.fullProve()` in a Web Worker |
| `nfc/nfc_reader.ts` | ISO 7816-4 APDU read (DG1 + SOD) via Web NFC |
| `nfc/nfc_witness_builder.ts` | NFC chip data → circuit witness |
| `nfc/type.ts` | NFC-specific types (`NFCChipRead`, `PassiveAuthResult`, etc.) |
| `extractors/ocr_worker.ts` | Tesseract.js OCR + field extraction + MRZ parsing |
| `extractors/face_worker.ts` | MediaPipe liveness check (yaw/pitch from landmarks) |

### Circuits (Circom)

| File | Role |
|---|---|
| `kyc_ocr.circom` | Main circuit for OCR path. 6 public inputs. |
| `nfc_chip_verify.circom` | NFC path circuit. Proves DG1 hash = SOD hash. |
| `common/age_check.circom` | `current_timestamp - dob ≥ min_age_seconds` |
| `common/freshness_check.circom` | `current_timestamp - issue_date ≤ doc_max_age_seconds` |
| `common/merkle_membership.circom` | Poseidon Merkle inclusion proof |
| `common/nullifier.circom` | `Poseidon(doc_id, user_secret, integrator_id)` |

### Soroban Contracts (Rust)

| Crate | Role |
|---|---|
| `groth16_verifier` | Stateless Groth16 pairing check. Takes VK as argument. |
| `kyc_registry` | The registry hub. Integrator config, nullifier storage, `verify()`. |

---

## 7. Integrator Guide — Getting Started

### Step 1 — Register

```bash
curl -X POST https://relayer.Kakusho.example.com/integrators \
  -H "Content-Type: application/json" \
  -d '{
    "integrator_id_hex": "YOUR_32_BYTE_HEX_ID",
    "name": "My dApp",
    "owner_stellar_address": "GABC...",
    "webhook_url": "https://mydapp.com/webhooks/kyc"
  }'
```

Save the returned `api_key` securely. It is shown exactly once. Rotate it later via `POST /integrators/me/rotate-key`.

---

### Step 2 — Build the Restricted Country Tree

Off-chain, generate a Poseidon Merkle tree of `(low, high)` adjacent pairs from your sorted banned country code list. The tree root is what you registered on-chain.

```bash
node scripts/build_restricted_tree.js --countries NG,KP,IR --output restricted_tree.json
```

Host `restricted_tree.json` on your CDN — the SDK fetches it at proving time.

---

### Step 3 — Host Circuit Assets

After running `trusted_setup.sh` against `circuits/kyc_ocr.circom`:

```
circuits/build/
  kyc_ocr.wasm
  kyc_ocr_final.zkey
  verification_key.json     ← copy to relayer's zk/ folder
```

Host `kyc_ocr.wasm` and `kyc_ocr_final.zkey` on a CDN with CORS headers. The zkey is large (~100MB depending on constraint count) — use a CDN with good caching.

---

### Step 4 — Integrate the SDK

```bash
npm install @Kakusho/zk-kyc-sdk
```

```typescript
import { generateKycProof, submitProof } from '@Kakusho/zk-kyc-sdk';

async function handleDocumentUpload(file: File, userStellarAddress: string) {
  const proof = await generateKycProof({
    documentFile: file,
    integratorAssets: {
      integratorId: process.env.Kakusho_INTEGRATOR_ID,
      minAgeSeconds: 568025136n,         // 18 years
      docMaxAgeSeconds: 157680000n,      // 5 years
      countryCodeMap: await fetch('/assets/country_codes.json').then(r => r.json()),
      restrictedTree: await fetch('/assets/restricted_tree.json').then(r => r.json()),
    },
    proverAssets: {
      wasmUrl: 'https://cdn.example.com/kyc_ocr.wasm',
      zkeyUrl: 'https://cdn.example.com/kyc_ocr_final.zkey',
    },
    onProgress: (stage) => updateProgressUI(stage),
  });

  await submitProof(
    proof,
    process.env.Kakusho_RELAYER_URL,
    process.env.Kakusho_API_KEY,
    userStellarAddress,
  );
}
```

---

### Step 5 — Handle Webhooks

```typescript
// Your webhook endpoint
app.post('/webhooks/kyc', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['x-webhook-signature'];
  const secret = process.env.Kakusho_WEBHOOK_SECRET;
  const expected = crypto.createHmac('sha256', secret).update(req.body).digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return res.status(401).end();
  }

  const payload = JSON.parse(req.body);
  // payload.event === 'proof.verified'
  // payload.nullifier — store this, treat the user as verified

  res.status(200).end();
});
```

---

### API Key Rotation

If your key is compromised, rotate it immediately. There is no grace period — the old key stops working instantly.

```bash
curl -X POST https://relayer.Kakusho.example.com/integrators/me/rotate-key \
  -H "X-API-Key: zkkyc_OLD_KEY"
# Response: { "api_key": "zkkyc_NEW_KEY" }
```

You can also rotate by proving ownership of your Stellar address (useful if you've lost the API key but still control the owner wallet):

```bash
curl -X POST https://relayer.Kakusho.example.com/integrators/rotate-by-owner \
  -d '{
    "stellar_address": "GABC...",
    "signed_message": "<base64 signature>",
    "message": "<the message you signed>",
    "integrator_id": "<your integrator UUID>"
  }'
```

---

### Stats & Monitoring

```bash
# Daily usage
curl https://relayer.Kakusho.example.com/integrators/me/stats \
  -H "X-API-Key: zkkyc_..."

# Response:
# { "used_today": 42, "limit": 1000, "total_submissions": 8721 }
```

---

## 8. User Journey

### OCR Path (Any Device)

1. User opens your dApp and clicks "Verify Identity"
2. User selects a photo of their document (passport, national ID, or driving licence)
3. **In the browser:** Tesseract.js extracts fields from the image
4. **In the browser:** A Web Worker generates a Groth16 proof (~30s–2min depending on device)
5. Progress bar updates: `fetching_wasm → fetching_zkey → computing_witness → generating_proof → done`
6. Proof is submitted to the Kakusho relayer
7. Relayer runs pre-check, enforces spend limit, submits to Soroban
8. Your webhook receives `proof.verified` with the nullifier
9. You mark the user as KYC-verified in your system

### NFC Path (Android Chrome Only)

1. User opens your dApp on Android Chrome, clicks "Scan Passport Chip"
2. User is prompted to tap their document to the back of their phone
3. **In the browser:** ISO 7816-4 APDUs read DG1 (MRZ) and SOD from the chip
4. DG1 + SOD bytes are uploaded to the relayer's `/nfc/verify-chip`
5. **On the relayer:** Passive Authentication runs the CSCA→DS→SOD→DG1 hash chain
6. Relayer returns the verified hash pair
7. **In the browser:** Groth16 proof is generated from the hash pair
8. Proof is submitted to `/nfc/submit-proof`
9. Same webhook delivery as OCR path, with `"proof_type": "nfc"`

---

## 9. Security Model

### What Is Trusted

- **The Soroban ledger timestamp** — used to bound-check `current_timestamp`. A prover cannot supply a wildly stale timestamp to make an expired document appear fresh.
- **The CSCA master list** (NFC path) — downloaded from ICAO's PKD. Must be kept updated annually.
- **The trusted setup output** (`verification_key.json`, `kyc_ocr_final.zkey`) — must be the real output of an honest trusted setup. A compromised zkey would allow fake proofs. Use a multi-party ceremony in production.

### What Is NOT Trusted (By Design)

- **The relayer** — cannot see user PII; it never receives document images or personal data, only proofs.
- **The integrator** — never sees user data either. They only receive a nullifier and a transaction hash.
- **The prover's `current_timestamp`** — the circuit cannot prove this is the real current time. The contract compensates with `MAX_TIMESTAMP_DRIFT_SECONDS = 3600`.

### Nullifier Unlinkability

The nullifier is `Poseidon(doc_id, user_secret, integrator_id)`.

- Two integrators **cannot correlate** that the same user verified with both of them — their nullifiers differ because `integrator_id` differs.
- The same physical document **cannot verify twice** with the same integrator — the nullifier is stored on-chain after first use.
- `user_secret` is generated randomly in the browser and never transmitted — even if an attacker gets `doc_id`, they cannot compute the nullifier without the secret.

### API Key Security

API keys are stored in the database as SHA-256 hashes only. A database breach does not expose working API keys. The plaintext key is shown exactly once at creation and never logged.

---

## 10. Known Limitations & TODOs

### Incomplete Implementations (Do Not Use in Production As-Is)

| Component | Status |
|---|---|
| `stellar_sponsor.py` → `_public_signals_scval()` | **Not implemented.** Bn254Fr ScVal encoding is unverified. Raises `NotImplementedError`. |
| `stellar_sponsor.py` → `poll_transaction_result()` | **Not implemented.** Transaction polling/result decoding is a stub. |
| `kyc_registry` DEFAULT_VK constants | **Placeholder values.** Must be replaced with real trusted setup output. |
| NFC path `vk_path` for off-chain check | `verify_proof_off_chain()` currently uses the OCR VK. NFC circuit needs a separate `nfc_verification_key.json`. |

### Design Decisions to Revisit

- **`current_timestamp` is prover-supplied.** The circuit proves internal consistency, not that the timestamp is real. The contract's `MAX_TIMESTAMP_DRIFT_SECONDS` is the only guard.
- **Spend limit has a race window.** Two concurrent requests for the same integrator can both pass the check before either inserts. Acceptable for current volumes; use `SELECT ... FOR UPDATE` if you need a hard cap.
- **NFC requires BAC-less documents.** Most passports use BAC. The Web NFC path only works for national IDs without BAC, or if the app implements the BAC key exchange (MRZ-derived keys) before reading.
- **Single DEFAULT_VK for all integrators.** Adding a custom VK per integrator requires extending `IntegratorConfig.nfc_vk_hash_override` on the contract storage side and adding per-integrator VK lookup in `kyc_registry.verify()`.
- **No revocation.** Once a nullifier is stored, there is no mechanism to un-verify a user (e.g. if their document expires or is reported stolen). Consider adding an `invalidate_nullifier()` admin function gated by `owner.require_auth()`.