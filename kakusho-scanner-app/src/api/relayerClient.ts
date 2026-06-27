import axios from 'axios';
import { CONFIG } from '../config';
import type { NfcReadResult, VerificationSession } from '../types';

// Adjust paths and payload field names in this file to match your actual
// FastAPI relayer routes — these match the shape described for the
// existing OCR/NFC proof submission endpoint, but field names should be
// confirmed against your real Pydantic request models.

const client = axios.create({
  baseURL: CONFIG.RELAYER_BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

export interface SubmitNfcProofPayload {
  sessionId: string;
  integratorId: string;
  state: string;
  dg1: string;
  sod: string;
  faceImage?: string;
  passiveAuthVerified: boolean;
}

export interface SubmitNfcProofResponse {
  ok: boolean;
  message?: string;
}

export async function submitNfcProof(
  session: VerificationSession,
  result: NfcReadResult
): Promise<SubmitNfcProofResponse> {
  const payload: SubmitNfcProofPayload = {
    sessionId: session.sessionId,
    integratorId: session.integratorId,
    state: session.state,
    dg1: result.dg1Base64,
    sod: result.sodBase64,
    faceImage: result.faceImageBase64,
    passiveAuthVerified: result.passiveAuthVerified,
  };

  const { data } = await client.post<SubmitNfcProofResponse>(CONFIG.NFC_SUBMIT_PATH, payload);
  return data;
}

export interface SessionStatusResponse {
  status: 'pending' | 'completed' | 'failed';
}

export async function getSessionStatus(sessionId: string): Promise<SessionStatusResponse> {
  const { data } = await client.get<SessionStatusResponse>(
    `${CONFIG.SESSION_STATUS_PATH}/${sessionId}`
  );
  return data;
}

/**
 * Wraps axios errors into a message safe to show in the UI — avoids
 * leaking stack traces / raw response bodies to the end user while still
 * giving them something actionable.
 */
export function describeApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return 'Could not reach the verification server. Check your connection and try again.';
    }
    if (error.response.status >= 500) {
      return 'The verification server hit an error on its end. Please try again shortly.';
    }
    return (
      (error.response.data as { message?: string } | undefined)?.message ??
      'The verification request was rejected. Please re-scan the QR code from your desktop and try again.'
    );
  }
  return 'Something went wrong submitting your verification.';
}
