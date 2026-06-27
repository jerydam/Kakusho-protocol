'use client';

// app/(integrator-demo)/verify/mobile/[session]/page.tsx
//
// Mobile bridge page — scanned from the desktop QR code.
//
// Responsibilities:
//   1. Connect the user's Freighter wallet
//   2. PATCH the session so the desktop tab's status updates
//   3. Redirect to the full /verify page (the Kakushō KYC flow)
//      with the session ID appended, so that page can close the loop
//      when proof generation completes
//
// This page intentionally has no camera / document capture logic —
// that all lives in the main verify page which this redirects to.

import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

type Phase = 'connecting' | 'redirecting' | 'error';

export default function MobileHandoffPage() {
  const params = useParams<{ session: string }>();
  const searchParams = useSearchParams();

  const sessionId = params.session ?? '';
  const integratorId = searchParams.get('integrator_id') ?? '';
  const callbackUrl = searchParams.get('callback_url') ?? '';
  const stateParam = searchParams.get('state') ?? '';

  const [phase, setPhase] = useState<Phase>('connecting');
  const [error, setError] = useState('');
  const [needsFreighter, setNeedsFreighter] = useState(false);

  // Build the redirect URL for the main verify flow
  function buildVerifyUrl(address: string) {
    const params = new URLSearchParams({
      integrator_id: integratorId,
      callback_url: callbackUrl,
      // Use the desktop wallet address as state if none was passed,
      // otherwise keep whatever state the desktop set
      state: stateParam || address,
      session: sessionId,
    });
    return `/verify?${params.toString()}`;
  }

  const connectAndHandoff = useCallback(async () => {
    if (!sessionId) {
      setError('Invalid or missing session. Go back and re-scan the QR code.');
      setPhase('error');
      return;
    }

    setPhase('connecting');
    setError('');
    setNeedsFreighter(false);

    try {
      // Dynamic import so the page doesn't blow up on browsers where
      // Freighter isn't installed (it won't throw until we actually call it)
      const { isConnected, requestAccess } = await import('@stellar/freighter-api');

      const conn = await isConnected();
      if (conn.error || !conn.isConnected) {
        setNeedsFreighter(true);
        throw new Error('Freighter wallet not found. Install it at freighter.app, then return here.');
      }

      const access = await requestAccess();
      if (access.error) {
        throw new Error(access.error.message || 'Freighter connection was rejected.');
      }
      if (!access.address) {
        throw new Error('No Stellar address returned by Freighter.');
      }

      const address = access.address;

      // Notify the desktop tab that a phone wallet is now connected.
      // Fire-and-forget — don't block the redirect on this.
      fetch(`/api/kakusho/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'wallet_connected', address }),
      }).catch(() => {});

      setPhase('redirecting');

      // Small delay so the user sees "Redirecting…" rather than an
      // instant jump that can feel broken on slow connections
      await new Promise((r) => setTimeout(r, 600));

      window.location.href = buildVerifyUrl(address);
    } catch (e: any) {
      setError(e.message || 'Something went wrong. Please try again.');
      setPhase('error');
    }
  }, [sessionId, integratorId, callbackUrl, stateParam]);

  // Auto-attempt on mount
  useEffect(() => {
    connectAndHandoff();
  }, [connectAndHandoff]);

  return (
    <div className="min-h-screen bg-kz-void flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="6.5" stroke="#00D2FF" strokeWidth="1" opacity="0.6" />
            <circle cx="9" cy="9" r="2" fill="#00D2FF" />
          </svg>
          <span
            className="kz-mono text-xs tracking-widest text-white font-bold"
            style={{ fontFamily: 'JetBrains Mono, monospace' }}
          >
            KAKUSHŌ
          </span>
        </div>

        <div className="kz-panel text-center space-y-5 py-10 px-6">
          {/* ── Connecting ── */}
          {phase === 'connecting' && (
            <>
              <div
                className="mx-auto flex items-center justify-center rounded-full"
                style={{
                  width: 56,
                  height: 56,
                  border: '1px solid #00D2FF30',
                  background: '#00D2FF08',
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="6" width="18" height="13" rx="2" stroke="#00D2FF" strokeWidth="1.2" />
                  <path d="M3 10H21" stroke="#00D2FF" strokeWidth="1.2" />
                  <rect x="15" y="13" width="4" height="3" rx="1" fill="#00D2FF" opacity="0.6" />
                </svg>
              </div>

              <div>
                <p
                  className="kz-mono text-[10px] text-kz-cyan tracking-widest mb-2"
                  style={{ fontFamily: 'JetBrains Mono, monospace' }}
                >
                  CONNECTING WALLET...
                </p>
                <p
                  className="kz-mono text-[9px] text-white/30 tracking-widest leading-relaxed"
                  style={{ fontFamily: 'JetBrains Mono, monospace' }}
                >
                  Approve the connection in Freighter to continue.
                </p>
              </div>

              {/* Animated dots */}
              <div className="flex items-center justify-center gap-1.5 pt-2">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-kz-cyan/40 animate-pulse"
                    style={{ animationDelay: `${i * 200}ms` }}
                  />
                ))}
              </div>
            </>
          )}

          {/* ── Redirecting ── */}
          {phase === 'redirecting' && (
            <>
              <div
                className="mx-auto flex items-center justify-center rounded-full"
                style={{
                  width: 56,
                  height: 56,
                  border: '1px solid #00D2FF40',
                  background: '#00D2FF0A',
                }}
              >
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none" className="animate-spin">
                  <circle cx="11" cy="11" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.2" />
                  <path d="M11 2A9 9 0 0 1 20 11" stroke="#00D2FF" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <p
                className="kz-mono text-[10px] text-kz-cyan tracking-widest"
                style={{ fontFamily: 'JetBrains Mono, monospace' }}
              >
                WALLET CONNECTED · OPENING VERIFIER...
              </p>
            </>
          )}

          {/* ── Error ── */}
          {phase === 'error' && (
            <>
              <div
                className="rounded-lg px-4 py-3 text-left"
                style={{ background: '#FF525208', border: '1px solid #FF525230' }}
              >
                <p
                  className="kz-mono text-[10px] tracking-wider leading-relaxed"
                  style={{ fontFamily: 'JetBrains Mono, monospace', color: '#FF5252' }}
                >
                  {error}
                </p>
              </div>

              {needsFreighter ? (
                // Freighter not installed — send to freighter.app
                <div className="space-y-3">
                  <a
                    href="https://freighter.app"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="kz-btn-connect w-full py-3 inline-flex items-center justify-center"
                  >
                    <div className="kz-btn-scan" />
                    <span
                      className="relative z-10 kz-mono text-xs tracking-widest font-bold"
                      style={{ fontFamily: 'JetBrains Mono, monospace' }}
                    >
                      GET FREIGHTER WALLET
                    </span>
                  </a>
                  <p
                    className="kz-mono text-[9px] text-white/25 tracking-widest leading-relaxed"
                    style={{ fontFamily: 'JetBrains Mono, monospace' }}
                  >
                    Install Freighter, then come back to this page and tap the button below.
                  </p>
                  <button
                    onClick={connectAndHandoff}
                    className="kz-mono text-[10px] text-kz-cyan/60 hover:text-kz-cyan tracking-widest transition-colors"
                    style={{ fontFamily: 'JetBrains Mono, monospace' }}
                  >
                    I INSTALLED IT · TRY AGAIN →
                  </button>
                </div>
              ) : (
                // Generic error — retry button
                <button
                  onClick={connectAndHandoff}
                  className="kz-btn-connect w-full py-3"
                >
                  <div className="kz-btn-scan" />
                  <span
                    className="relative z-10 kz-mono text-xs tracking-widest font-bold"
                    style={{ fontFamily: 'JetBrains Mono, monospace' }}
                  >
                    TRY AGAIN
                  </span>
                </button>
              )}

              <p
                className="kz-mono text-[9px] text-white/20 tracking-widest"
                style={{ fontFamily: 'JetBrains Mono, monospace' }}
              >
                If the problem persists, go back to the desktop and refresh the QR code.
              </p>
            </>
          )}
        </div>

        <p
          className="kz-mono text-[9px] text-center text-white/15 tracking-widest mt-6"
          style={{ fontFamily: 'JetBrains Mono, monospace' }}
        >
          KAKUSHŌ · ZERO-KNOWLEDGE KYC · NO PII ON-CHAIN
        </p>
      </div>
    </div>
  );
}