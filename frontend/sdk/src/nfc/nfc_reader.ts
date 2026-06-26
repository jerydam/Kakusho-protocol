// nfc/nfc_reader.ts — reads DG1 + SOD from an ePassport or eID NFC chip.
//
// This is the hardware I/O layer of the NFC path, equivalent to the
// File | Blob input on the OCR path. It has one job: return raw DG1 and
// SOD bytes. Everything else (Passive Auth, witness building, proving)
// is downstream.
//
// BROWSER SUPPORT AS OF 2025:
//   Chrome Android 89+  → Web NFC NDEFReader available, BUT the low-level
//                          ISO 7816-4 APDU interface (needed for passport
//                          chips) is behind the "WebNFC ISO-DEP" origin
//                          trial (flag: #enable-web-nfc-make-read-only-option-default).
//                          For most real passports (which require BAC),
//                          this path works only for national IDs without BAC.
//   Desktop / iOS       → Web NFC not available. Integrators should fall
//                          back to OCR or use a native app wrapper.
//
// INTEGRATOR GUIDANCE:
//   Call supportsNFC() first. If false, tell the user to use OCR instead.
//   If supportsNFC() is true but readNFCChip() throws NFCReadError with
//   code "bac_required", the document needs BAC — display a message
//   directing the user to the native app or OCR fallback.
//
// WEB WORKER NOTE:
//   Unlike snarkjs_worker.ts, NFC reading cannot run in a Worker because
//   NDEFReader requires the main thread (DOM permission model). This file
//   is imported directly by core/nfc_index.ts, not via a worker.

import { NFCReadError, type NFCChipRead } from "./type";

// ICAO 9303 Elementary File identifiers
const FID_EF_DG1: readonly [number, number] = [0x01, 0x01]; // MRZ data
const FID_EF_SOD: readonly [number, number] = [0x01, 0x1d]; // Document Security Object

/**
 * Returns true if the browser exposes NDEFReader (Web NFC).
 * Does NOT guarantee the ISO-DEP APDU interface — use this to gate
 * the NFC UI from appearing at all on unsupported platforms.
 */
export function supportsNFC(): boolean {
  return typeof window !== "undefined" && "NDEFReader" in window;
}

// ─── ISO 7816-4 APDU helpers ─────────────────────────────────────────────────

function selectFileAPDU(fid: readonly [number, number]): Uint8Array {
  // SELECT FILE (by file identifier, no response data)
  return new Uint8Array([0x00, 0xa4, 0x02, 0x0c, 0x02, fid[0], fid[1]]);
}

function readBinaryAPDU(offset: number, length: number): Uint8Array {
  // READ BINARY: P1=high byte of offset, P2=low byte, Le=length
  return new Uint8Array([0x00, 0xb0, (offset >> 8) & 0xff, offset & 0xff, length]);
}

function sw(resp: Uint8Array): number {
  // Status word is the last two bytes of every response APDU
  return (((resp[resp.length - 2] ?? 0) << 8) | (resp[resp.length - 1] ?? 0)) >>> 0;
}

/**
 * Reads one Elementary File in full via SELECT FILE + READ BINARY loop.
 * Handles multi-chunk reads for files > 255 bytes (common for SOD: ~2-4 KB).
 *
 * @param transceive - ISO-DEP APDU exchange function from NDEFReader
 * @param fid - 2-byte file identifier
 * @throws NFCReadError on any APDU error
 */
async function readEF(
  transceive: (apdu: Uint8Array) => Promise<Uint8Array>,
  fid: readonly [number, number]
): Promise<Uint8Array> {
  // SELECT FILE
  const selResp = await transceive(selectFileAPDU(fid));
  const selSW = sw(selResp);
  if (selSW === 0x6982) {
    throw new NFCReadError(
      "This document requires Basic Access Control (BAC). " +
        "The Web NFC path supports national IDs without BAC. " +
        "Use the native app or OCR fallback for passports.",
      "bac_required"
    );
  }
  if (selSW !== 0x9000) {
    throw new NFCReadError(
      `SELECT FILE failed for FID ${fid[0].toString(16)}${fid[1].toString(16)}: SW=${selSW.toString(16)}`,
      "read_failed"
    );
  }

  // Read 8 bytes to parse TLV length
  const headerResp = await transceive(readBinaryAPDU(0, 8));
  if (sw(headerResp) !== 0x9000) {
    throw new NFCReadError("READ BINARY (header) failed", "read_failed");
  }
  const headerData = headerResp.slice(0, headerResp.length - 2);

  // Parse BER-TLV length from byte 1 of the DER-encoded EF
  // Byte 0: tag. Byte 1+: length encoding.
  let totalLength: number;
  let dataStart: number;
  const lenByte = headerData[1] ?? 0;
  if (lenByte < 0x80) {
    totalLength = lenByte;
    dataStart = 2;
  } else if (lenByte === 0x81) {
    totalLength = headerData[2] ?? 0;
    dataStart = 3;
  } else if (lenByte === 0x82) {
    totalLength = ((headerData[2] ?? 0) << 8) | (headerData[3] ?? 0);
    dataStart = 4;
  } else {
    throw new NFCReadError(`Unexpected TLV length byte: 0x${lenByte.toString(16)}`, "read_failed");
  }

  // Full file length = TLV header bytes + content bytes
  const fullLength = dataStart + totalLength;
  const chunks: Uint8Array[] = [];
  let offset = 0;

  while (offset < fullLength) {
    // Max READ BINARY Le is 255 (0xFF); some cards accept 256 (0x00) but
    // 255 is universally safe.
    const chunkSize = Math.min(255, fullLength - offset);
    const resp = await transceive(readBinaryAPDU(offset, chunkSize));
    if (sw(resp) !== 0x9000) {
      throw new NFCReadError(
        `READ BINARY failed at offset ${offset}: SW=${sw(resp).toString(16)}`,
        "read_failed"
      );
    }
    // Strip status word (last 2 bytes)
    chunks.push(resp.slice(0, resp.length - 2));
    offset += chunkSize;
  }

  // Concatenate all chunks
  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const result = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reads DG1 (MRZ) and SOD (Document Security Object) from an NFC chip.
 *
 * Resolves when both files have been read successfully.
 * Rejects with NFCReadError for any hardware, permission, or protocol failure.
 *
 * @param signal - AbortSignal to cancel the read (e.g. user hits Cancel)
 *
 * INTEGRATOR USAGE:
 * ```ts
 * import { supportsNFC, readNFCChip } from '@Kakusho/zk-kyc-sdk/nfc';
 *
 * if (!supportsNFC()) { showOCRFallback(); return; }
 *
 * const abort = new AbortController();
 * try {
 *   const chipRead = await readNFCChip(abort.signal);
 *   // chipRead.dg1Bytes + chipRead.sodBytes → pass to generateNFCProof()
 * } catch (e) {
 *   if (e instanceof NFCReadError && e.code === 'bac_required') {
 *     showNativeAppPrompt();
 *   }
 * }
 * ```
 */
export async function readNFCChip(signal?: AbortSignal): Promise<NFCChipRead> {
  if (!supportsNFC()) {
    throw new NFCReadError(
      "Web NFC is not available in this browser. Use Chrome on Android 89+.",
      "not_supported"
    );
  }

  return new Promise<NFCChipRead>((resolve, reject) => {
    // @ts-ignore — NDEFReader not yet in lib.dom.d.ts for all TS versions
    const reader = new NDEFReader();

    signal?.addEventListener("abort", () => {
      reject(new NFCReadError("NFC read cancelled", "read_failed"));
    });

    reader.scan({ signal }).catch((err: Error) => {
      if (err.name === "NotAllowedError") {
        reject(new NFCReadError("NFC permission denied", "permission_denied"));
      } else {
        reject(new NFCReadError(`NFC scan failed: ${err.message}`, "read_failed"));
      }
    });

    reader.addEventListener("readingerror", () => {
      reject(new NFCReadError("NFC read error — reposition the document and try again", "read_failed"));
    });

    reader.addEventListener("reading", async (event: any) => {
      // Check whether ISO-DEP transceive is available on this tag.
      // The transceive API is the "WebNFC ISO-DEP" origin trial feature.
      if (typeof reader.transceive !== "function") {
        // NDEFReader.scan() found a tag but it's a plain NDEF tag, not an
        // ISO 7816-4 passport chip, OR the browser doesn't expose transceive.
        // Direct the integrator to native app or USB relay.
        reject(
          new NFCReadError(
            "This browser supports basic NFC but not ISO 7816-4 APDU exchange. " +
              "For passport chip reading, use a native mobile app or USB PC/SC reader.",
            "bac_required" // Reuse bac_required code as "needs native" signal
          )
        );
        return;
      }

      try {
        const transceive = (apdu: Uint8Array): Promise<Uint8Array> =>
          reader.transceive(apdu, { signal });

        // Read DG1 first (smaller, ~100 bytes), then SOD (~2-4 KB)
        const [dg1Bytes, sodBytes] = await Promise.all([
          readEF(transceive, FID_EF_DG1),
          readEF(transceive, FID_EF_SOD),
        ]);

        resolve({ dg1Bytes, sodBytes });
      } catch (err) {
        if (err instanceof NFCReadError) {
          reject(err);
        } else if ((err as Error).name === "NotAllowedError") {
          reject(new NFCReadError("Lost connection to NFC tag — hold the document still", "tag_lost"));
        } else {
          reject(new NFCReadError(`Chip read failed: ${(err as Error).message}`, "read_failed"));
        }
      }
    });
  });
}