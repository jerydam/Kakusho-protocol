// core/index.ts — the SDK's main entry point.
// Orchestrates OCR → liveness → witness building → Groth16 proving.
// All processing is client-side. No PII leaves the browser.

import { runOcr, OCRError } from "../extractors/ocr_worker";
import { livenessCheckMulti, type LivenessResult } from "../extractors/face_worker";
import { buildWitnessFromOcr, WitnessBuildError, type IntegratorAssets } from "../witness_builder";
import { generateProof, type ProvingStage } from "../prover/index";
import type { KycProofResult, ProverAssetUrls } from "../types";

export { OCRError, WitnessBuildError };
export type { LivenessResult, ProvingStage, KycProofResult, IntegratorAssets };

export interface GenerateProofOptions {
  /** The ID document image (passport, driving licence, national ID). */
  idDocument: File | Blob;
  /**
   * 4 selfie images: looking left, right, up, down.
   * Required for the liveness check.
   */
  selfies: [File | Blob, File | Blob, File | Blob, File | Blob];
  /**
   * Integrator's registered rules + country code map + restricted tree.
   * Fetch from kyc_registry.get_integrator() + host the tree JSON from
   * the TrustID dashboard's country builder.
   */
  integratorAssets: IntegratorAssets;
  /**
   * CDN URLs for compiled circuit WASM + proving key.
   * Same for all integrators — host on a CDN with long cache headers.
   */
  proverAssets: ProverAssetUrls;
  onProgress?: (stage: "ocr" | "liveness" | ProvingStage) => void;
  /** Passed through to generateProof() — see prover/index.ts's ProveOptions.workerUrl for when you need this. */
  workerUrl?: string | URL;
}

export class KycRejectedError extends Error {
  constructor(
    message: string,
    public reason: "ocr_failed" | "liveness_failed" | "predicate_failed"
  ) {
    super(message);
    this.name = "KycRejectedError";
  }
}

/**
 * Runs the full client-side KYC flow:
 *   1. OCR the ID document (Tesseract.js)
 *   2. Liveness check on 4 selfies (MediaPipe)
 *   3. Build the circuit witness
 *   4. Generate a Groth16 proof (snarkjs, Web Worker)
 *
 * Returns a KycProofResult ready to submit to kyc_registry.verify()
 * via the TrustID relayer or your own Stellar transaction.
 *
 * The document image, selfie images, and all extracted PII are never
 * sent anywhere — only the final proof leaves this function.
 */
export async function generateKycProof(options: GenerateProofOptions): Promise<KycProofResult> {
  // ── Step 1: OCR ──────────────────────────────────────────────────────────
  options.onProgress?.("ocr");
  let ocrResult;
  try {
    ocrResult = await runOcr(options.idDocument);
  } catch (e) {
    if (e instanceof OCRError) throw new KycRejectedError(e.message, "ocr_failed");
    throw e;
  }

  // ── Step 2: Liveness ─────────────────────────────────────────────────────
  options.onProgress?.("liveness");
  const images = await Promise.all(
    options.selfies.map((blob) => createImageBitmapAsCanvas(blob))
  );
  const liveness = await livenessCheckMulti(images);
  if (!liveness.passed) {
    const missing = ["left", "right", "up", "down"].filter(
      (p) => !liveness.detectedPoses.includes(p as never)
    );
    throw new KycRejectedError(
      `Liveness check failed. Missing poses: ${missing.join(", ")}. Please retake your selfies.`,
      "liveness_failed"
    );
  }

  // ── Step 3: Build witness ────────────────────────────────────────────────
  let witness;
  try {
    witness = await buildWitnessFromOcr(
      {
        dateOfBirth: ocrResult.dateOfBirth,
        issueDate: ocrResult.issueDate,
        nationality: ocrResult.nationality,
        docNumber: ocrResult.docNumber,
      },
      options.integratorAssets
    );
  } catch (e) {
    if (e instanceof WitnessBuildError) throw new KycRejectedError(e.message, "predicate_failed");
    throw e;
  }

  // ── Step 4: Generate proof ───────────────────────────────────────────────
  return generateProof(witness, options.proverAssets, {
    onProgress: (stage) => options.onProgress?.(stage),
    ...(options.workerUrl !== undefined ? { workerUrl: options.workerUrl } : {}),
  });
}

async function createImageBitmapAsCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  return canvas;
}