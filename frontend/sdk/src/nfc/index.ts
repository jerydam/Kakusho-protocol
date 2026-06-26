// nfc/nfc_index.ts — orchestrates the full NFC KYC flow.
// OCR path equivalent: core/index.ts → generateKycProof()
// This is the main entry for the NFC path.

import { readNFCChip } from "./nfc_reader";
import { parseDG1, buildWitnessFromNFC } from "./nfc_witness_builder";
import { generateProof } from "../prover/index";
import { PassiveAuthError } from "./type";
import { WitnessBuildError } from "../witness_builder";
import { KycRejectedError } from "../core/index";
import type { GenerateNFCProofOptions } from "./type";
import type { KycProofResult } from "../types";

/**
 * Full NFC KYC flow:
 *   1. Read DG1 + SOD from NFC chip
 *   2. POST to relayer for Passive Authentication (CSCA→DS→SOD→DG1 chain)
 *   3. Parse DG1 bytes → MRZ fields (client-side)
 *   4. Build ZK witness
 *   5. Generate Groth16 proof (Web Worker)
 */
export async function generateNFCProof(
  options: GenerateNFCProofOptions,
  signal?: AbortSignal
): Promise<KycProofResult> {
  // ── Step 1: NFC read ──────────────────────────────────────────────────────
  options.onProgress?.("nfc_reading");
  const chipRead = await readNFCChip(signal);

  // ── Step 2: Passive Authentication (relayer) ──────────────────────────────
  options.onProgress?.("passive_auth");
  const paRes = await fetch(`${options.relayerUrl}/nfc/verify-chip`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": options.apiKey,
    },
    body: JSON.stringify({
      dg1_bytes_hex: bytesToHex(chipRead.dg1Bytes),
      sod_bytes_hex: bytesToHex(chipRead.sodBytes),
    }),
    signal: signal ?? null,
  });

  if (!paRes.ok) {
    const err = await paRes.json().catch(() => ({})) as Record<string, unknown>;
    const code = (err.code as string) ?? "relayer_error";
    throw new PassiveAuthError(
      (err.detail as string) ?? `Passive auth failed: ${paRes.status}`,
      code as "hash_mismatch" | "invalid_signature" | "untrusted_csca" | "relayer_error"
    );
  }

  const paResult = await paRes.json() as {
    dg1_hash_hex: string;
    sod_dg1_hash_hex: string;
    country_alpha2: string;
  };

  // ── Step 3: Parse DG1 (client-side) ──────────────────────────────────────
  let mrzFields;
  try {
    mrzFields = parseDG1(chipRead.dg1Bytes);
  } catch (e) {
    if (e instanceof WitnessBuildError) {
      throw new KycRejectedError(e.message, "ocr_failed"); // reuse code for "parse failed"
    }
    throw e;
  }

  // ── Step 4: Build witness ─────────────────────────────────────────────────
  let witness;
  try {
    witness = await buildWitnessFromNFC(
      mrzFields,
      {
        dg1HashHex: paResult.dg1_hash_hex,
        sodDg1HashHex: paResult.sod_dg1_hash_hex,
        countryAlpha2: paResult.country_alpha2,
      },
      options.integratorAssets
    );
  } catch (e) {
    if (e instanceof WitnessBuildError) {
      throw new KycRejectedError(e.message, "predicate_failed");
    }
    throw e;
  }

  // ── Step 5: Generate proof ────────────────────────────────────────────────
  // Cast NFCKycWitness → KycWitness — both have the same field names/types
  // that snarkjs_worker.ts reads. NFC-specific fields (hash bit arrays) are
  // included verbatim; the NFC circuit .wasm/.zkey expects them.
  return generateProof(witness as never, options.nfcProverAssets, {
    onProgress: (stage) => options.onProgress?.(stage),
    ...(options.workerUrl !== undefined ? { workerUrl: options.workerUrl } : {}),
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}