/**
 * @trustid/zk-kyc-sdk
 *
 * Client-side ZK KYC SDK. Generates Groth16 proofs entirely in the browser.
 * No PII, no document images, no selfies ever leave the user's device.
 * Only the final cryptographic proof is submitted to the relayer.
 *
 * Usage:
 *   import { generateKycProof, submitProof, KycRejectedError } from '@trustid/zk-kyc-sdk';
 */

// ── Core ──────────────────────────────────────────────────────────────────────
export {
  generateKycProof,
  KycRejectedError,
  type GenerateProofOptions,
} from "./core/index";

// ── Proof submission helper ───────────────────────────────────────────────────
export { submitProof, type SubmitProofPayload, type SubmitProofResponse } from "./submit";

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  KycProofResult,
  OcrResult,
  KycWitness,
  IntegratorConfig,
  ProverAssetUrls,
  RestrictedTreeBracket,
} from "./types";

export type {
  IntegratorAssets,
  OcrResultForWitness,
} from "./witness_builder";

export type { ProvingStage } from "./prover/index";
export type { LivenessResult } from "./extractors/face_worker";

// ── Errors ────────────────────────────────────────────────────────────────────
export { OCRError } from "./extractors/ocr_worker";
export { WitnessBuildError } from "./witness_builder";