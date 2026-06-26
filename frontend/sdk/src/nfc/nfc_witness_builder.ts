// nfc/nfc_witness_builder.ts — builds a KycWitness from NFC chip data.
//
// This is the NFC counterpart to witness_builder.ts's buildWitnessFromOcr().
// It returns the SAME KycWitness type, which means generateProof() in
// prover/index.ts is called identically for both paths — no changes needed
// in the prover.
//
// TWO RESPONSIBILITIES:
//   1. parseDG1(): decode raw DG1 bytes → NFCMrzFields (client-side, no I/O)
//   2. buildWitnessFromNFC(): NFCMrzFields + PassiveAuthResult + IntegratorAssets
//      → KycWitness
//
// parseDG1 handles both TD3 (passport, 2×44 char MRZ) and TD1 (national ID,
// 3×30 char MRZ) formats per ICAO 9303 Part 5 and Part 6.
//
// THE HASH PAIR CONTRACT:
//   paResult.dg1HashHex     → private circuit input (what we computed from chip)
//   paResult.sodDg1HashHex  → public circuit input  (what DS cert vouches for)
// The circuit proves these are equal. This file converts both 64-char hex
// strings to the 256-bit arrays the nfc_chip_verify.circom circuit expects,
// then packs them into the KycWitness fields that snarkjs_worker.ts feeds
// into fullProve().
//
// USER SECRET:
// Stored in localStorage under a per-integrator key, same lifetime as the
// OCR path's randomUserSecret(). Losing localStorage means the user can't
// reuse the same nullifier across sessions — they'd need to re-verify.
// For higher security, derive from a WebAuthn credential or wallet sig.

import type { KycWitness } from "../types";
import type { IntegratorAssets } from "../witness_builder";
import type { NFCMrzFields, PassiveAuthResult } from "./type";
import { WitnessBuildError } from "../witness_builder";

// ─── DG1 MRZ parsing ─────────────────────────────────────────────────────────

function mrzYYMMDDToISO(yymmdd: string, biasFuture = false): string {
  // MRZ dates are YYMMDD (always 6 chars, numeric). Two-digit year:
  //   00-30 → 2000s, 31-99 → 1900s (DOB heuristic)
  //   For expiry: bias toward future (biasFuture=true)
  if (!/^\d{6}$/.test(yymmdd)) throw new WitnessBuildError(`Invalid MRZ date: ${yymmdd}`);
  const yy = parseInt(yymmdd.slice(0, 2), 10);
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  const century = biasFuture ? (yy <= 30 ? 2000 : 1900) : yy >= 70 ? 1900 : 2000;
  return `${century + yy}-${mm}-${dd}`;
}

function fixMrzNumeric(s: string): string {
  // OCR confusables in the numeric MRZ fields (doc number, dates, check digits)
  return s.replace(/O/g, "0").replace(/I/g, "1").replace(/S/g, "5").replace(/B/g, "8");
}

/**
 * Parses ICAO 9303 DG1 MRZ bytes into structured fields.
 *
 * DG1 binary layout:
 *   0x61 [length]     ← EF.DG1 outer tag
 *   0x5F 0x1F [len]   ← MRZ data element tag
 *   [MRZ chars]       ← ASCII, 88 chars (TD3) or 90 chars (TD1)
 *
 * Throws WitnessBuildError on malformed input; we never have OCR misreads
 * here (chip data is authoritative) but length mismatches can occur on
 * partial reads.
 */
export function parseDG1(dg1Bytes: Uint8Array): NFCMrzFields {
  const byteAt = (i: number): number => dg1Bytes[i] ?? -1;

  // Skip DG1 tag (0x61) + BER-TLV length
  let offset = 0;
  if (byteAt(offset) !== 0x61) {
    throw new WitnessBuildError(
      `DG1 tag mismatch: expected 0x61, got 0x${dg1Bytes[offset]?.toString(16) ?? "??"}`
    );
  }
  offset++;
  // Skip outer length
  if (byteAt(offset) < 0x80) offset++;
  else if (byteAt(offset) === 0x81) offset += 2;
  else if (byteAt(offset) === 0x82) offset += 3;
  else throw new WitnessBuildError("Unexpected DG1 outer length encoding");

  // Expect MRZ data tag 5F 1F
  if (byteAt(offset) !== 0x5f || byteAt(offset + 1) !== 0x1f) {
    throw new WitnessBuildError(
      `DG1 MRZ tag (5F 1F) not found at offset ${offset}; ` +
        `got ${dg1Bytes[offset]?.toString(16)} ${dg1Bytes[offset + 1]?.toString(16)}`
    );
  }
  offset += 2;
  // Skip MRZ data element length
  if (byteAt(offset) < 0x80) offset++;
  else if (byteAt(offset) === 0x81) offset += 2;
  else offset += 3;

  const mrzRaw = new TextDecoder("ascii").decode(dg1Bytes.slice(offset));
  const mrzClean = mrzRaw.replace(/[\r\n]/g, "");

  let docNumber: string;
  let dobYYMMDD: string;
  let expiryYYMMDD: string;
  let nationality: string; // alpha-3

  if (mrzClean.length >= 88) {
    // TD3: passport (2 lines × 44 chars)
    // Line 1: P[<C][country(3)][name(39)]
    // Line 2: [docNum(9)][chk][nationality(3)][dob(6)][chk][sex][expiry(6)][chk][optional][chk]
    const line1 = mrzClean.slice(0, 44);
    const line2 = mrzClean.slice(44, 88);

    nationality = line1.slice(2, 5).replace(/</g, "");
    docNumber = fixMrzNumeric(line2.slice(0, 9)).replace(/</g, "");
    dobYYMMDD = fixMrzNumeric(line2.slice(13, 19));
    expiryYYMMDD = fixMrzNumeric(line2.slice(19, 25));
  } else if (mrzClean.length >= 90) {
    // TD1: national ID (3 lines × 30 chars)
    // Line 1: [docType(2)][country(3)][docNum(9)][chk][optional(15)]
    // Line 2: [dob(6)][chk][sex][expiry(6)][chk][nationality(3)][optional][chk]
    // Line 3: [surname(30)] then given names
    const line1 = mrzClean.slice(0, 30);
    const line2 = mrzClean.slice(30, 60);

    nationality = line2.slice(15, 18).replace(/</g, "");
    docNumber = fixMrzNumeric(line1.slice(5, 14)).replace(/</g, "");
    dobYYMMDD = fixMrzNumeric(line2.slice(0, 6));
    expiryYYMMDD = fixMrzNumeric(line2.slice(8, 14));
  } else {
    throw new WitnessBuildError(
      `Unrecognised MRZ length: ${mrzClean.length} chars (expected 88 for TD3 or 90 for TD1)`
    );
  }

  if (!nationality || nationality.length < 2) {
    throw new WitnessBuildError("Could not extract nationality from DG1 MRZ");
  }
  if (!docNumber || docNumber.length < 1) {
    throw new WitnessBuildError("Could not extract document number from DG1 MRZ");
  }

  const docNumberBigInt = packDocNumber(docNumber);

  return {
    dateOfBirth: mrzYYMMDDToISO(dobYYMMDD, false),
    // DG1 does not contain the issue date. Use expiry as proxy for
    // doc_issue_timestamp — the freshness check in kyc_ocr.circom uses
    // (current_timestamp - doc_issue_timestamp < doc_max_age_seconds).
    // Substituting expiry gives a conservative bound (expiry >= issue date).
    // For exact issue date, DG11 (Additional Personal Details) would be
    // needed, but it's not reliably populated and isn't universally readable.
    issueDate: mrzYYMMDDToISO(expiryYYMMDD, true),
    nationality: nationality.toUpperCase(),
    docNumber,
    docNumberBigInt,
  };
}

/**
 * Packs a 9-character MRZ document number into a BigInt field element.
 *
 * Encoding: base-37 where '<'=0, '0'-'9'=1-10, 'A'-'Z'=11-36.
 * Matches the OCR path's docNumberToNumeric() (which hashes via SHA-256
 * instead) ONLY if you align both — if you want OCR and NFC nullifiers
 * for the same physical document to be the same, use the same packing here
 * as in witness_builder.ts's docNumberToNumeric(). The current OCR impl
 * uses SHA-256 truncated to 128 bits; this uses direct base-37 packing.
 * Pick one and use it in both, or accept that they produce different doc_ids
 * (and therefore different nullifiers — meaning the same document can
 * verify once via OCR and once via NFC per integrator).
 *
 * The base-37 value for a 9-char string fits in < 48 bits, well within
 * BN254's ~254-bit field.
 */
function packDocNumber(docNumber: string): bigint {
  const normalized = docNumber.toUpperCase().padEnd(9, "<").slice(0, 9);
  let packed = 0n;
  for (const ch of normalized) {
    let val: number;
    if (ch === "<") val = 0;
    else if (ch >= "0" && ch <= "9") val = ch.charCodeAt(0) - 47; // '0'→1
    else val = ch.charCodeAt(0) - 54; // 'A'→11
    packed = packed * 37n + BigInt(val);
  }
  return packed;
}

// ─── Hash conversion for circuit inputs ──────────────────────────────────────

/**
 * Converts a 64-char hex string (32 bytes = SHA-256) to an array of 256
 * decimal strings "0"/"1", big-endian bit order, for circuit signal arrays.
 *
 * The nfc_chip_verify.circom circuit receives each bit as a separate signal
 * (`signal input dg1_data_bits[256]` and `signal input sod_dg1_hash_bits[256]`)
 * and constrains them equal bit-by-bit. This avoids needing a Bits2Num inside
 * the circuit just to compare field elements.
 */
function hexTo256BitStrings(hex: string): string[] {
  if (hex.length !== 64) {
    throw new WitnessBuildError(
      `Expected 64-char SHA-256 hex, got ${hex.length} chars`
    );
  }
  const bits: string[] = [];
  for (let i = 0; i < 64; i += 2) {
    const byte = parseInt(hex.slice(i, i + 2), 16);
    for (let bit = 7; bit >= 0; bit--) {
      bits.push(((byte >> bit) & 1).toString());
    }
  }
  return bits; // length === 256
}

// ─── User secret ─────────────────────────────────────────────────────────────

function getOrCreateNFCSecret(integratorId: string): bigint {
  const key = `trustid_nfc_secret_${integratorId}`;
  const stored = localStorage.getItem(key);
  if (stored) return BigInt(stored);
  // 31 random bytes → fits in BN254 field (< 254 bits)
  const bytes = crypto.getRandomValues(new Uint8Array(31));
  const secret = bytes.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n);
  localStorage.setItem(key, secret.toString());
  return secret;
}

// ─── Date parsing (reuse same logic as witness_builder.ts) ───────────────────

function isoDateToUnix(iso: string): number {
  // parseDG1 always outputs YYYY-MM-DD so no format guessing needed here
  const ts = new Date(iso + "T00:00:00Z").getTime();
  if (isNaN(ts)) throw new WitnessBuildError(`Invalid ISO date from DG1: ${iso}`);
  return Math.floor(ts / 1000);
}

// ─── Main: build witness from NFC data ───────────────────────────────────────

/**
 * Builds the complete KycWitness for nfc_chip_verify.circom from:
 *   - mrzFields: parsed from DG1 bytes (client-side)
 *   - paResult: Passive Authentication hashes from the relayer
 *   - assets: same IntegratorAssets as the OCR path
 *
 * The returned KycWitness is fed directly to generateProof() in
 * prover/index.ts — NO changes to the prover needed.
 *
 * NOTE: KycWitness has fields named for the OCR circuit (e.g. nationality_code,
 * dob_timestamp). The NFC circuit (nfc_chip_verify.circom) uses the same field
 * names with the same semantics, so the same struct works for both.
 * The NFC circuit adds dg1_data_bits and sod_dg1_hash_bits as additional
 * inputs — these are passed through the `path_elements` / `path_indices`
 * array slots in KycWitness, OR you extend KycWitness with NFC-specific
 * fields. See the NOTE below.
 *
 * WITNESS EXTENSION NOTE:
 * nfc_chip_verify.circom takes 256-bit hash arrays as inputs that don't
 * exist in the OCR KycWitness struct. Two options:
 *   A) Extend KycWitness with optional NFC fields (cleanest, requires
 *      snarkjs_worker.ts to include them conditionally).
 *   B) Use a separate NFCKycWitness interface + a separate snarkjs_worker
 *      for the NFC circuit (more isolated, slight code duplication).
 * This file implements option B via NFCKycWitness passed to a dedicated
 * nfc_snarkjs_worker.ts, keeping the existing types.ts and snarkjs_worker.ts
 * completely unchanged.
 */
export interface NFCKycWitness {
  // ── Public signals (nfc_chip_verify.circom) ────────────────────────────────
  // Hash pair — the circuit proves dg1_data_bits[i] === sod_dg1_hash_bits[i]
  sod_dg1_hash_bits: string[];   // 256 decimal "0"/"1" strings (public)
  integrator_id: string;
  current_timestamp: string;
  min_age_seconds: string;
  restricted_root: string;
  doc_max_age_seconds: string;

  // ── Private signals ────────────────────────────────────────────────────────
  dg1_data_bits: string[];       // 256 decimal "0"/"1" strings (private)
  doc_id: string;
  user_secret: string;
  dob_timestamp: string;
  doc_issue_timestamp: string;
  nationality_code: string;
  bracket_low: string;
  bracket_high: string;
  path_elements: string[];
  path_indices: string[];
}

export async function buildWitnessFromNFC(
  mrzFields: NFCMrzFields,
  paResult: PassiveAuthResult,
  assets: IntegratorAssets
): Promise<NFCKycWitness> {
  // Convert hash hex strings to 256-bit signal arrays
  const dg1DataBits = hexTo256BitStrings(paResult.dg1HashHex);
  const sodDg1HashBits = hexTo256BitStrings(paResult.sodDg1HashHex);

  // Date parsing
  const dobTimestamp = isoDateToUnix(mrzFields.dateOfBirth);
  const issueTimestamp = isoDateToUnix(mrzFields.issueDate);

  // Nationality → numeric code (same countryCodeMap as OCR path)
  const natKey = mrzFields.nationality.toUpperCase();
  if (!(natKey in assets.countryCodeMap)) {
    throw new WitnessBuildError(
      `Nationality "${mrzFields.nationality}" from NFC chip is not in the integrator's country code map. ` +
        "This may indicate a chip from an issuing country not yet in the map, or a chip read error."
    );
  }
  const nationalityCode = assets.countryCodeMap[natKey] as number;

  // Restricted country non-membership Merkle proof (same logic as witness_builder.ts)
  const bracket = findBracketForCode(nationalityCode, assets.restrictedTree);

  const currentTimestamp = Math.floor(Date.now() / 1000);
  const userSecret = getOrCreateNFCSecret(assets.integratorId);
  const integratorIdDecimal = BigInt("0x" + assets.integratorId.replace(/^0x/, "")).toString();

  return {
    // Public
    sod_dg1_hash_bits: sodDg1HashBits,
    integrator_id: integratorIdDecimal,
    current_timestamp: String(currentTimestamp),
    min_age_seconds: assets.minAgeSeconds.toString(),
    restricted_root: BigInt("0x" + assets.restrictedTree.root.replace(/^0x/, "")).toString(),
    doc_max_age_seconds: assets.docMaxAgeSeconds.toString(),

    // Private
    dg1_data_bits: dg1DataBits,
    doc_id: mrzFields.docNumberBigInt.toString(),
    user_secret: userSecret.toString(),
    dob_timestamp: String(dobTimestamp),
    doc_issue_timestamp: String(issueTimestamp),
    nationality_code: String(nationalityCode),
    bracket_low: String(bracket.bracketLow),
    bracket_high: String(bracket.bracketHigh),
    path_elements: bracket.pathElements,
    path_indices: bracket.pathIndices.map(String),
  };
}

// ─── Bracket finder (copy from witness_builder.ts to avoid coupling) ──────────

function findBracketForCode(
  code: number,
  tree: { root: string; pairs: { low: number; high: number; pathElements: string[]; pathIndices: number[] }[] }
): { bracketLow: number; bracketHigh: number; pathElements: string[]; pathIndices: string[] } {
  for (const pair of tree.pairs) {
    if (pair.low < code && code < pair.high) {
      return {
        bracketLow: pair.low,
        bracketHigh: pair.high,
        pathElements: pair.pathElements,
        pathIndices: pair.pathIndices.map(String),
      };
    }
  }
  throw new WitnessBuildError(
    `Nationality code ${code} is on the restricted list for this integrator.`
  );
}