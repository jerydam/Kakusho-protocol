// prover/index.ts — spawns snarkjs_worker.ts, feeds it a witness,
// converts snarkjs decimal-string G1/G2 points into uncompressed bytes
// matching Bn254G1Affine/Bn254G2Affine in the Soroban contract.

import type { KycWitness, KycProofResult, ProverAssetUrls } from "../types";
import type { ProveRequest } from "./snarkjs_worker";

export type ProvingStage =
  | "fetching_wasm"
  | "fetching_zkey"
  | "computing_witness"
  | "generating_proof"
  | "done";

export interface ProveOptions {
  onProgress?: (stage: ProvingStage) => void;
  /**
   * URL to the compiled snarkjs_worker script. Required override in most
   * real deployments — see note below.
   *
   * WHY THIS EXISTS: generateProof() is called from multiple package entry
   * points (the root "." export, "./session", etc.) which live at different
   * folder depths once bundled. A worker URL built from
   * `new URL("./snarkjs_worker.js", import.meta.url)` resolves relative to
   * WHICHEVER entry file happens to import this code, so the same relative
   * path is correct for one entry point and wrong for the others.
   *
   * Default: assumes the consuming app serves this package's dist/ folder
   * such that "prover/snarkjs_worker.js" is reachable next to wherever your
   * bundler emits this package's output (typical for Next.js/Vite when
   * importing from node_modules directly). If your bundler copies/renames
   * worker assets (common with webpack 5 Asset Modules, or if you re-export
   * this SDK through your own bundle), pass workerUrl explicitly:
   *
   *   generateProof(witness, assets, {
   *     workerUrl: new URL('@kakusho/zk-kyc-sdk/dist/prover/snarkjs_worker.js', import.meta.url)
   *   })
   */
  workerUrl?: string | URL;
}

function decimalToBytes32(decimal: string): Uint8Array {
  let n = BigInt(decimal);
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

// G1: x (32 bytes BE) || y (32 bytes BE) = 64 bytes
function g1ToUncompressedBytes(point: readonly [string, string, ...string[]]): Uint8Array {
  const x = decimalToBytes32(point[0]);
  const y = decimalToBytes32(point[1]);
  const out = new Uint8Array(64);
  out.set(x, 0);
  out.set(y, 32);
  return out;
}

// G2: x_c1 || x_c0 || y_c1 || y_c0 = 128 bytes
// Component order matches Bn254G2Affine::from_array in the Soroban contract.
function g2ToUncompressedBytes(point: readonly [readonly [string, string, ...string[]], readonly [string, string, ...string[]], ...unknown[]]): Uint8Array {
  const xC0 = decimalToBytes32(point[0][0]);
  const xC1 = decimalToBytes32(point[0][1]);
  const yC0 = decimalToBytes32(point[1][0]);
  const yC1 = decimalToBytes32(point[1][1]);
  const out = new Uint8Array(128);
  out.set(xC1, 0);
  out.set(xC0, 32);
  out.set(yC1, 64);
  out.set(yC0, 96);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateProof(
  witness: KycWitness,
  assets: ProverAssetUrls,
  options: ProveOptions = {}
): Promise<KycProofResult> {
  return new Promise((resolve, reject) => {
const workerUrl = options.workerUrl ?? new URL("./kakusho-prover-worker.js", import.meta.url);

const worker = new Worker(workerUrl, { type: "module" });

    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === "progress") {
        options.onProgress?.(msg.stage);
      } else if (msg.type === "success") {
        worker.terminate();
        const proofA = g1ToUncompressedBytes(msg.proof.pi_a as [string, string, ...string[]]);
        const proofB = g2ToUncompressedBytes(msg.proof.pi_b as [[string, string, ...string[]], [string, string, ...string[]], ...unknown[]]);
        const proofC = g1ToUncompressedBytes(msg.proof.pi_c as [string, string, ...string[]]);

        // public_signals order from kyc_ocr.circom:
        // [nullifier (output), current_timestamp, min_age_seconds,
        //  restricted_root, doc_max_age_seconds, integrator_id]
        const [nullifierStr, currentTimestampStr, minAgeStr, restrictedRootStr, docMaxAgeStr, integratorIdStr] =
          msg.publicSignals as [string, string, string, string, string, string];

        resolve({
          proofA,
          proofB,
          proofC,
          publicSignals: {
            currentTimestamp: BigInt(currentTimestampStr),
            minAgeSeconds: BigInt(minAgeStr),
            restrictedRoot: bytesToHex(decimalToBytes32(restrictedRootStr)),
            docMaxAgeSeconds: BigInt(docMaxAgeStr),
            integratorId: bytesToHex(decimalToBytes32(integratorIdStr)),
          },
          nullifier: bytesToHex(decimalToBytes32(nullifierStr)),
        });
      } else if (msg.type === "error") {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };

    worker.onerror = (err) => { worker.terminate(); reject(err); };

    const req: ProveRequest = {
      type: "prove",
      witness,
      wasmUrl: assets.wasmUrl,
      zkeyUrl: assets.zkeyUrl,
    };
    worker.postMessage(req);
  });
}