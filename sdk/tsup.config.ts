import { defineConfig } from "tsup";

export default defineConfig({
  // Three entry points:
  //   "."                -> dist/index.{js,cjs,d.ts}            (package.json "." export)
  //   "./nfc"             -> dist/nfc/index.{js,cjs,d.ts}        (package.json "./nfc" export)
  //   prover/snarkjs_worker -> dist/prover/snarkjs_worker.js      (NOT in package.json exports —
  //     it is never imported by integrator code directly. It is spawned at runtime by
  //     prover/index.ts via `new Worker(new URL("./snarkjs_worker.js", import.meta.url))`.
  //     esbuild/tsup cannot follow that dynamic URL string the way Vite does, so without
  //     listing it here explicitly it gets silently dropped from the build output and
  //     generateProof()/generateNFCProof() would 404 at runtime trying to load the worker.
  entry: {
    "index": "src/index.ts",
    "nfc": "src/nfc/index.ts",
    "session": "src/session/index.ts",
    "session-react": "src/session/react.tsx",
    // Same depth (dist root) as every entry above — see the long comment on
    // ProveOptions.workerUrl in prover/index.ts for why depth must match.
    "kakusho-prover-worker": "src/prover/snarkjs_worker.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
});