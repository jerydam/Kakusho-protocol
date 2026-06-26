'use client';


import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const APP_SCHEME = 'kakusho://verify';
const APP_STORE_URL = process.env.NEXT_PUBLIC_KAKUSHO_APP_STORE_URL || '';
const PLAY_STORE_URL = process.env.NEXT_PUBLIC_KAKUSHO_PLAY_STORE_URL || '';

type Phase = 'opening_app' | 'app_likely_missing' | 'session_invalid';

export default function MobileHandoffPage() {
  const params = useParams<{ session: string }>();
  const sessionId = params.session;
  const [phase, setPhase] = useState<Phase>('opening_app');

  useEffect(() => {
    if (!sessionId) {
      setPhase('session_invalid');
      return;
    }

    // Best-effort PATCH so the desktop tab's status text updates even
    // if the user never makes it into the native app.
    fetch(`/api/kakusho/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'wallet_connected' }),
    }).catch(() => {});

    // Attempt the deep link. There's no reliable cross-platform way to
    // detect whether a custom-scheme deep link actually resolved, so
    // the standard pattern is: fire it, then if the page is STILL
    // visible after a short delay, assume it didn't open and show the
    // store fallback.
    window.location.href = `${APP_SCHEME}?session=${encodeURIComponent(sessionId)}`;

    const timer = setTimeout(() => {
      if (document.visibilityState === 'visible') {
        setPhase('app_likely_missing');
      }
    }, 1800);

    return () => clearTimeout(timer);
  }, [sessionId]);

  const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
  const storeUrl = isAndroid ? PLAY_STORE_URL : APP_STORE_URL;

  return (
    <div className="min-h-screen bg-kz-void flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm kz-panel text-center space-y-4">
        {phase === 'session_invalid' && (
          <>
            <p className="kz-mono text-sm text-kz-danger">Invalid or missing session link.</p>
            <p className="kz-mono text-[10px] text-white/40">
              Go back to the desktop tab and refresh the QR code.
            </p>
          </>
        )}

        {phase === 'opening_app' && (
          <>
            <span className="kz-spinner-sm" />
            <p className="kz-mono text-[10px] text-kz-cyan tracking-widest">OPENING SCANNER APP...</p>
          </>
        )}

        {phase === 'app_likely_missing' && (
          <>
            <p className="kz-mono text-sm text-white">Scanner app not detected</p>
            <p className="kz-mono text-[10px] text-white/40 leading-relaxed">
              NFC chip reading needs the Kakushō scanner app — a regular browser tab
              can't access the passport chip directly. Install it, then re-scan the
              QR code on your desktop.
            </p>
            {storeUrl ? (
              <a href={storeUrl} className="kz-btn-connect w-full py-3 inline-block">
                <span className="relative z-10 kz-mono text-xs tracking-widest font-bold">
                  GET THE SCANNER APP
                </span>
              </a>
            ) : (
              <p className="kz-mono text-[9px] text-kz-cyan/40">
                No app published yet — for now, use a USB NFC reader on desktop instead.
              </p>
            )}
            <button
              onClick={() => {
                setPhase('opening_app');
                window.location.href = `${APP_SCHEME}?session=${encodeURIComponent(sessionId)}`;
                setTimeout(() => setPhase('app_likely_missing'), 1800);
              }}
              className="kz-mono text-[10px] text-kz-cyan/60 hover:text-kz-cyan tracking-widest"
            >
              TRY OPENING THE APP AGAIN
            </button>
          </>
        )}
      </div>
    </div>
  );
}