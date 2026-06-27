export interface VerificationSession {
  sessionId: string;
  integratorId: string;
  callbackUrl: string;
  state: string;
}

export interface BacKey {
  documentNo: string;
  birthDate: string; // YYYY-MM-DD
  expiryDate: string; // YYYY-MM-DD
}

export interface NfcReadResult {
  documentNo: string;
  firstName: string;
  lastName: string;
  nationality: string;
  dateOfBirth: string;
  dateOfExpiry: string;
  gender: string;
  issuingState: string;
  faceImageBase64?: string;
  dg1Base64: string;
  sodBase64: string;
  passiveAuthVerified: boolean;
}

export type ScanStatus =
  | 'idle'
  | 'checking_nfc'
  | 'nfc_unavailable'
  | 'awaiting_tap'
  | 'reading'
  | 'submitting'
  | 'success'
  | 'error';

export interface NfcAvailability {
  supported: boolean;
  enabled: boolean;
}
