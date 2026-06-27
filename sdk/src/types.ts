// types.ts — the contract between this SDK and kyc_registry's verify()
// function. If you change kyc_ocr.circom's public signal order, this
// file, the circuit, and kyc_registry's verify() doc comment all need
// to change together.

export interface IntegratorConfig {
  integratorId: string; // hex-encoded 32 bytes
  minAgeSeconds: bigint;
  restrictedRoot: string; // hex-encoded 32 bytes, Merkle root of banned-country pairs
  docMaxAgeSeconds: bigint;
  active: boolean;
}

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
  pathIndices: string[];
  restrictedRoot: string;
}

export interface ProverAssetUrls {
  wasmUrl: string;
  zkeyUrl: string;
}