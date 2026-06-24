// witness_builder.ts — converts OcrResult + an integrator's restricted-country
// tree into the full private witness for kyc_ocr.circom.
// Direct port of backend/app/zk/witness_builder.py.

import type { KycWitness, RestrictedTreeBracket } from "./types";

export class WitnessBuildError extends Error {}

const DATE_FORMATS_HINT = "Expected ISO (YYYY-MM-DD), DD/MM/YYYY, DD-MM-YYYY, or 'DD Mon YYYY'.";

function parseDateToUnix(dateStr: string | null): number {
  if (!dateStr) throw new WitnessBuildError("Missing date field from OCR");
  const trimmed = dateStr.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return Math.floor(new Date(trimmed + "T00:00:00Z").getTime() / 1000);
  }

  let m = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = (parseInt(y, 10) > 30 ? "19" : "20") + y;
    return Math.floor(new Date(`${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T00:00:00Z`).getTime() / 1000);
  }

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

function nationalityToCode(nationalityText: string | null, countryCodeMap: Record<string, number>): number {
  if (!nationalityText) throw new WitnessBuildError("Missing nationality field from OCR");
  const key = nationalityText.trim().toUpperCase();
  if (!(key in countryCodeMap)) {
    throw new WitnessBuildError(
      `Unrecognized nationality: ${JSON.stringify(nationalityText)}. Not in country code map — check for OCR misread.`
    );
  }
  return countryCodeMap[key];
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function docNumberToNumeric(docNumber: string): Promise<bigint> {
  const hex = await sha256Hex(docNumber);
  return BigInt("0x" + hex.slice(0, 32));
}

function randomUserSecret(): bigint {
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
  throw new WitnessBuildError(
    `Nationality code ${nationalityCode} is on the restricted list for this integrator.`
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
  integratorId: string;
}

export interface OcrResultForWitness {
  dateOfBirth: string | null;
  issueDate: string | null;
  nationality: string | null;
  docNumber: string | null;
}

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