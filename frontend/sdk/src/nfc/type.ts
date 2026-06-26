// nfc/types.ts — NFC-specific types for @Kakusho/zk-kyc-sdk.
//
// Extends but does NOT modify the existing types.ts. KycProofResult and
// KycWitness are reused unchanged — the NFC path produces the same proof
// shape as the OCR path, so submitProof() works without modification.
//
// The only meaningful difference: witness inputs come from chip data
// rather than OCR, and the proof_type tag in the submission payload is
// "nfc" instead of "ocr" (handled in submit.ts's NFC overload).

import type { KycProofResult, ProverAssetUrls } from "../types";
import type { IntegratorAssets } from "../witness_builder";
import type { ProvingStage } from "../prover/index";

// ─── NFC chip read result ─────────────────────────────────────────────────────

/**
 * Raw bytes read from the two EF (Elementary File) data groups that
 * Passive Authentication needs. Produced by readNFCChip() in nfc_reader.ts.
 *
 * These bytes never leave the device — they are passed locally to
 * verifyPassiveAuth() then discarded. Only the derived hash pair and
 * ultimately the ZK proof leave the browser.
 */
export interface NFCChipRead {
  /** Raw DER bytes of EF.DG1 (Data Group 1 — the MRZ data). */
  dg1Bytes: Uint8Array;
  /** Raw DER bytes of EF.SOD (Document Security Object). */
  sodBytes: Uint8Array;
}

// ─── Passive Authentication result ───────────────────────────────────────────

/**
 * Returned by the relayer's POST /nfc/verify-chip after it has run the
 * full CSCA→DS→SOD→DG1 hash chain. The SDK receives this and uses the
 * two hash fields as paired circuit inputs.
 *
 * This is what the relayer returns; the SDK never performs the DS/CSCA
 * signature check itself (requires the CSCA master list + asymmetric
 * crypto not available in a sandboxed browser worker).
 */
export interface PassiveAuthResult {
  /**
   * SHA-256 of the DG1 bytes the chip returned, as computed by the
   * relayer from the bytes the SDK uploaded. Fed into the circuit as
   * the private dg1_data_bits[256] input.
   */
  dg1HashHex: string;
  /**
   * SHA-256 of DG1 as recorded inside the DS-signed SOD. Fed into the
   * circuit as the public sod_dg1_hash_bits[256] input.
   * The circuit proves these two values are equal.
   */
  sodDg1HashHex: string;
  /** ISO 3166-1 alpha-2 country code from the DS certificate subject. */
  countryAlpha2: string;
}

// ─── Parsed MRZ fields (from DG1 bytes, client-side) ─────────────────────────

/**
 * Fields extracted from the raw DG1 MRZ bytes on the client side.
 * Equivalent to OcrResultForWitness for the OCR path — same downstream
 * consumer (buildWitnessFromNFC reuses parseDateToUnix + nationalityToCode
 * from witness_builder.ts).
 */
export interface NFCMrzFields {
  dateOfBirth: string;   // YYYY-MM-DD (normalised from MRZ YYMMDD)
  issueDate: string;     // YYYY-MM-DD — from expiry date as proxy if DG11 unavailable
  nationality: string;   // ISO 3166-1 alpha-3, e.g. "GBR"
  docNumber: string;     // 9-char MRZ doc number (right-padded with '<')
  /** Packed BigInt representation for the ZK circuit doc_id field. */
  docNumberBigInt: bigint;
}

// ─── NFC KycWitness (same shape as KycWitness, different source) ──────────────

// The NFC path reuses KycWitness from types.ts unchanged.
// buildWitnessFromNFC() in nfc_witness_builder.ts returns KycWitness,
// which is then passed to generateProof() in prover/index.ts — identical
// to what generateKycProof() does after buildWitnessFromOcr().

// ─── NFC proof generation options ────────────────────────────────────────────

export interface GenerateNFCProofOptions {
  /**
   * The relayer's base URL. Used for two calls:
   *   POST /nfc/verify-chip  — Passive Authentication (CSCA→DS→SOD→DG1)
   *   (proof submission uses the existing submitProof() helper)
   */
  relayerUrl: string;
  /** Integrator API key (zkkyc_...) — sent as X-API-Key. */
  apiKey: string;
  /**
   * Integrator rules + country code map + restricted tree.
   * Same object as GenerateProofOptions.integratorAssets — no new fields needed.
   */
  integratorAssets: IntegratorAssets;
  /**
   * CDN URLs for the NFC circuit's compiled WASM + proving key.
   * These are DIFFERENT files from the OCR circuit:
   *   wasmUrl: nfc_chip_verify.wasm
   *   zkeyUrl: nfc_chip_verify_final.zkey
   * Host them on the same CDN as the OCR circuit assets.
   */
  nfcProverAssets: ProverAssetUrls;
  /**
   * Progress callback. NFC stages wrap the existing ProvingStage values
   * with two NFC-specific preamble stages.
   */
  onProgress?: (stage: NFCProvingStage) => void;
  /** Passed through to generateProof() — see prover/index.ts's ProveOptions.workerUrl for when you need this. */
  workerUrl?: string | URL;
}

/**
 * All progress stages emitted by generateNFCProof().
 * The first two are NFC-specific; the rest are the same ProvingStage
 * values already used by generateKycProof().
 */
export type NFCProvingStage =
  | "nfc_reading"        // Waiting for user to tap document / APDU exchange
  | "passive_auth"       // Relayer verifying DS cert chain
  | ProvingStage;        // fetching_wasm | fetching_zkey | computing_witness | generating_proof | done

// ─── NFC-specific errors ──────────────────────────────────────────────────────

/**
 * Thrown by readNFCChip() for hardware/permission/BAC failures.
 * Distinct from KycRejectedError (which signals policy rejection)
 * so integrators can prompt the user to retry vs. fall back to OCR.
 */
export class NFCReadError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_supported"       // Web NFC not available in this browser
      | "permission_denied"   // User denied NFC permission
      | "bac_required"        // Passport uses BAC — Web NFC path can't proceed
      | "tag_lost"            // User moved document away mid-read
      | "read_failed"         // Generic APDU/IO error
  ) {
    super(message);
    this.name = "NFCReadError";
  }
}

/**
 * Thrown by verifyPassiveAuth() when the relayer rejects the chip data.
 * Indicates a tampered or genuinely invalid chip (or CSCA master list gap).
 */
export class PassiveAuthError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "hash_mismatch"       // DG1 hash ≠ SOD-recorded hash
      | "invalid_signature"   // DS cert sig over SOD failed
      | "untrusted_csca"      // DS cert doesn't chain to known CSCA
      | "relayer_error"       // Non-crypto relayer failure (network, 5xx)
  ) {
    super(message);
    this.name = "PassiveAuthError";
  }
}