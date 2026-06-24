// index.ts — the SDK's public surface. This is what an integrator's
// frontend imports: `import { ZkKyc } from "@your-org/zk-kyc-sdk"`.
//
// Everything in extractors/ and prover/ stays internal — integrators
// shouldn't need to know OCR or proving happens in a worker, only that
// calling generateKycProof() eventually resolves with a proof they can
// hand to their own contract-calling code (or to your relayer backend,
// see backend/app/services/stellar_sponsor.py for the sponsored-tx
// pattern if the integrator's users have no XLM for fees).

import { runOcr, OCRError } from "./extractors/ocr_worker";
import { livenessCheckMulti, type LivenessResult } from "./extractors/face_worker";
import { buildWitnessFromOcr, WitnessBuildError, type IntegratorAssets } from "./witness_builder";
import { generateProof, type ProvingStage } from "./prover";
import type { KycProofResult, ProverAssetUrls } from "./types";

export { OCRError, WitnessBuildError };
export type { LivenessResult, ProvingStage, KycProofResult, IntegratorAssets };

export interface GenerateProofOptions {
  /** The ID document image (passport, driving licence, national ID). */
  idDocument: File | Blob;
  /** 4 selfie images: looking left, right, up, down — required for the
   * liveness check, matching the original /kyc/verify-face flow's
   * 4-pose requirement. */
  selfies: [File | Blob, File | Blob, File | Blob, File | Blob];
  /** This integrator's registered rules + country code map + restricted
   * tree, typically fetched from kyc_registry.get_integrator() plus a
   * static JSON asset the integrator hosts (see
   * docs/integration-guide.md for the expected shape). */
  integratorAssets: IntegratorAssets;
  /** CDN URLs for the compiled circuit WASM + proving key. These are
   * the SAME for every integrator (one universal circuit) — typically
   * you'd hardcode your own CDN URLs here as SDK defaults rather than
   * having every integrator supply them, but they're exposed as a
   * parameter so integrators on a private/enterprise deployment can
   * point at their own mirror. */
  proverAssets: ProverAssetUrls;
  onProgress?: (stage: "ocr" | "liveness" | ProvingStage) => void;
}

export class KycRejectedError extends Error {
  constructor(message: string, public reason: "ocr_failed" | "liveness_failed" | "predicate_failed") {
    super(message);
    this.name = "KycRejectedError";
  }
}

/**
 * Runs the full client-side KYC flow: OCR the ID document, run
 * liveness detection on the 4 selfies, build the circuit witness, and
 * generate a Groth16 proof — all in the browser. Returns a proof ready
 * to submit to kyc_registry.verify(). The integrator's backend never
 * receives the document image, the selfie images, or any extracted
 * PII; only the final proof + public signals leave this function.
 */
export async function generateKycProof(options: GenerateProofOptions): Promise<KycProofResult> {
  options.onProgress?.("ocr");
  let ocrResult;
  try {
    ocrResult = await runOcr(options.idDocument);
  } catch (e) {
    if (e instanceof OCRError) {
      throw new KycRejectedError(e.message, "ocr_failed");
    }
    throw e;
  }

  options.onProgress?.("liveness");
  const images = await Promise.all(
    options.selfies.map((blob) => createImageBitmapAsImage(blob))
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
    if (e instanceof WitnessBuildError) {
      throw new KycRejectedError(e.message, "predicate_failed");
    }
    throw e;
  }

  const proof = await generateProof(witness, options.proverAssets, {
    onProgress: (stage) => options.onProgress?.(stage),
  });

  return proof;
}

async function createImageBitmapAsImage(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  return canvas;
}
