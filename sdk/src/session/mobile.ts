// session/mobile.ts — runs ON THE PHONE, on the hosted page the QR points to
// (e.g. verify.kakusho.xyz/s/{sessionId}). This is the piece that ties the
// QR session layer to the EXISTING SDK functions — it does not reimplement
// OCR/liveness/proving, it just wraps generateKycProof()/generateNFCProof()
// with session lifecycle calls so the desktop widget knows when to stop
// polling.
//
// This file is intentionally framework-agnostic: the actual hosted page
// (built separately, e.g. as a small Next.js app deployed to
// verify.kakusho.xyz) imports these functions and wires them to its own UI.

import { generateKycProof, KycRejectedError, type GenerateProofOptions } from "../core/index";
import { generateNFCProof } from "../nfc/index";
import type { GenerateNFCProofOptions } from "../nfc/type";
import { submitProof } from "../submit";
import type { KycProofResult } from "../types";

export class KakushoMobileSessionError extends Error {
  constructor(message: string, public readonly code: "session_not_found" | "session_expired" | "session_already_used" | "relayer_error") {
    super(message);
    this.name = "KakushoMobileSessionError";
  }
}

export interface ResolvedSession {
  sessionId: string;
  relayerUrl: string;
  apiKey: string;
  /** The integrator's stored asset/proof config, fetched from the relayer using the session token — never embedded in the QR URL itself. */
  integratorAssets: GenerateProofOptions["integratorAssets"];
  proverAssets: GenerateProofOptions["proverAssets"];
  nfcProverAssets?: GenerateNFCProofOptions["nfcProverAssets"];
  userStellarAddress?: string;
}

/**
 * Step 1 on the mobile page: resolve the opaque session ID from the URL into
 * everything needed to run a proof. The relayer is the source of truth here —
 * the mobile page never trusts query params for anything beyond the session
 * ID itself, since those are visible in the QR code and could be tampered
 * with if passed directly.
 */
export async function resolveSession(relayerUrl: string, sessionId: string): Promise<ResolvedSession> {
  const res = await fetch(`${relayerUrl}/sessions/${sessionId}/resolve`);
  if (res.status === 404) {
    throw new KakushoMobileSessionError("This verification link is invalid.", "session_not_found");
  }
  if (res.status === 410) {
    throw new KakushoMobileSessionError("This verification link has expired. Please scan a new QR code.", "session_expired");
  }
  if (res.status === 409) {
    throw new KakushoMobileSessionError("This verification link has already been used.", "session_already_used");
  }
  if (!res.ok) {
    throw new KakushoMobileSessionError(`Could not load verification session: ${res.status}`, "relayer_error");
  }

  const body = (await res.json()) as {
    relayer_url: string;
    api_key: string;
    integrator_assets: GenerateProofOptions["integratorAssets"];
    prover_assets: GenerateProofOptions["proverAssets"];
    nfc_prover_assets?: GenerateNFCProofOptions["nfcProverAssets"];
    user_stellar_address?: string;
  };

  return {
    sessionId,
    relayerUrl: body.relayer_url,
    apiKey: body.api_key,
    integratorAssets: body.integrator_assets,
    proverAssets: body.prover_assets,
    ...(body.nfc_prover_assets !== undefined ? { nfcProverAssets: body.nfc_prover_assets } : {}),
    ...(body.user_stellar_address !== undefined ? { userStellarAddress: body.user_stellar_address } : {}),
  };
}

/** Tells the relayer a phone has opened this session, so the desktop widget can show "scanned". Best-effort — failures here don't block the verification flow. */
export async function markSessionScanned(relayerUrl: string, sessionId: string): Promise<void> {
  try {
    await fetch(`${relayerUrl}/sessions/${sessionId}/scanned`, { method: "POST" });
  } catch {
    // best-effort
  }
}

export interface RunOcrSessionOptions {
  idDocument: File | Blob;
  selfies: GenerateProofOptions["selfies"];
  onProgress?: GenerateProofOptions["onProgress"];
}

/**
 * Runs the OCR path end to end for a resolved session: existing
 * generateKycProof() + submitProof(), then reports completion (or failure)
 * back to the relayer so the desktop widget's poll resolves.
 */
export async function runOcrSessionFlow(
  session: ResolvedSession,
  options: RunOcrSessionOptions
): Promise<KycProofResult> {
  try {
    const proof = await generateKycProof({
      idDocument: options.idDocument,
      selfies: options.selfies,
      integratorAssets: session.integratorAssets,
      proverAssets: session.proverAssets,
      ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
    });

    await submitProof(proof, session.relayerUrl, session.apiKey, session.userStellarAddress);
    await reportSessionCompleted(session, proof);
    return proof;
  } catch (e) {
    const reason = e instanceof KycRejectedError ? e.reason : "relayer_error";
    await reportSessionFailed(session, reason);
    throw e;
  }
}

export interface RunNfcSessionOptions {
  onProgress?: GenerateNFCProofOptions["onProgress"];
  abortSignal?: AbortSignal;
}

/** Same as runOcrSessionFlow, for the NFC path. */
export async function runNfcSessionFlow(
  session: ResolvedSession,
  options: RunNfcSessionOptions = {}
): Promise<KycProofResult> {
  if (!session.nfcProverAssets) {
    throw new KakushoMobileSessionError(
      "This integrator has not configured NFC verification.",
      "relayer_error"
    );
  }

  try {
    const proof = await generateNFCProof(
      {
        relayerUrl: session.relayerUrl,
        apiKey: session.apiKey,
        integratorAssets: session.integratorAssets,
        nfcProverAssets: session.nfcProverAssets,
        ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
      },
      options.abortSignal
    );

    await submitProof(proof, session.relayerUrl, session.apiKey, session.userStellarAddress);
    await reportSessionCompleted(session, proof);
    return proof;
  } catch (e) {
    const reason = e instanceof Error ? e.name : "relayer_error";
    await reportSessionFailed(session, reason);
    throw e;
  }
}

async function reportSessionCompleted(session: ResolvedSession, proof: KycProofResult): Promise<void> {
  await fetch(`${session.relayerUrl}/sessions/${session.sessionId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nullifier: proof.nullifier }),
  });
}

async function reportSessionFailed(session: ResolvedSession, reason: string): Promise<void> {
  try {
    await fetch(`${session.relayerUrl}/sessions/${session.sessionId}/fail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
  } catch {
    // If even reporting failure fails (network down etc.), the session will
    // simply expire on the relayer side — desktop widget shows "expired"
    // rather than hanging forever.
  }
}