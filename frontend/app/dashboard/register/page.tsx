'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { isConnected, requestAccess, signMessage } from '@stellar/freighter-api';

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<'form' | 'connecting' | 'signing' | 'registering' | 'done'>('form');
  const [error, setError] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [copied, setCopied] = useState(false);

  const [form, setForm] = useState({
    name: '',
    webhook_url: '',
    min_age_years: '18',
    doc_max_age_years: '10',
    integrator_id_hex: '',
  });

  function generateIntegratorId() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function register() {
    setError('');
    if (!form.name.trim()) { setError('NAME_REQUIRED'); return; }

    try {
      // Check extension is present
      const connected = await isConnected();
      if (connected.error) {
        setError('NO_WALLET — Install Freighter wallet (freighter.app)');
        return;
      }

      setStep('connecting');
      const access = await requestAccess();
      if (access.error) {
        throw new Error(access.error.message || 'Freighter connection was rejected.');
      }
      const publicKey = access.address;
      if (!publicKey) throw new Error('No address returned by Freighter.');

      const integratorId = form.integrator_id_hex || generateIntegratorId();

      setStep('signing');
      const nonceRes = await fetch(`/api/kakusho/auth/nonce?address=${publicKey}`);
      if (!nonceRes.ok) throw new Error(`Nonce fetch failed: ${nonceRes.status}`);
      const { message } = await nonceRes.json();

      const signed = await signMessage(message, { address: publicKey });
      if (signed.error) {
        throw new Error(signed.error.message || 'Signature request was rejected.');
      }
      const signedMessage =
        typeof signed.signedMessage === 'string'
          ? signed.signedMessage
          : Buffer.from(signed.signedMessage as any).toString('base64');

      setStep('registering');
      const res = await fetch('/api/kakusho/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          webhook_url: form.webhook_url.trim() || null,
          owner_stellar_address: publicKey,
          integrator_id_hex: integratorId,
          min_age_seconds: parseInt(form.min_age_years) * 365 * 24 * 3600,
          doc_max_age_seconds: parseInt(form.doc_max_age_years) * 365 * 24 * 3600,
          stellar_address: publicKey,
          signed_message: signedMessage,
          message,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Registration failed');
      }

      const data = await res.json();
      setApiKey(data.api_key);
      localStorage.setItem('kakusho_api_key', data.api_key);
      setStep('done');
    } catch (e: any) {
      setError(e.message || 'REGISTRATION_FAILED');
      setStep('form');
    }
  }
  function copyKey() {
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (step === 'done') {
    return (
      <div className="min-h-screen bg-kz-void flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="kz-panel animate-kz-rise text-center">
            <div className="flex items-center justify-center mb-6">
              <div className="kz-proof-badge">
                <div className="kz-proof-outer">
                  <div className="kz-proof-inner">
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                      <path d="M7 14L11.5 18.5L21 8.5" stroke="#00E676" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
            <div className="kz-mono text-[9px] tracking-widest text-kz-mint mb-2">● REGISTERED</div>
            <h2 className="kz-display text-2xl font-bold text-white mb-1">You're in</h2>
            <p className="kz-mono text-[10px] text-kz-cyan/50 tracking-widest mb-8">
              SAVE YOUR API KEY — SHOWN ONCE ONLY
            </p>

            <div className="bg-kz-voidRaised border border-kz-surfaceLine rounded-lg p-4 mb-4">
              <p className="kz-mono text-[9px] text-kz-cyan/50 tracking-widest mb-2">API_KEY</p>
              <p className="kz-mono text-[10px] text-white/80 break-all leading-relaxed">{apiKey}</p>
            </div>

            <button onClick={copyKey} className={cn('kz-btn-connect w-full py-3 mb-4', copied && 'opacity-70')}>
              <div className="kz-btn-scan" />
              <span className="relative z-10 kz-mono text-xs tracking-widest font-bold">
                {copied ? '✓ COPIED' : 'COPY API KEY'}
              </span>
            </button>

            <div className="kz-error-box mb-6">
              <p className="kz-mono text-[10px] text-kz-danger tracking-wider">
                ⚠ This key will NOT be shown again. Store it securely now.
              </p>
            </div>

            <button onClick={() => router.push('/dashboard')} className="kz-mono text-[10px] text-kz-cyan/60 hover:text-kz-cyan tracking-widest transition-colors">
              GO TO DASHBOARD →
            </button>
          </div>
        </div>
      </div>
    );
  }

  const stepLabels: Record<string, string> = {
    connecting: 'CONNECTING WALLET...',
    signing: 'SIGN TO VERIFY OWNERSHIP...',
    registering: 'REGISTERING ON-CHAIN...',
  };

  const isLoading = step !== 'form';

  return (
    <div className="min-h-screen bg-kz-void flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="kz-icon-frame mx-auto mb-5">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <rect x="4" y="4" width="16" height="16" rx="2" stroke="#00D2FF" strokeWidth="1.2" />
              <path d="M8 12H16M12 8V16" stroke="#00D2FF" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="kz-display text-2xl font-bold text-white mb-1 tracking-tight">Register Integrator</h1>
          <p className="kz-mono text-[9px] text-kz-cyan/50 tracking-widest">
            DEPLOY YOUR KYC RULES ON-CHAIN
          </p>
        </div>

        <div className="kz-panel animate-kz-rise space-y-5">
          {/* Name */}
          <div>
            <label className="kz-mono text-[9px] tracking-widest text-kz-slate block mb-2">
              APP_NAME *
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="My dApp"
              className="w-full bg-kz-voidRaised border border-kz-surfaceLine rounded-lg px-4 py-3 kz-mono text-sm text-white placeholder-white/20 focus:outline-none focus:border-kz-cyan/50 transition-colors"
            />
          </div>

          {/* Min age */}
          <div>
            <label className="kz-mono text-[9px] tracking-widest text-kz-slate block mb-2">
              MIN_AGE_YEARS
            </label>
            <div className="grid grid-cols-4 gap-2">
              {['13', '16', '18', '21'].map((age) => (
                <button
                  key={age}
                  onClick={() => setForm({ ...form, min_age_years: age })}
                  className={cn(
                    'kz-doc-type-btn py-2',
                    form.min_age_years === age && 'kz-doc-type-active'
                  )}
                >
                  <span className="kz-mono text-[11px] font-bold tracking-widest">{age}+</span>
                </button>
              ))}
            </div>
          </div>

          {/* Doc max age */}
          <div>
            <label className="kz-mono text-[9px] tracking-widest text-kz-slate block mb-2">
              DOC_MAX_AGE_YEARS
            </label>
            <div className="grid grid-cols-4 gap-2">
              {['5', '10', '15', '20'].map((age) => (
                <button
                  key={age}
                  onClick={() => setForm({ ...form, doc_max_age_years: age })}
                  className={cn(
                    'kz-doc-type-btn py-2',
                    form.doc_max_age_years === age && 'kz-doc-type-active'
                  )}
                >
                  <span className="kz-mono text-[11px] font-bold tracking-widest">{age}y</span>
                </button>
              ))}
            </div>
          </div>

          {/* Webhook */}
          <div>
            <label className="kz-mono text-[9px] tracking-widest text-kz-slate block mb-2">
              WEBHOOK_URL <span className="text-white/20">(OPTIONAL)</span>
            </label>
            <input
              type="url"
              value={form.webhook_url}
              onChange={(e) => setForm({ ...form, webhook_url: e.target.value })}
              placeholder="https://your-app.com/webhook"
              className="w-full bg-kz-voidRaised border border-kz-surfaceLine rounded-lg px-4 py-3 kz-mono text-sm text-white placeholder-white/20 focus:outline-none focus:border-kz-cyan/50 transition-colors"
            />
          </div>

          {error && (
            <div className="kz-error-box">
              <span className="kz-mono text-[10px] text-kz-danger tracking-wider">{error}</span>
            </div>
          )}

          <button
            onClick={register}
            disabled={isLoading}
            className="kz-btn-connect w-full py-4 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <div className="kz-btn-scan" />
            <span className="relative z-10 flex items-center justify-center gap-3 kz-mono text-sm tracking-[0.2em] font-bold">
              {isLoading ? (
                <><span className="kz-spinner-sm" />{stepLabels[step]}</>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M7 1L13 7L7 13M1 7H13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  REGISTER + DEPLOY
                </>
              )}
            </span>
          </button>

          <p className="kz-mono text-[9px] text-center text-kz-cyan/25 tracking-widest">
            SIGNS WITH FREIGHTER · REGISTERS ON SOROBAN TESTNET
          </p>
        </div>

        <p className="kz-mono text-[9px] text-center text-kz-slate/50 mt-6 tracking-widest">
          ALREADY REGISTERED?{' '}
          <a href="/dashboard/login" className="text-kz-cyan/60 hover:text-kz-cyan transition-colors">
            LOGIN →
          </a>
        </p>
      </div>
    </div>
  );
}