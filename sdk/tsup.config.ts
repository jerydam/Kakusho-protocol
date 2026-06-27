import { defineConfig } from "tsup";

export default defineConfig([
  // Main SDK build — all entries except the worker
  {
    entry: {
      "index": "src/index.ts",
      "nfc": "src/nfc/index.ts",
      "session": "src/session/index.ts",
      "session-react": "src/session/react.tsx",
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
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