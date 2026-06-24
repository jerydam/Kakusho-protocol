// witness_builder.ts — converts OcrResult + an integrator's restricted-
// country tree into the full private witness for kyc_ocr.circom. Direct
// port of backend/app/zk/witness_builder.py, with one structural
// change: instead of hardcoding COUNTRY_CODE_MAP and reading
// restricted_tree.json from local disk (server-side assumptions that
// don't apply in a browser), both are fetched from the integrator's
// config — see IntegratorAssets below. Different integrators may in
// principle use different restricted-country trees (a casino banning
// gambling-restricted jurisdictions vs. a DeFi protocol banning
// sanctioned countries), so these can't be protocol-wide constants.

import type { KycWitness, RestrictedTreeBracket } from "../types";

export class WitnessBuildError extends Error {}

const DATE_FORMATS_HINT =
  "Expected ISO (YYYY-MM-DD), DD/MM/YYYY, DD-MM-YYYY, or 'DD Mon YYYY'.";

function parseDateToUnix(dateStr: string | null): number {
  if (!dateStr) throw new WitnessBuildError("Missing date field from OCR");

  const trimmed = dateStr.trim();

  // ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return Math.floor(new Date(trimmed + "T00:00:00Z").getTime() / 1000);
  }
  // DD/MM/YYYY or DD-MM-YYYY
  let m = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = (parseInt(y, 10) > 30 ? "19" : "20") + y;
    return Math.floor(new Date(`${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T00:00:00Z`).getTime() / 1000);
  }
  // "DD Mon YYYY" or "DD Month YYYY"
  m = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{2,4})$/);
  if (m) {
    const [, d, monthName, y] = m;
    const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const idx = months.findIndex((mn) => monthName.toLowerCase().startsWith(mn));
    if (idx >= 0) {
      const year = y.length === 2 ? (parseInt(y, 10) > 30 ? "19" : "20") + y : y;
      return Math.floor(new Date(Date.UTC(parseInt(year, 10), idx, parseInt(d, 10))).getTime() / 1000);
    }
  }

  throw new WitnessBuildError(`Could not parse date: ${JSON.stringify(dateStr)}. ${DATE_FORMATS_HINT}`);
}

function nationalityToCode(
  nationalityText: string | null,
  countryCodeMap: Record<string, number>
): number {
  if (!nationalityText) throw new WitnessBuildError("Missing nationality field from OCR");
  const key = nationalityText.trim().toUpperCase();
  if (!(key in countryCodeMap)) {
    throw new WitnessBuildError(
      `Unrecognized nationality text from OCR: ${JSON.stringify(nationalityText)}. ` +
        `This integrator's country code map doesn't include it — contact the integrator ` +
        `or check for an OCR misread.`
    );
  }
  return countryCodeMap[key];
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function docNumberToNumeric(docNumber: string): Promise<bigint> {
  // Hashes the alphanumeric doc number down to a field-sized int — we
  // never need the literal doc number in-circuit, just a stable numeric
  // handle for the nullifier. Direct port of _doc_number_to_numeric.
  const hex = await sha256Hex(docNumber);
  return BigInt("0x" + hex.slice(0, 32));
}

function randomUserSecret(): bigint {
  // 128-bit random blinding factor, direct equivalent of
  // `int(uuid4().int >> 128)` in the Python version (which truncates a
  // UUID's 128 bits down further — here we just generate 128 random
  // bits directly via crypto.getRandomValues, which is the more
  // correct source of randomness for a value used as a privacy-critical
  // blinding factor anyway).
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let result = 0n;
  for (const b of bytes) result = (result << 8n) | BigInt(b);
  return result;
}

function findBracketForCode(
  nationalityCode: number,
  tree: { root: string; pairs: { low: number; high: number; pathElements: string[]; pathIndices: number[] }[] }
): RestrictedTreeBracket {
  for (const pair of tree.pairs) {
    if (pair.low < nationalityCode && nationalityCode < pair.high) {
      return {
        bracketLow: pair.low,
        bracketHigh: pair.high,
        pathElements: pair.pathElements,
        pathIndices: pair.pathIndices.map(String),
        restrictedRoot: tree.root,
      };
    }
  }
  // Exact match against a restricted entry (no open bracket contains it)
  // means this nationality is on the restricted list.
  throw new WitnessBuildError(
    `Nationality code ${nationalityCode} is on the restricted list for this integrator; ` +
      `cannot generate a passing KYC proof.`
  );
}

export interface IntegratorAssets {
  countryCodeMap: Record<string, number>;
  restrictedTree: {
    root: string;
    pairs: { low: number; high: number; pathElements: string[]; pathIndices: number[] }[];
  };
  minAgeSeconds: bigint;
  docMaxAgeSeconds: bigint;
  integratorId: string; // hex-encoded 32 bytes, used as a circuit field element
}

export interface OcrResultForWitness {
  dateOfBirth: string | null;
  issueDate: string | null;
  nationality: string | null;
  docNumber: string | null;
}

/** Builds the full kyc_ocr.circom witness from OCR output + an
 * integrator's assets. Throws WitnessBuildError with a user-facing
 * reason if any predicate can't be satisfied — callers should surface
 * this as "you don't qualify" / "document issue", not a generic error. */
export async function buildWitnessFromOcr(
  ocrResult: OcrResultForWitness,
  assets: IntegratorAssets
): Promise<KycWitness> {
  const dobTimestamp = parseDateToUnix(ocrResult.dateOfBirth);
  const issueTimestamp = parseDateToUnix(ocrResult.issueDate);
  const nationalityCode = nationalityToCode(ocrResult.nationality, assets.countryCodeMap);
  const docIdNumeric = await docNumberToNumeric(ocrResult.docNumber ?? "");

  const bracket = findBracketForCode(nationalityCode, assets.restrictedTree);

  const currentTimestamp = Math.floor(Date.now() / 1000);
  const userSecret = randomUserSecret();

  // integrator_id is supplied as a hex string representing a BytesN<32>
  // on the contract side; the circuit treats it as a field element, so
  // convert hex -> decimal string for the witness JSON snarkjs expects.
  const integratorIdDecimal = BigInt("0x" + assets.integratorId.replace(/^0x/, "")).toString();

  return {
    current_timestamp: String(currentTimestamp),
    min_age_seconds: assets.minAgeSeconds.toString(),
    restricted_root: BigInt("0x" + assets.restrictedTree.root.replace(/^0x/, "")).toString(),
    doc_max_age_seconds: assets.docMaxAgeSeconds.toString(),
    integrator_id: integratorIdDecimal,

    dob_timestamp: String(dobTimestamp),
    nationality_code: String(nationalityCode),
    doc_id: docIdNumeric.toString(),
    doc_issue_timestamp: String(issueTimestamp),
    user_secret: userSecret.toString(),

    bracket_low: String(bracket.bracketLow),
    bracket_high: String(bracket.bracketHigh),
    path_elements: bracket.pathElements,
    path_indices: bracket.pathIndices,
  };
}
