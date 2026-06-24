# Architecture

## Data flow

```
┌─────────────────────────────────────────────────────────────┐
│ USER'S BROWSER (via integrator's frontend + this SDK)        │
│                                                                │
│  ID photo ──► OCR (Tesseract.js) ──► OcrResult                │
│  4 selfies ──► Liveness (MediaPipe) ──► pass/fail              │
│                                                                │
│  OcrResult + integrator's rules ──► witness_builder.ts        │
│         ──► KycWitness (private: dob, doc_id, nationality...) │
│                                                                │
│  KycWitness ──► snarkjs (Web Worker, WASM) ──► Groth16 proof  │
│                                                                │
│  ONLY THIS LEAVES THE BROWSER: proof + public signals         │
└────────────────────────┬───────────────────────────────────-─┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ STELLAR / SOROBAN                                              │
│                                                                │
│  kyc_registry.verify(integrator_id, nullifier,                │
│                       current_timestamp, proof, public_signals)│
│    1. Look up integrator's registered rules                   │
│    2. Check current_timestamp within drift window of ledger   │
│    3. Check nullifier not already used FOR THIS INTEGRATOR     │
│    4. Check public_signals == integrator's actual rules        │
│    5. groth16_verifier.verify_proof(vk, proof, public_signals) │
│    6. Record nullifier, return true/false                     │
│                                                                │
│  Integrator's own contract/backend decides what "true" unlocks │
└─────────────────────────────────────────────────────────────┘
```

## Why public inputs, not separate circuits, encode the rules

A Groth16 circuit's structure (the constraint system) is fixed once
compiled — that's what the verifying key commits to. But the *values*
plugged into public input signals are chosen at proving time, by
whoever's generating the proof. `kyc_ocr.circom` declares
`min_age_seconds`, `restricted_root`, `doc_max_age_seconds`, and
`integrator_id` as public inputs precisely so the SAME compiled circuit
(and therefore the same verifying key) can serve every integrator — a
casino requiring 21+ and a DeFi protocol requiring 18+ both run identical
constraint systems; they just supply different numbers.

This is what makes the protocol B2B2C without needing per-integrator
circuits, trusted setups, or verifying keys for the common case. See
`contracts/kyc_registry/src/storage.rs` for the `custom_vk` escape hatch
if an integrator eventually needs genuinely different predicate logic
(not just different numbers).

## Trust boundaries

**The circuit proves:** the prover knows a `(dob_timestamp,
nationality_code, doc_id, doc_issue_timestamp, user_secret)` tuple such
that age, country-exclusion, and freshness predicates hold against the
supplied public inputs, and the resulting nullifier is correctly
computed from `(doc_id, user_secret, integrator_id)`.

**The circuit does NOT prove:** that `dob_timestamp` /
`nationality_code` / etc. actually came from a real, unmodified
document. In the OCR tier (what's implemented here), those values come
from OCR run on a photo the user uploaded — a user who can fabricate a
fake document image, or feed fabricated values directly into the
witness builder (since witness building happens in their own browser,
which they fully control), can generate a "valid" proof for false
claims. **This is the core limitation of self-attested input, and it's
why the original project's TRUST_LEVEL.md distinction between OCR-tier
and chip-tier (cryptographically signed by the issuing government)
trust matters.** Don't market OCR-tier proofs as "verified identity" to
integrators without this caveat front and center — it's closer to "this
document, if genuine, would satisfy these rules" than "this person's
identity has been confirmed by an authority."

**`current_timestamp` is also prover-supplied** (see
`kyc_ocr.circom`'s header and `kyc_registry`'s
`MAX_TIMESTAMP_DRIFT_SECONDS`), bounded against ledger time on-chain but
not otherwise authoritative.

**What integrators can audit on-chain:** every integrator's
`min_age_seconds`, `restricted_root`, and `doc_max_age_seconds` are
public contract state, not secrets. Anyone can verify what rules an
integrator actually enforces.

**What integrators receive from a successful `verify()` call:** a
boolean. No name, no document number, no nationality, no date of birth.
The nullifier lets them detect "this same document was already used to
verify against US specifically" without learning anything else about
the document — and per `nullifier.circom`'s domain separation, that
nullifier is meaningless to (can't be correlated with) any other
integrator's nullifier for the same document.
