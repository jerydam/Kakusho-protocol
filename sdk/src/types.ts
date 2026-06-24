// types.ts — the contract between this SDK and kyc_registry's verify()
// function. If you change kyc_ocr.circom's public signal order, this
// file, the circuit, and kyc_registry's verify() doc comment all need
// to change together — see lib.rs's warning about silent mismatches.

/** Rules an integrator has registered on-chain via kyc_registry. Fetched
 * before proving so the SDK builds a proof against the RIGHT rules —
 * proving against stale/wrong rules just produces a proof verify()
 * will reject. */
export interface IntegratorConfig {
  integratorId: string; // hex-encoded 32 bytes
  minAgeSeconds: bigint;
  restrictedRoot: string; // hex-encoded 32 bytes, Merkle root of banned-country pairs
  docMaxAgeSeconds: bigint;
  active: boolean;
}

/** Fields extracted from a document via in-browser OCR (see
 * extractors/ocr_worker.ts). Mirrors backend/app/kyc/ocr.py's
 * `run_ocr()` output shape from the original server-side design —
 * deliberately kept similar so any logic you already validated there
 * ports over with minimal changes, just moved to the browser. */
export interface OcrResult {
  docType: string;
  name: string | null;
  dateOfBirth: string | null;
  docNumber: string | null;
  expiry: string | null;
  issueDate: string | null;
  nationality: string | null;
  confidence: number;
}

/** The full private witness for kyc_ocr.circom, built entirely
 * client-side from OcrResult + the integrator's bracket tree. NEVER
 * sent anywhere — only used locally to generate a proof, then
 * discarded. */
export interface KycWitness {
  // public
  current_timestamp: string;
  min_age_seconds: string;
  restricted_root: string;
  doc_max_age_seconds: string;
  integrator_id: string;
  // private
  dob_timestamp: string;
  nationality_code: string;
  doc_id: string;
  doc_issue_timestamp: string;
  user_secret: string;
  bracket_low: string;
  bracket_high: string;
  path_elements: string[];
  path_indices: string[];
}

/** Groth16 proof + the public signals it was generated against, ready
 * to submit to kyc_registry.verify(). This is the ONLY thing that
 * leaves the browser besides the integrator's already-public rules. */
export interface KycProofResult {
  proofA: Uint8Array; // 64 bytes
  proofB: Uint8Array; // 128 bytes
  proofC: Uint8Array; // 64 bytes
  publicSignals: {
    currentTimestamp: bigint;
    minAgeSeconds: bigint;
    restrictedRoot: string;
    docMaxAgeSeconds: bigint;
    integratorId: string;
  };
  nullifier: string; // hex-encoded 32 bytes
}

export interface RestrictedTreeBracket {
  bracketLow: number;
  bracketHigh: number;
  pathElements: string[];
  pathIndices: number[];
  restrictedRoot: string;
}

/** Where the SDK fetches the compiled circuit + proving key from. These
 * are large (the zkey can be several MB) — host on a CDN, not your own
 * origin if you can avoid it, and set long cache headers since they
 * only change when you re-run trusted_setup.sh. */
export interface ProverAssetUrls {
  wasmUrl: string;
  zkeyUrl: string;
}
