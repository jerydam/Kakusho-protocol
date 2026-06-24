// extractors/ocr_worker.ts — browser-side document OCR via Tesseract.js.
// Ported from backend/app/kyc/ocr.py. Canvas-based preprocessing replaces
// OpenCV (no opencv.js dependency). MRZ parsing is a direct port.

import Tesseract from "tesseract.js";
import type { OcrResult } from "../types";

export class OCRError extends Error {
  constructor(message: string, public raw: string = "") {
    super(message);
    this.name = "OCRError";
  }
}

const DOC_TYPE = {
  PASSPORT: "passport",
  DRIVING: "driving_license",
  NATIONAL: "national_id",
  UNKNOWN: "unknown",
} as const;

const MIN_FIELDS: Record<string, number> = {
  [DOC_TYPE.PASSPORT]: 3,
  [DOC_TYPE.DRIVING]: 2,
  [DOC_TYPE.NATIONAL]: 2,
  [DOC_TYPE.UNKNOWN]: 2,
};

const NAME_SKIP = new Set([
  "FEDERAL", "REPUBLIC", "NIGERIA", "NIGERIAN", "PASSPORT", "PASSEPORT",
  "PASSAPORTE", "PASAPORTE", "ECONOMIC", "COMMUNITY", "AFRICAN", "STATES",
  "NATIONALITY", "NATIONALE", "NATIONALITE", "NATIONAL", "ECOWAS",
  "DRIVING", "LICENSE", "LICENCE", "DRIVER", "IDENTITY", "CARD",
]);

// ─── Image pre-processing ────────────────────────────────────────────────────

async function loadImageToCanvas(file: File | Blob): Promise<HTMLCanvasElement> {
  const img = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  return canvas;
}

function contrastStretchGrayscale(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }

  const sorted = Float32Array.from(gray).sort();
  const p2 = sorted[Math.floor(sorted.length * 0.02)];
  const p98 = sorted[Math.floor(sorted.length * 0.98)];
  const range = p98 - p2 || 1;

  for (let i = 0; i < gray.length; i++) {
    const v = Math.max(0, Math.min(255, ((gray[i] - p2) / range) * 255));
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function upscaleIfSmall(canvas: HTMLCanvasElement, minWidth = 1400): HTMLCanvasElement {
  if (canvas.width >= minWidth) return canvas;
  const scale = minWidth / canvas.width;
  const out = document.createElement("canvas");
  out.width = canvas.width * scale;
  out.height = canvas.height * scale;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

// ─── Document type detection ─────────────────────────────────────────────────

function detectDocType(text: string): string {
  const upper = text.toUpperCase();
  const passportSignals = ["PASSPORT","PASSEPORT","PASAPORTE","PASSAPORTO","P<NGA","P<GBR","P<USA","P<IND","P<ZAF","P<KEN","P<GHA","SURNAME","GIVEN NAMES","NATIONALITY"];
  const drivingSignals = ["DRIVING","DRIVER","LICENCE","LICENSE","PERMIS DE CONDUIRE","CONDUCIR","VEHICLE","CLASS","ENDORSEMENT"];
  const nationalSignals = ["NATIONAL ID","IDENTITY CARD","CARTE NATIONALE","NATIONAL IDENTITY","IDENTIFICATION","NIN","VOTER","RESIDENT"];
  const score = (signals: string[]) => signals.reduce((acc, s) => acc + (upper.includes(s) ? 1 : 0), 0);
  const scores: Record<string, number> = {
    [DOC_TYPE.PASSPORT]: score(passportSignals),
    [DOC_TYPE.DRIVING]: score(drivingSignals),
    [DOC_TYPE.NATIONAL]: score(nationalSignals),
  };
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best[1] === 0 ? DOC_TYPE.UNKNOWN : best[0];
}

// ─── Field extraction ────────────────────────────────────────────────────────

function extractName(text: string): string | null {
  const patterns = [
    /(?:Surname|SURNAME|Nom\b|Last\s*Name)[:\s/]+([A-Z][A-Za-z\-']+)/i,
    /(?:Given\s*Names?|GIVEN\s*NAMES?|First\s*Name|Pr[eé]noms?)[:\s/]+([A-Z][A-Za-z\s\-']+)/i,
    /(?:Full\s*Name|FULL\s*NAME)[:\s]+([A-Z][A-Za-z\s\-']+)/i,
    /(?:Name|NAME)[:\s]+([A-Z][A-Za-z\s\-']{3,})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const name = m[1].replace(/[\d|\\/].*$/, "").trim();
      if (!NAME_SKIP.has(name.toUpperCase()) && name.length > 2 && name.length < 80) return name;
    }
  }
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^[A-Z]{5,20}$/.test(line) && !NAME_SKIP.has(line) && !/^[AN]{4,}$/.test(line)) {
      if (i + 1 < lines.length) {
        const nxt = lines[i + 1];
        if (/^[A-Z]{2,}(?:\s[A-Z]{2,})+$/.test(nxt) && !NAME_SKIP.has(nxt)) return `${line} ${nxt}`;
      }
      return line;
    }
  }
  return null;
}

function extractDateOfBirth(text: string): string | null {
  const patterns = [
    /(?:Date\s*of\s*Birth|Date\s*de\s*Naissance|DOB|D\.O\.B)[:\s]*(\d{1,2}\s+[A-Z]{3}\s*[/|]\s*[A-Z]{3}\.?\s*\d{2,4})/i,
    /(?:Date\s*of\s*Birth|DOB|D\.O\.B|Born|Birth\s*Date)[:\s]*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
    /(?:Date\s*of\s*Birth|DOB)[:\s]*(\d{1,2}\s+\w{3}\s+\d{4})/i,
    /\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

function extractDocumentNumber(text: string): string | null {
  const patterns = [
    /(?:Passport\s*No|Passeport\s*N[o°]|Document\s*No|Licence\s*No|License\s*No|ID\s*No|Card\s*No|N[o°]\s*Passeport)[:\s.#]*([A-Z8]\d{7,9})\b/i,
    /\b([A-Z8]\d{8})\b/,
    /\b([A-Z]{1,3}\d{6,9})\b/,
    /\b(\d{9,12})\b/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      let val = m[1].trim().toUpperCase();
      if (val[0] === "8") val = "B" + val.slice(1);
      if (!/^(NGA|NIG|FED|REP)/.test(val)) return val;
    }
  }
  return null;
}

function extractExpiry(text: string): string | null {
  const patterns = [
    /(?:Date\s*of\s*Expiry|Date\s*d['']?[Ee]xpiration|Expiry|Expiration|Valid\s*Until|Expires?|Valid\s*To)[:\s]*(\d{1,2}\s+[A-Z]{3}\s*[/|]\s*[A-Z]{3}\.?\s*\d{2,4})/i,
    /(?:Date\s*of\s*Expiry|Expiry|Expiration|Valid\s*Until|Expires?)[:\s]*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
    /(?:Date\s*of\s*Expiry|Expiry|Valid\s*Until)[:\s]*(\d{1,2}\s+\w{3}\s+\d{4})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

function extractIssueDate(text: string): string | null {
  const patterns = [
    /(?:Date\s*of\s*Issue|Issue\s*Date|Issued|Date\s*Issued|Date\s*de\s*D[eé]livrance|D[eé]livr[eé]\s*le)[:\s]*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
    /(?:Date\s*of\s*Issue|Issue\s*Date|Issued)[:\s]*(\d{1,2}\s+\w{3}\s+\d{4})/i,
    /(?:Date\s*of\s*Issue|Issue\s*Date)[:\s]*(\d{1,2}\s+[A-Z]{3}\s*[/|]\s*[A-Z]{3}\.?\s*\d{2,4})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

function extractNationality(text: string): string | null {
  const m = text.match(/(?:Nationality|NATIONALITY|Nationalit[eé])[:\s/]+([A-Z][A-Za-z]+)/);
  if (m) {
    const val = m[1].trim();
    if (!["NATIONALITY", "NATIONALE", "NATIONALITE"].includes(val.toUpperCase())) return val;
  }
  return null;
}

// ─── MRZ parsing ─────────────────────────────────────────────────────────────

function fixNumeric(s: string): string {
  return s.replace(/O/g, "0").replace(/I/g, "1").replace(/S/g, "5").replace(/B/g, "8");
}

function fixNameOcr(s: string): string {
  return s.replace(/0/g, "O").replace(/1/g, "I").replace(/8/g, "B").replace(/5/g, "S");
}

function parseYYMMDD(raw6: string): string | null {
  const fixed = fixNumeric(raw6);
  if (!/^\d{6}/.test(fixed)) return null;
  const yy = parseInt(fixed.slice(0, 2), 10);
  const yyyy = yy > 30 ? 1900 + yy : 2000 + yy;
  return `${fixed.slice(4, 6)}/${fixed.slice(2, 4)}/${yyyy}`;
}

interface MrzFields {
  mrzNationality?: string;
  mrzSurname?: string;
  mrzGivenNames?: string;
  mrzDocNumber?: string;
  mrzDob?: string;
  mrzExpiry?: string;
}

function parseMrzLines(line1: string, line2: string): MrzFields {
  const result: MrzFields = {};
  try {
    if (line1.startsWith("P") && line1.length >= 5) {
      result.mrzNationality = line1.slice(2, 5).replace(/</g, "");
      const parts = line1.slice(5).split("<<");
      const surname = fixNameOcr(parts[0]).replace(/</g, " ").trim();
      if (surname) result.mrzSurname = surname;
      if (parts.length > 1) {
        const given = fixNameOcr(parts[1]).replace(/</g, " ").trim();
        if (given) result.mrzGivenNames = given;
      }
    }
  } catch { /* best-effort */ }
  try {
    if (line2 && line2.length >= 25) {
      let docRaw = fixNumeric(line2.slice(0, 9));
      if (docRaw[0] === "8") docRaw = "B" + docRaw.slice(1);
      result.mrzDocNumber = docRaw.replace(/</g, "");
      const dob = parseYYMMDD(line2.slice(13, 19));
      if (dob) result.mrzDob = dob;
      const exp = parseYYMMDD(line2.slice(19, 25));
      if (exp) result.mrzExpiry = exp;
    }
  } catch { /* best-effort */ }
  return result;
}

function extractMrzFields(text: string): MrzFields {
  let line1 = "";
  let line2 = "";
  for (const rawLine of text.split("\n")) {
    const cleaned = rawLine.toUpperCase().replace(/[^A-Z0-9<]/g, "");
    if (!line1 && cleaned.startsWith("P") && cleaned.length >= 30) line1 = cleaned;
    else if (!line2 && !cleaned.startsWith("P") && cleaned.length >= 30 && /^[A-Z0-9]{9}/.test(cleaned)) line2 = cleaned;
    if (line1 && line2) break;
  }
  if (!line1 || !line2) {
    const collapsed = text.toUpperCase().replace(/[^A-Z0-9<]/g, "");
    if (!line1) { const m = collapsed.match(/P[<C][A-Z]{3}[A-Z<]{20,43}/); line1 = m ? m[0] : ""; }
    if (!line2) { const m = collapsed.match(/[A-Z0-9]{9}[0-9][A-Z]{3}[0-9]{6}[0-9][MF<][0-9]{6}[0-9][A-Z0-9<]{14}[0-9]/); line2 = m ? m[0] : ""; }
  }
  return parseMrzLines(line1, line2);
}

// ─── Tesseract OCR ────────────────────────────────────────────────────────────

function scoreText(text: string): number {
  let score = 0;
  for (const line of text.split("\n")) {
    for (const t of line.trim().split(/\s+/)) {
      const alnum = (t.match(/[a-zA-Z0-9]/g) || []).length;
      if (alnum === 0) score -= 2;
      else if (t.length <= 3) score += alnum;
      else score += alnum * 2;
    }
  }
  const upper = text.toUpperCase();
  for (const kw of ["PASSPORT","LICENCE","LICENSE","NATIONAL ID","IDENTITY"]) if (upper.includes(kw)) score += 80;
  if (/P<[A-Z]{3}/.test(upper)) score += 200;
  if (/[A-Z0-9<]{20,}/.test(text.replace(/\s/g, "").toUpperCase())) score += 100;
  if (/[A-Z]\d{7,9}/.test(upper)) score += 150;
  for (const kw of ["SURNAME","GIVEN","DATE OF BIRTH","EXPIRY","NATIONALITY","NAME","DOB","ISSUED","ADDRESS"]) if (upper.includes(kw)) score += 40;
  return score;
}

async function extractRawText(canvas: HTMLCanvasElement): Promise<string> {
  const configs: Tesseract.PageSegMode[] = [
    Tesseract.PSM.AUTO,
    Tesseract.PSM.SINGLE_BLOCK,
    Tesseract.PSM.SPARSE_TEXT,
  ];
  let bestText = "";
  let bestScore = -9999;
  for (const psm of configs) {
    try {
      const { data } = await Tesseract.recognize(canvas, "eng", {
        // @ts-expect-error tesseract.js param typing
        tessedit_pageseg_mode: psm,
      });
      const score = scoreText(data.text);
      if (score > bestScore) { bestScore = score; bestText = data.text; }
    } catch { /* try next config */ }
  }
  return bestText;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runOcr(file: File | Blob): Promise<OcrResult> {
  let canvas = await loadImageToCanvas(file);
  canvas = upscaleIfSmall(canvas);
  canvas = contrastStretchGrayscale(canvas);
  const raw = await extractRawText(canvas);

  if (!raw.trim()) {
    throw new OCRError("No text could be extracted from this document. Please upload a clearer image.", "");
  }

  const docType = detectDocType(raw);
  const mrz = docType === DOC_TYPE.PASSPORT || docType === DOC_TYPE.UNKNOWN ? extractMrzFields(raw) : {};

  const name = mrz.mrzSurname ? `${mrz.mrzSurname} ${mrz.mrzGivenNames ?? ""}`.trim() : extractName(raw);
  const dob = extractDateOfBirth(raw) ?? mrz.mrzDob ?? null;
  const docNumber = extractDocumentNumber(raw) ?? mrz.mrzDocNumber ?? null;
  const expiry = extractExpiry(raw) ?? mrz.mrzExpiry ?? null;
  const issueDate = extractIssueDate(raw);
  const nationality = extractNationality(raw) ?? mrz.mrzNationality ?? null;

  const extracted = [name, dob, docNumber].filter(Boolean).length;
  const minRequired = MIN_FIELDS[docType] ?? 2;
  const confidence = Math.round(([name, dob, docNumber, expiry, nationality].filter(Boolean).length / 5) * 100) / 100;

  if (extracted < minRequired) {
    const missing: string[] = [];
    if (!name) missing.push("name");
    if (!docNumber) missing.push("document number");
    if (!dob) missing.push("date of birth");
    throw new OCRError(
      `Could not extract sufficient information (missing: ${missing.join(", ")}). ` +
        `Ensure the image is well-lit, in focus, and the document is fully visible.`,
      raw
    );
  }

  return { docType, name, dateOfBirth: dob, docNumber, expiry, issueDate, nationality, confidence };
}