'use client';

/**
 * QRHandoff.tsx — shown on desktop (or any device without a capable
 * native scanner) once the document-type the user picked requires NFC
 * under the integrator's policy (see allowed_document_types/nfc_policy
 * from /api/kakusho/verify/integrator-info).
 *
 * IMPORTANT: this QR does NOT point at a mobile *web* page that reads
 * the chip itself — a browser tab can't do the raw APDU exchange
 * ePassport reading needs (Web NFC's NDEFReader only handles NDEF
 * tags). It deep-links into a native companion app
 * (see /mobile-companion/README.md). If that app isn't installed, the
 * deep link silently fails on most platforms, so this also shows a
 * "get the app" fallback after a short timeout — same UX pattern as
 * any QR-deep-link flow (e.g. WhatsApp Web, banking app handoffs).
 *
 * npm install qrcode.react
 */
import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

type SessionStatus =
  | 'pending'
  | 'wallet_connected'
  | 'scanning'
  | 'proof_generated'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'expired';

interface Props {
  integratorId: string;
  documentType: string;
  /** e.g. "kakusho://verify" — your native app's registered scheme */
  appScheme?: string;
  /** Plain https fallback if appScheme doesn't resolve (app store / "get the app" page) */
  fallbackUrl?: string;
  onComplete: (result: { txHash: string | null; nullifierHex: string | null }) => void;
  onError?: (message: string) => void;
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  pending: 'WAITING FOR PHONE...',
  wallet_connected: 'WALLET CONNECTED — OPEN THE SCANNER...',
  scanning: 'READING CHIP...',
  proof_generated: 'GENERATING PROOF...',
  submitted: 'SUBMITTED — CONFIRMING...',
  confirmed: 'VERIFIED',
  failed: 'FAILED',
  expired: 'EXPIRED — REFRESH TO RETRY',
};

const POLL_INTERVAL_MS = 2000;
const SHOW_FALLBACK_AFTER_MS = 8000;

export default function QRHandoff({
  integratorId,
  documentType,
  appScheme = 'kakusho://verify',
  fallbackUrl,
  onComplete,
  onError,
}: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<SessionStatus>('pending');
  const [showFallback, setShowFallback] = useState(false);
  const [createError, setCreateError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/kakusho/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ integrator_id: integratorId, document_type: documentType }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || 'Could not start a verification session');
        }
        const data = await res.json();
        if (!cancelled) setSessionId(data.id);
      } catch (e: any) {
        if (!cancelled) {
          setCreateError(e.message || 'SESSION_CREATE_FAILED');
          onError?.(e.message);
        }
      }
    })();

    const fallbackTimer = setTimeout(() => setShowFallback(true), SHOW_FALLBACK_AFTER_MS);
    return () => {
      cancelled = true;
      clearTimeout(fallbackTimer);
    };
  }, [integratorId, documentType]);

  useEffect(() => {
    if (!sessionId) return;

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/kakusho/sessions/${sessionId}`, { cache: 'no-store' });
        if (!res.ok) return; // transient — keep polling, a 404 here usually means expiry, handled below
        const data = await res.json();
        setStatus(data.status);

        if (data.status === 'submitted' || data.status === 'confirmed') {
          clearInterval(pollRef.current!);
          onComplete({ txHash: data.tx_hash ?? null, nullifierHex: data.nullifier_hex ?? null });
        }
        if (data.status === 'failed' || data.status === 'expired') {
          clearInterval(pollRef.current!);
          onError?.(data.error_message || `Session ${data.status}`);
        }
      } catch {
        // network hiccup — next tick will retry
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [sessionId]);

  if (createError) {
    return (
      <div className="kz-error-box">
        <span className="kz-mono text-[10px] text-kz-danger tracking-wider">{createError}</span>
      </div>
    );
  }

  const deepLink = sessionId ? `${appScheme}?session=${sessionId}` : '';

  return (
    <div className="kz-panel text-center space-y-4">
      <p className="kz-mono text-[9px] tracking-widest text-kz-slate">
        SCAN WITH YOUR PHONE TO READ THE CHIP
      </p>

      {sessionId ? (
        <div className="flex items-center justify-center">
          <div className="bg-white p-3 rounded-lg">
            <QRCodeSVG value={deepLink} size={200} />
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center py-10">
          <span className="kz-spinner-sm" />
        </div>
      )}

      <p className="kz-mono text-[10px] text-kz-cyan tracking-widest">{STATUS_LABEL[status]}</p>

      {showFallback && fallbackUrl && (
        <p className="kz-mono text-[9px] text-white/40 tracking-wide">
          Nothing happen when you scanned?{' '}
          <a href={fallbackUrl} className="text-kz-cyan/70 underline">
            Get the scanner app
          </a>
        </p>
      )}

      <p className="kz-mono text-[9px] text-kz-cyan/25 tracking-widest">
        THIS QR EXPIRES IN 10 MINUTES AND CAN ONLY BE USED ONCE
      </p>
    </div>
  );
}