// session/types.ts — types for the QR-based desktop↔mobile handoff flow.
//
// This is the layer ABOVE generateKycProof()/generateNFCProof(). It does not
// replace them — the mobile page still calls those functions internally.
// This layer only solves "how does a desktop tab find out a phone finished."

export type SessionStatus = "pending" | "scanned" | "completed" | "failed" | "expired";

export interface KakushoSessionCreateResponse {
  sessionId: string;
  /** Absolute URL the QR code should encode, e.g. https://verify.kakusho.xyz/s/{sessionId} */
  verifyUrl: string;
  /** Unix seconds. Desktop should stop polling and show "expired" after this. */
  expiresAt: number;
}

export interface KakushoSessionStatusResponse {
  status: SessionStatus;
  /** Present only when status === "completed". */
  nullifier?: string;
  /** Present only when status === "completed". */
  txHash?: string;
  /** Present only when status === "failed". One of KycRejectedError's reason codes, or a relayer-side error. */
  failureReason?: string;
}

export interface KakushoWidgetOptions {
  /** Your relayer's base URL, e.g. "https://relayer.kakusho.xyz" */
  relayerUrl: string;
  /** Your integrator API key (zkkyc_...). NEVER ship your secret key to the browser — see security note below. */
  apiKey: string;
  /** Optional: forwarded to the mobile page so it can tag the proof to a specific end user. */
  userStellarAddress?: string;
  /** Called once when the QR is generated and ready to display. */
  onSessionCreated?: (session: KakushoSessionCreateResponse) => void;
  /** Called when the phone scans the QR and opens the mobile page (status -> "scanned"). */
  onScanned?: () => void;
  /** Terminal callback — fires exactly once, with the final true/false result. */
  onResult: (result: { verified: boolean; nullifier?: string; txHash?: string; failureReason?: string }) => void;
  /** How often to poll session status, in ms. Default 2000. */
  pollIntervalMs?: number;
}

/**
 * SECURITY NOTE — read before wiring this into a production frontend:
 *
 * The "api_key" used here should be a SCOPED, SESSION-CREATION-ONLY key, not
 * your full zkkyc_... secret. Your relayer's /sessions endpoint is the only
 * one this key needs to call from the browser. If your relayer does not yet
 * support scoped keys, proxy POST /sessions through your OWN backend instead
 * of calling the relayer directly from the browser, so the integrator's main
 * API key never ships to end-user devices. This mirrors how Stripe's
 * publishable vs secret key split works.
 */