import { defineConfig } from "tsup";

export default defineConfig([
  // Main SDK build
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
  // Worker build — single entry, IIFE, self-contained
  {
    entry: {
      "kakusho-prover-worker": "src/prover/snarkjs_worker.ts",
    },
    format: ["iife"],
    platform: "browser",
    bundle: true,
    dts: false,
    sourcemap: false,
    clean: false,
    splitting: false,
    outExtension: () => ({ js: ".js" }),  // strips the .global suffix
  },
]);