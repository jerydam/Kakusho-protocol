# Integration guide

This is for teams integrating the protocol into their own dApp — i.e.
you want your users to prove they're over some age and not from a
restricted jurisdiction, without your servers ever touching their ID
documents.

## 1. Register your integrator config

Choose a 32-byte `integrator_id` (e.g. `sha256("your-app-name")` —
anything unique and stable works, since it's just a namespace key, not
a secret) and call:

```
kyc_registry.register_integrator(
  integrator_id: <your 32 bytes>,
  owner: <your Stellar address, will need to sign this tx>,
  min_age_seconds: <e.g. 568025136 for ~18 years>,
  restricted_root: <see step 2>,
  doc_max_age_seconds: <e.g. 315360000 for ~10 years>,
)
```

Only `owner` can later call `update_integrator_rules`, `set_active`, or
`set_custom_vk` for this `integrator_id` — Soroban's `require_auth()`
enforces this, so keep that key secured the way you'd secure any
contract-admin key.

## 2. Build your restricted-country tree

If you need to exclude users from specific jurisdictions, decide your
list of ISO 3166-1 numeric country codes and run:

```bash
node circuits/scripts/build_restricted_tree.js my_restricted_codes.json my_tree.json
```

This outputs a Merkle root (pass this as `restricted_root` above) and a
set of bracket-proof data your frontend needs to host and serve to the
SDK (see step 4). If you have no country restrictions at all, you can
still build a tree with an empty restricted list — every nationality
code will fall in the one open bracket `(0, 999999999)`.

## 3. Build your country code map

The SDK's witness builder needs a mapping from OCR-extracted nationality
text (e.g. `"NIGERIAN"`, `"USA"`) to ISO 3166-1 numeric codes, since the
circuit operates on numbers, not strings. There's no protocol-wide
default — host your own JSON, extending coverage for whatever
nationalities your expected users will have. Keep this in sync with
whatever codes you used building your restricted tree in step 2.

## 4. Embed the SDK in your frontend

```ts
import { generateKycProof, KycRejectedError } from "@your-org/zk-kyc-sdk";

const result = await generateKycProof({
  idDocument: idPhotoFile,
  selfies: [leftSelfie, rightSelfie, upSelfie, downSelfie],
  integratorAssets: {
    countryCodeMap: myCountryCodeMap,       // from step 3
    restrictedTree: myTreeJson,              // from step 2
    minAgeSeconds: 568025136n,
    docMaxAgeSeconds: 315360000n,
    integratorId: "0x...",                  // your integrator_id, hex
  },
  proverAssets: {
    wasmUrl: "https://your-cdn.example.com/kyc_ocr.wasm",
    zkeyUrl: "https://your-cdn.example.com/kyc_ocr_final.zkey",
  },
  onProgress: (stage) => console.log("KYC progress:", stage),
});
```

`proverAssets` point at the universal circuit's compiled WASM + zkey —
these are the SAME for every integrator (see
`docs/architecture.md`), so in practice you'll likely just hardcode the
protocol's official CDN URLs here rather than hosting your own copy,
unless you're running a private/enterprise deployment.

On success, `result` contains `proofA`, `proofB`, `proofC` (byte
arrays) and `publicSignals` + `nullifier` — everything needed for step 5.

On failure, catch `KycRejectedError` and check `.reason`:
`"ocr_failed"` (bad image quality), `"liveness_failed"` (selfie poses
missing), or `"predicate_failed"` (document is genuine and readable but
the user doesn't actually meet your age/country/freshness requirements
— e.g. they're underage, or from a restricted country).

## 5. Submit the proof on-chain

```
kyc_registry.verify(
  integrator_id: <your integrator_id>,
  nullifier: result.nullifier,
  current_timestamp: result.publicSignals.currentTimestamp,
  proof_a: result.proofA,
  proof_b: result.proofB,
  proof_c: result.proofC,
  public_signals: <the Vec<Bn254Fr> form — see note below>,
)
```

This can be called from your own backend (if you're sponsoring the
transaction fee for your user) or from the user's own wallet
transaction. Either way, the call doesn't need to come from the same
browser session that generated the proof — the proof itself is the
authorization, not the caller's identity.

**Note on `public_signals` encoding:** the SDK returns `publicSignals`
as a structured object with `bigint`/hex-string fields for readability,
but `kyc_registry.verify()`'s actual parameter is a
`Vec<Bn254Fr>` in the circuit's declared order. Converting between
these is part of your Soroban client-side call construction — consult
`contracts/kyc_registry/src/lib.rs`'s doc comment on `verify()` for the
exact expected order, and test this conversion against a real proof
before going live; a misordered vector fails the pairing check silently
rather than throwing a clear error.

## 6. Decide what "verified" unlocks

This protocol intentionally does nothing else once `verify()` returns
`true`. Minting an access token, updating a user record, unlocking a
feature — that's your contract or backend's decision, not something
this protocol does for you. This is what "Zero Liability" in the
project's original design notes refers to: we never see PII, we never
decide what verification grants, we just answer "does this proof
satisfy your rules" truthfully.
