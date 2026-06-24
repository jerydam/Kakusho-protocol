#!/usr/bin/env node
// build_restricted_tree.js — builds the sorted-pair non-membership
// Merkle tree for a restricted-country list, per the scheme documented
// in kyc_ocr.circom. Each integrator runs this themselves (or you run
// it as a hosted convenience service) since different integrators ban
// different country sets — there's no protocol-wide "restricted list."
//
// Usage:
//   node build_restricted_tree.js restricted_codes.json output_tree.json
//
// restricted_codes.json is just an array of ISO 3166-1 numeric codes,
// e.g. [408, 364, 760, 192] for North Korea, Iran, Syria, Cuba.
//
// Output shape matches what witness_builder.ts's findBracketForCode
// expects: { root, pairs: [{ low, high, pathElements, pathIndices }] }

const fs = require("fs");
const { buildPoseidon } = require("circomlibjs");

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    console.error("Usage: node build_restricted_tree.js <restricted_codes.json> <output_tree.json>");
    process.exit(1);
  }

  const restrictedCodes = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (!Array.isArray(restrictedCodes) || restrictedCodes.length === 0) {
    console.error("Input must be a non-empty JSON array of numeric country codes.");
    process.exit(1);
  }

  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  // Sentinel values bracket the list so codes below the smallest /
  // above the largest restricted entry still verify against an open
  // bracket — see kyc_ocr.circom's header note on this scheme.
  const sorted = [0, ...Array.from(new Set(restrictedCodes)).sort((a, b) => a - b), 999999999];

  // Build adjacent pairs: (sorted[0], sorted[1]), (sorted[1], sorted[2]), ...
  const pairs = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    pairs.push({ low: sorted[i], high: sorted[i + 1] });
  }

  const levels = Math.max(8, Math.ceil(Math.log2(pairs.length || 1)));
  if (levels > 8) {
    console.warn(
      `Warning: ${pairs.length} pairs need ${levels} tree levels, but kyc_ocr.circom is ` +
        `compiled with MerkleMembership(8) (max 256 pairs). Either reduce your restricted ` +
        `list or recompile the circuit with a larger fixed level count for ALL integrators ` +
        `(see kyc_ocr.circom's comment on this being a protocol-wide constant).`
    );
  }

  const leaves = pairs.map((p) => poseidon([p.low, p.high]));

  // Pad to a power of 2 with repeated last leaf (or zero leaves) so the
  // tree is regular — using zero-leaves repeated, since an unused slot
  // should never accidentally match a real bracket query.
  const treeSize = 2 ** 8; // matches circuit's hardcoded levels=8
  const paddedLeaves = leaves.slice();
  while (paddedLeaves.length < treeSize) {
    paddedLeaves.push(F.e(0));
  }

  // Build the tree bottom-up, recording each leaf's path.
  let currentLevel = paddedLeaves;
  const levelsArr = [currentLevel];
  while (currentLevel.length > 1) {
    const next = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      next.push(poseidon([currentLevel[i], currentLevel[i + 1]]));
    }
    levelsArr.push(next);
    currentLevel = next;
  }
  const root = currentLevel[0];

  function pathFor(leafIndex) {
    const pathElements = [];
    const pathIndices = [];
    let idx = leafIndex;
    for (let lvl = 0; lvl < levelsArr.length - 1; lvl++) {
      const isRight = idx % 2 === 1;
      const siblingIdx = isRight ? idx - 1 : idx + 1;
      pathElements.push(F.toObject(levelsArr[lvl][siblingIdx]).toString());
      pathIndices.push(isRight ? 1 : 0);
      idx = Math.floor(idx / 2);
    }
    return { pathElements, pathIndices };
  }

  const output = {
    root: F.toObject(root).toString(),
    pairs: pairs.map((p, i) => {
      const { pathElements, pathIndices } = pathFor(i);
      return { low: p.low, high: p.high, pathElements, pathIndices };
    }),
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Wrote ${output.pairs.length} pairs, root=${output.root}, to ${outputPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
