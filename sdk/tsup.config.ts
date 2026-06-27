import { defineConfig } from "tsup";

export default defineConfig([
  // Main SDK build — all entries except the worker
  // Worker build
  {
    entry: {
      "kakusho-prover-worker": "src/prover/snarkjs_worker.ts",
    },
    format: ["iife"],
    globalName: "KakushoProverWorker",  // prevents the .global.js suffix
    platform: "browser",
    bundle: true,
    dts: false,
    sourcemap: true,
    clean: false,
    splitting: false,
  },
  // Worker build — separate, IIFE, fully self-contained
  {
    entry: {
      "kakusho-prover-worker": "src/prover/snarkjs_worker.ts",
    },
    format: ["iife"],   // no import/export in output
    platform: "browser",
    bundle: true,       // inline snarkjs so the worker is self-contained
    dts: false,         // workers don't need types
    sourcemap: true,
    clean: false,       // don't wipe the main build output
    splitting: false,
  },
]);