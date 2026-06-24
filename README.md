# zk-kyc-protocol

A B2B2C, edge-proving ZK identity verification protocol on Stellar/Soroban —
integrators (dApps) register their own age and country-restriction rules;
their end users prove compliance with those rules entirely in their own
browser, and only a Groth16 proof ever touches a server or a blockchain.

## Why this exists

Most KYC flows require a user to upload their passport to a company's
server. This protocol's design goal is that **no server, including ours,
ever receives a user's document image or extracted PII.** OCR, liveness
detection, and zero-knowledge proof generation all run client-side (in a
browser, via WASM), via the SDK in `sdk/`. What leaves the browser is a
cryptographic proof that the user satisfies an integrator's rules
(minimum age, not from a restricted country, document not expired) —
nothing else.

## How the B2B2C model works

1. A dApp ("integrator") calls `kyc_registry.register_integrator()` once,
   setting their own `min_age_seconds`, `restricted_root` (a Merkle root
   of their banned-country list), and `doc_max_age_seconds`.
2. The dApp embeds the SDK (`sdk/`) in their own frontend.
3. Their end user runs through the SDK's `generateKycProof()`, which OCRs
   their ID document, checks liveness via 4 selfies, and produces a
   Groth16 proof — all in their browser.
4. The dApp calls `kyc_registry.verify()` with that proof. The contract
   checks the proof's public inputs actually match what THIS integrator
   registered (not just "some valid proof for some rule set"), checks the
   document hasn't been used before for this integrator, and runs the
   Groth16 pairing check.
5. On success, the dApp's own contract or backend decides what
   "verified" unlocks — this protocol doesn't mint tokens, store user
   records, or make that decision for you.

See `docs/architecture.md` for the full data flow and
`docs/integration-guide.md` if you're a dApp wanting to integrate.

## Repository layout

```
circuits/     The universal Circom circuit + build/setup scripts
contracts/    Soroban contracts (kyc_registry, groth16_verifier)
sdk/          TypeScript SDK integrators embed in their frontend
docs/         Architecture and integration documentation
```

## Status

This is a working skeleton, not a finished audited protocol. Concretely:

- The circuit (`circuits/ocr_tier/kyc_ocr.circom`) is complete and should
  compile as-is.
- `contracts/kyc_registry` and `contracts/groth16_verifier` are written
  and have test coverage for control flow (auth, replay protection,
  rule-matching), but `contracts/kyc_registry/src/lib.rs`'s `default_vk`
  module contains PLACEHOLDER zero-bytes, not a real verifying key — you
  must run `circuits/scripts/trusted_setup.sh` and paste real output in
  before this will verify any real proof.
- The SDK (`sdk/`) has OCR, liveness, witness-building, and proving
  wired end-to-end, but the OCR port from the original Python pipeline
  is weaker on poor-quality scans (see `sdk/src/extractors/ocr_worker.ts`
  header for specifics) and should be validated against real documents
  before launch.
- No chip/NFC tier yet — that's future work, tracked loosely in the
  original project's `backend/app/chip/` stubs if you want to revive
  that direction later.
- **Not audited.** Do not use this for real value without a professional
  security review of both the circuit and the Soroban contracts.
