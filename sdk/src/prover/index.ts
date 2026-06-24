// prover.ts — main-thread entry point for proof generation. Spawns
// snarkjs_worker.ts, feeds it a witness, and converts the resulting
// proof (snarkjs's decimal-string G1/G2 point format) into the
// uncompressed byte arrays kyc_registry.verify() expects — matching
// the same Bn254G1Affine/Bn254G2Affine uncompressed encoding your
// Soroban contracts use.

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
}

/** Converts a decimal-string field element to a big-endian 32-byte
 * array — the encoding BN254 field elements use in Soroban's
 * uncompressed point format. */
function decimalToBytes32(decimal: string): Uint8Array {
  let n = BigInt(decimal);
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

/** snarkjs's G1 point is [x, y, "1"] (decimal strings); the
 * "uncompressed" Bn254G1Affine byte format used in your original
 * verifier.rs is just x (32 bytes, big-endian) || y (32 bytes,
 * big-endian) — BN254_G1_SERIALIZED_SIZE = 64 bytes. */
function g1ToUncompressedBytes(point: string[]): Uint8Array {
  const x = decimalToBytes32(point[0]);
  const y = decimalToBytes32(point[1]);
  const out = new Uint8Array(64);
  out.set(x, 0);
  out.set(y, 32);
  return out;
}

/** snarkjs's G2 point is [[x_c0, x_c1], [y_c0, y_c1], ["1","0"]]. The
 * uncompressed byte format is x_c1 || x_c0 || y_c1 || y_c0 (128 bytes
 * total) — component ORDER matters and varies between libraries; this
 * follows the same c1-then-c0 ordering your original VK_BETA/GAMMA/
 * DELTA constants were generated with via Bn254G2Affine::from_array.
 * VERIFY THIS against a known-good test vector (a proof you can verify
 * both via snarkjs locally AND via the deployed contract) before
 * trusting it in production — getting G2 component order wrong is a
 * classic, hard-to-detect bug since it fails the pairing check
 * silently rather than throwing. */
function g2ToUncompressedBytes(point: string[][]): Uint8Array {
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

/** Generates a Groth16 proof for the given witness, off the main
 * thread. Resolves with everything kyc_registry.verify() needs. */
export function generateProof(
  witness: KycWitness,
  assets: ProverAssetUrls,
  options: ProveOptions = {}
): Promise<KycProofResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./snarkjs_worker.ts", import.meta.url), {
      type: "module",
    });

    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === "progress") {
        options.onProgress?.(msg.stage);
      } else if (msg.type === "success") {
        worker.terminate();

        const proofA = g1ToUncompressedBytes(msg.proof.pi_a);
        const proofB = g2ToUncompressedBytes(msg.proof.pi_b);
        const proofC = g1ToUncompressedBytes(msg.proof.pi_c);

        // public_signals order from kyc_ocr.circom: [nullifier,
        // current_timestamp, min_age_seconds, restricted_root,
        // doc_max_age_seconds, integrator_id] — nullifier is signal
        // index 0 because it's declared as the circuit's `output`,
        // which circom places first in the public output ordering
        // ahead of the public `input` signals. CONFIRM this ordering
        // against the actual compiled circuit's symbol file
        // (kyc_ocr.sym) before relying on it — circom's exact ordering
        // of outputs vs. main{public[...]} inputs should be verified
        // empirically once trusted_setup.sh has run, not assumed from
        // this comment alone.
        const [nullifierStr, currentTimestampStr, minAgeStr, restrictedRootStr, docMaxAgeStr, integratorIdStr] =
          msg.publicSignals;

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

    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };

    const req: ProveRequest = {
      type: "prove",
      witness,
      wasmUrl: assets.wasmUrl,
      zkeyUrl: assets.zkeyUrl,
    };
    worker.postMessage(req);
  });
}
