// snarkjs_worker.ts — runs Groth16 proof generation via snarkjs inside
// a dedicated Web Worker, so the heavy WASM math (can take tens of
// seconds to a few minutes on lower-end phones) never blocks the main
// thread / UI. This file is the worker's own entry point — it gets
// instantiated via `new Worker(new URL("./snarkjs_worker.ts", ...))`
// from prover.ts, not imported directly by application code.
//
// Why a worker instead of just `await snarkjs.groth16.fullProve(...)`
// on the main thread: witness generation + proving for a circuit with
// a Merkle path (8 levels) and several comparator gadgets is enough
// constraints that running it synchronously-ish on the main thread
// will visibly freeze scrolling/animations/input on mobile Safari and
// older Android WebViews even though JS is technically async — the
// WASM computation itself is CPU-bound and doesn't yield control back
// to the event loop the way a network request would.

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
  // @ts-expect-error — `self` is the worker global scope at runtime
  self.postMessage(msg);
}

async function fetchAsArrayBuffer(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

async function handleProve(req: ProveRequest) {
  try {
    post({ type: "progress", stage: "fetching_wasm" });
    const wasm = await fetchAsArrayBuffer(req.wasmUrl);

    post({ type: "progress", stage: "fetching_zkey" });
    const zkey = await fetchAsArrayBuffer(req.zkeyUrl);

    post({ type: "progress", stage: "computing_witness" });
    // snarkjs.groth16.fullProve takes (input, wasmFile, zkeyFile) and
    // internally runs witness calculation + proving. Passing
    // already-fetched Uint8Arrays avoids a second network round trip
    // inside snarkjs itself.
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

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      witnessInput,
      wasm,
      zkey
    );

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

// @ts-expect-error — worker global scope
self.onmessage = (event: MessageEvent<ProveRequest>) => {
  if (event.data?.type === "prove") {
    handleProve(event.data);
  }
};
