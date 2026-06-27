/**
 * submit.ts — convenience helper that converts a KycProofResult into the
 * exact JSON shape the Kakusho relayer backend expects and POSTs it.
 * Optional — integrators can format the payload themselves if they prefer.
 */

import type { KycProofResult } from './types';

export interface SubmitProofPayload {
  nullifier_hex: string;
  current_timestamp: number;
  proof_a_hex: string;
  proof_b_hex: string;
  proof_c_hex: string;
  public_signals_hex: string[];
  user_stellar_address?: string;
}

export interface SubmitProofResponse {
  submission_id: string;
  status: 'submitted' | 'confirmed' | 'rejected';
  tx_hash: string | null;
  message: string;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bigintToHex32(n: bigint): string {
  return n.toString(16).padStart(64, '0');
}

/**
 * Submits a KycProofResult to the Kakusho relayer backend.
 *
 * @param proof - The proof returned by generateKycProof()
 * @param relayerUrl - Base URL of your relayer, e.g. "https://relayer.your-org.com"
 * @param apiKey - Your integrator API key (zkkyc_...)
 * @param userStellarAddress - Optional: the user's Stellar address for sponsorship targeting
 */
export async function submitProof(
  proof: KycProofResult,
  relayerUrl: string,
  apiKey: string,
  userStellarAddress?: string,
): Promise<SubmitProofResponse> {
  const payload: SubmitProofPayload = {
    nullifier_hex: proof.nullifier,
    current_timestamp: Number(proof.publicSignals.currentTimestamp),
    proof_a_hex: toHex(proof.proofA),
    proof_b_hex: toHex(proof.proofB),
    proof_c_hex: toHex(proof.proofC),
    public_signals_hex: [
      bigintToHex32(proof.publicSignals.currentTimestamp),
      bigintToHex32(proof.publicSignals.minAgeSeconds),
      proof.publicSignals.restrictedRoot,
      bigintToHex32(proof.publicSignals.docMaxAgeSeconds),
      proof.publicSignals.integratorId,
    ],
    ...(userStellarAddress !== undefined ? { user_stellar_address: userStellarAddress } : {}),
  };

  const res = await fetch(`${relayerUrl}/proof/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Submission failed: ${res.status}`);
  }

  return res.json();
}