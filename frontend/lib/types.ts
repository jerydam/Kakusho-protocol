export type KycStatus =
  | 'pending'
  | 'documents_uploaded'
  | 'face_verified'
  | 'under_review'
  | 'verified'
  | 'rejected';

export type DocType = 'passport' | 'national_id' | 'drivers_license';

export interface KycUser {
  id: string;
  wallet_address: string;
  is_admin: boolean;
  kyc_status: KycStatus;
  created_at: string;
  updated_at: string;
}

export interface KycSession {
  id: string;
  user_id: string;
  status: KycStatus;
  doc_type: DocType | null;
  doc_file_path: string | null;
  selfie_file_path: string | null;
  admin_notes: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  kyc_users?: KycUser;
}

export interface SbtToken {
  id: string;
  user_id: string;
  token_id: string | null;
  chain: string;
  tx_hash: string | null;
  contract_address: string | null;
  minted_at: string;
}

export interface AuthPayload {
  userId: string;
  walletAddress: string;
  isAdmin: boolean;
  iat: number;
  exp: number;
}

export interface NonceResponse {
  nonce: string;
  message: string;
  expiresAt: string;
}

export interface LoginResponse {
  token: string;
  user: KycUser;
}

export interface KycStatusResponse {
  status: KycStatus;
  session: KycSession | null;
  sbt: SbtToken | null;
}

export interface WidgetCheckResponse {
  wallet: string;
  verified: boolean;
  status: KycStatus;
  kycUrl: string;
  sbt: SbtToken | null;
}

export interface AdminSession extends KycSession {
  kyc_users: KycUser;
}

export const KYC_STATUS_LABELS: Record<KycStatus, string> = {
  pending: 'Pending',
  documents_uploaded: 'Docs Uploaded',
  face_verified: 'Face Verified',
  under_review: 'Under Review',
  verified: 'Verified',
  rejected: 'Rejected',
};

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  passport: 'Passport',
  national_id: 'National ID',
  drivers_license: "Driver's License",
};
