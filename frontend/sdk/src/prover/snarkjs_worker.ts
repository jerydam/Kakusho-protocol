// prover/snarkjs_worker.ts — Groth16 proof generation in a Web Worker.
// Spawned by prover/index.ts. Never imported directly by application code.
// Requires snarkjs peer dependency.

import * as snarkjs from "snarkjs";
import type { KycWitness } from "../types";

export interface ProveRequest {
  type: "prove";
  witness: KycWitness;
  wasmUrl: string;
  zkeyUrl: string;
}

export interface ProveProgress {
  type: "progress";
  stage: "fetching_wasm" | "fetching_zkey" | "computing_witness" | "generating_proof" | "done";
}

export interface ProveSuccess {
  type: "success";
  proof: {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
  };
  publicSignals: string[];
}

export interface ProveFailure {
  type: "error";
  message: string;
}

type WorkerOutgoingMessage = ProveProgress | ProveSuccess | ProveFailure;

function post(msg: WorkerOutgoingMessage) {
  self.postMessage(msg);
}

async function fetchAsArrayBuffer(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function handleProve(req: ProveRequest) {
  try {
    post({ type: "progress", stage: "fetching_wasm" });
    const wasm = await fetchAsArrayBuffer(req.wasmUrl);

    post({ type: "progress", stage: "fetching_zkey" });
    const zkey = await fetchAsArrayBuffer(req.zkeyUrl);

    post({ type: "progress", stage: "computing_witness" });
    post({ type: "progress", stage: "generating_proof" });

    const witnessInput = {
      current_timestamp: req.witness.current_timestamp,
      min_age_seconds: req.witness.min_age_seconds,
      restricted_root: req.witness.restricted_root,
      doc_max_age_seconds: req.witness.doc_max_age_seconds,
      integrator_id: req.witness.integrator_id,
      dob_timestamp: req.witness.dob_timestamp,
      nationality_code: req.witness.nationality_code,
      doc_id: req.witness.doc_id,
      doc_issue_timestamp: req.witness.doc_issue_timestamp,
      user_secret: req.witness.user_secret,
      bracket_low: req.witness.bracket_low,
      bracket_high: req.witness.bracket_high,
      path_elements: req.witness.path_elements,
      path_indices: req.witness.path_indices,
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(witnessInput, wasm, zkey);

    post({ type: "progress", stage: "done" });
    post({
      type: "success",
      proof: { pi_a: proof.pi_a, pi_b: proof.pi_b, pi_c: proof.pi_c },
      publicSignals,
    });
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
}

self.onmessage = (event: MessageEvent<ProveRequest>) => {
  if (event.data?.type === "prove") handleProve(event.data);
};