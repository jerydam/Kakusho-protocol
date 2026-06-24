/**
 * lib/statusMap.ts
 *
 * FastAPI uses a different KYC status vocabulary than the frontend.
 * This file is the single source of truth for translating between them.
 *
 * FastAPI statuses  →  Frontend KycStatus
 * ─────────────────────────────────────────
 * pending           →  pending
 * email_verified    →  pending          (email done, no docs yet)
 * id_submitted      →  documents_uploaded
 * processing        →  under_review
 * verified          →  verified
 * rejected          →  rejected
 */

import type { KycStatus } from './types';

const FASTAPI_TO_FRONTEND: Record<string, KycStatus> = {
  pending: 'pending',
  email_verified: 'pending',
  id_submitted: 'documents_uploaded',
  processing: 'under_review',
  verified: 'verified',
  rejected: 'rejected',
};

export function toFrontendStatus(fastapiStatus: string): KycStatus {
  return FASTAPI_TO_FRONTEND[fastapiStatus] ?? 'pending';
}

/**
 * Convert a FastAPI /kyc/status response into the session shape
 * that the frontend's KycPage expects from /api/kyc/start.
 */
export function statusResponseToSession(data: {
  kyc_status: string;
  user_id?: string;
  email_verified?: boolean;
  onchain_verified?: boolean;
  steps_completed?: string[];
  next_step?: string | null;
  rejection_reason?: string | null;
}): {
  id: string;
  status: KycStatus;
  doc_file_path: string | null;
  selfie_file_path: string | null;
  kyc_status_raw: string;
} {
  const status = toFrontendStatus(data.kyc_status);

  // Infer whether docs / selfie were uploaded from the raw status
  const docUploaded = ['id_submitted', 'processing', 'verified', 'rejected'].includes(
    data.kyc_status
  );
  const selfieUploaded = ['processing', 'verified', 'rejected'].includes(data.kyc_status);

  return {
    id: data.user_id ?? '',
    status,
    doc_file_path: docUploaded ? '__uploaded__' : null,
    selfie_file_path: selfieUploaded ? '__uploaded__' : null,
    kyc_status_raw: data.kyc_status,
  };
}