'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import Link from 'next/link';

export default function ApiKeyPage() {
  const router = useRouter();
  const [apiKey] = useState(() => typeof window !== 'undefined' ? localStorage.getItem('kakusho_api_key') || '' : '');
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newKeyCopied, setNewKeyCopied] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!apiKey) router.push('/dashboard/login');
  }, [apiKey]);

  function copyKey(key: string, setFn: (v: boolean) => void) {
    navigator.clipboard.writeText(key);
    setFn(true);
    setTimeout(() => setFn(false), 2000);
  }

  async function rotateKey() {
    if (!confirming) { setConfirming(true); return; }
    setError('');
    setRotating(true);
    setConfirming(false);
    try {
      const res = await fetch('/api/kakusho/rotate-key', {
        method: 'POST',
        headers: { 'X-API-Key': apiKey },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Rotation failed');
      }
      const data = await res.json();
      setNewKey(data.api_key);
      localStorage.setItem('kakusho_api_key', data.api_key);
    } catch (e: any) {
      setError(e.message || 'ROTATION_FAILED');
    } finally {
      setRotating(false);
    }
  }

  const maskedKey = apiKey ? apiKey.slice(0, 10) + '•'.repeat(Math.max(0, apiKey.length - 16)) + apiKey.slice(-6) : '';

  return (
    <div className="min-h-screen bg-kz-void">
      <nav className="border-b border-kz-surfaceLine px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="kz-mono text-[9px] text-kz-cyan/40 hover:text-kz-cyan tracking-widest transition-colors">
          ← DASHBOARD
        </Link>
        <span className="kz-mono text-[9px] text-white/20">/</span>
        <span className="kz-mono text-[9px] text-white/60 tracking-widest">API_KEY</span>
      </nav>

      <div className="max-w-xl mx-auto px-6 py-10">
        <div className="mb-8">
          <p className="kz-mono text-[9px] text-kz-cyan/50 tracking-widest mb-2">AUTHENTICATION</p>
          <h1 className="kz-display text-3xl font-bold text-white tracking-tight">API Key</h1>
          <p className="kz-mono text-[10px] text-kz-slate mt-2 tracking-wide">
            Use this key in the <span className="text-kz-cyan/70">X-API-Key</span> header for all relayer requests.
          </p>
        </div>

        {/* Current key */}
        <div className="kz-panel mb-6">
          <div className="flex items-center justify-between mb-4">
            <p className="kz-mono text-[9px] tracking-widest text-kz-slate">CURRENT_KEY</p>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-kz-mint animate-pulse" />
              <span className="kz-mono text-[9px] text-kz-mint tracking-widest">ACTIVE</span>
            </div>
          </div>

          <div className="bg-kz-voidRaised border border-kz-surfaceLine rounded-lg p-4 mb-4">
            <p className="kz-mono text-[11px] text-white/70 break-all leading-relaxed">
              {revealed ? apiKey : maskedKey}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setRevealed(!revealed)}
              className="flex-1 border border-kz-surfaceLine rounded-lg py-2.5 kz-mono text-[10px] tracking-widest text-kz-slate hover:text-white hover:border-kz-cyan/40 transition-colors"
            >
              {revealed ? 'HIDE' : 'REVEAL'}
            </button>
            <button
              onClick={() => copyKey(apiKey, setCopied)}
              className={cn(
                'flex-1 border rounded-lg py-2.5 kz-mono text-[10px] tracking-widest transition-colors',
                copied
                  ? 'border-kz-cyan/50 text-kz-cyan'
                  : 'border-kz-surfaceLine text-kz-slate hover:text-white hover:border-kz-cyan/40'
              )}
            >
              {copied ? '✓ COPIED' : 'COPY'}
            </button>
          </div>
        </div>

        {/* Usage example */}
        <div className="kz-panel mb-6">
          <p className="kz-mono text-[9px] tracking-widest text-kz-slate mb-4">USAGE_EXAMPLE</p>
          <div className="bg-kz-voidRaised rounded-lg p-4 overflow-x-auto">
            <pre className="kz-mono text-[10px] text-white/60 leading-relaxed whitespace-pre">{`curl https://your-relayer.com/proof/submit \\
  -H "X-API-Key: ${maskedKey}" \\
  -H "Content-Type: application/json" \\
  -d '{ "nullifier_hex": "...", ... }'`}</pre>
          </div>
        </div>

        {/* New key result */}
        {newKey && (
          <div className="kz-panel mb-6 border-kz-cyan/30">
            <p className="kz-mono text-[9px] tracking-widest text-kz-cyan mb-2">NEW_KEY_GENERATED</p>
            <p className="kz-mono text-[9px] text-kz-danger tracking-widest mb-4">
              ⚠ Old key is now invalid. Save this immediately.
            </p>
            <div className="bg-kz-voidRaised border border-kz-surfaceLine rounded-lg p-4 mb-3">
              <p className="kz-mono text-[11px] text-white/80 break-all leading-relaxed">{newKey}</p>
            </div>
            <button
              onClick={() => copyKey(newKey, setNewKeyCopied)}
              className="w-full kz-btn-connect py-3"
            >
              <div className="kz-btn-scan" />
              <span className="relative z-10 kz-mono text-xs tracking-widest font-bold">
                {newKeyCopied ? '✓ COPIED' : 'COPY NEW KEY'}
              </span>
            </button>
          </div>
        )}

        {error && (
          <div className="kz-error-box mb-6">
            <span className="kz-mono text-[10px] text-kz-danger tracking-wider">{error}</span>
          </div>
        )}

        {/* Rotate */}
        <div className="kz-panel border-kz-danger/20">
          <p className="kz-mono text-[9px] tracking-widest text-kz-danger/70 mb-2">DANGER_ZONE</p>
          <p className="kz-mono text-[10px] text-kz-slate leading-relaxed mb-4 tracking-wide">
            Rotating invalidates your current key immediately. Update all integrations before rotating.
          </p>
          {confirming && (
            <div className="kz-error-box mb-4">
              <p className="kz-mono text-[10px] text-kz-danger tracking-wider">
                Click again to confirm. Your current key stops working instantly.
              </p>
            </div>
          )}
          <button
            onClick={rotateKey}
            disabled={rotating}
            className={cn(
              'w-full border rounded-lg py-3 kz-mono text-[10px] tracking-widest font-bold transition-colors',
              confirming
                ? 'border-kz-danger text-kz-danger bg-kz-danger/10'
                : 'border-kz-danger/30 text-kz-danger/60 hover:border-kz-danger/60 hover:text-kz-danger'
            )}
          >
            {rotating ? <><span className="kz-spinner-sm mr-2" />ROTATING...</> : confirming ? 'CONFIRM ROTATE' : 'ROTATE KEY'}
          </button>
        </div>
      </div>
    </div>
  );
}