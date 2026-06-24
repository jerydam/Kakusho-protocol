'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import Link from 'next/link';

export default function WebhookPage() {
  const router = useRouter();
  const [apiKey] = useState(() => typeof window !== 'undefined' ? localStorage.getItem('kakusho_api_key') || '' : '');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'failed' | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!apiKey) { router.push('/dashboard/login'); return; }
    fetch('/api/kakusho/me', { headers: { 'X-API-Key': apiKey } })
      .then((r) => r.json())
      .then((d) => {
        const url = d.integrator?.webhook_url || '';
        setCurrentUrl(url || null);
        setWebhookUrl(url);
      })
      .finally(() => setLoading(false));
  }, [apiKey]);

  async function save() {
    setError('');
    setSaving(true);
    try {
      const res = await fetch('/api/kakusho/webhook', {
        method: 'PATCH',
        headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook_url: webhookUrl.trim() || null }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || 'Save failed');
      setCurrentUrl(webhookUrl.trim() || null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function testWebhook() {
    if (!currentUrl) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/kakusho/webhook/test', {
        method: 'POST',
        headers: { 'X-API-Key': apiKey },
      });
      setTestResult(res.ok ? 'success' : 'failed');
    } catch {
      setTestResult('failed');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="min-h-screen bg-kz-void">
      <nav className="border-b border-kz-surfaceLine px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="kz-mono text-[9px] text-kz-cyan/40 hover:text-kz-cyan tracking-widest transition-colors">
          ← DASHBOARD
        </Link>
        <span className="kz-mono text-[9px] text-white/20">/</span>
        <span className="kz-mono text-[9px] text-white/60 tracking-widest">WEBHOOK</span>
      </nav>

      <div className="max-w-xl mx-auto px-6 py-10">
        <div className="mb-8">
          <p className="kz-mono text-[9px] text-kz-cyan/50 tracking-widest mb-2">NOTIFICATIONS</p>
          <h1 className="kz-display text-3xl font-bold text-white tracking-tight">Webhook</h1>
          <p className="kz-mono text-[10px] text-kz-slate mt-2 tracking-wide">
            Receive a signed event when a user's proof is confirmed on-chain.
          </p>
        </div>

        {/* Current status */}
        <div className="kz-panel mb-6">
          <div className="flex items-center justify-between mb-4">
            <p className="kz-mono text-[9px] tracking-widest text-kz-slate">STATUS</p>
            <div className={cn('flex items-center gap-2', currentUrl ? 'text-kz-mint' : 'text-white/30')}>
              <div className={cn('w-1.5 h-1.5 rounded-full', currentUrl ? 'bg-kz-mint animate-pulse' : 'bg-white/20')} />
              <span className="kz-mono text-[9px] tracking-widest">{currentUrl ? 'CONFIGURED' : 'NOT_SET'}</span>
            </div>
          </div>
          {currentUrl && (
            <div className="bg-kz-voidRaised border border-kz-surfaceLine rounded-lg px-4 py-3">
              <p className="kz-mono text-[10px] text-white/60 truncate">{currentUrl}</p>
            </div>
          )}
        </div>

        {/* Edit URL */}
        <div className="kz-panel mb-6">
          <label className="kz-mono text-[9px] tracking-widest text-kz-slate block mb-3">
            WEBHOOK_URL
          </label>
          <input
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://your-app.com/webhook"
            className="w-full bg-kz-voidRaised border border-kz-surfaceLine rounded-lg px-4 py-3 kz-mono text-sm text-white placeholder-white/20 focus:outline-none focus:border-kz-cyan/50 transition-colors mb-4"
          />

          {error && (
            <div className="kz-error-box mb-4">
              <span className="kz-mono text-[10px] text-kz-danger tracking-wider">{error}</span>
            </div>
          )}

          <button onClick={save} disabled={saving} className="kz-btn-connect w-full py-3">
            <div className="kz-btn-scan" />
            <span className="relative z-10 kz-mono text-xs tracking-widest font-bold">
              {saving ? <><span className="kz-spinner-sm mr-2" />SAVING...</> : saved ? '✓ SAVED' : 'SAVE WEBHOOK'}
            </span>
          </button>
        </div>

        {/* Test */}
        {currentUrl && (
          <div className="kz-panel mb-6">
            <p className="kz-mono text-[9px] tracking-widest text-kz-slate mb-2">TEST_DELIVERY</p>
            <p className="kz-mono text-[10px] text-kz-slate leading-relaxed mb-4 tracking-wide">
              Sends a sample <span className="text-kz-cyan/70">kyc.verification.completed</span> event to verify your endpoint is reachable and HMAC verification works.
            </p>
            {testResult && (
              <div className={cn('mb-4 rounded-lg px-4 py-3 border kz-mono text-[10px] tracking-wider',
                testResult === 'success'
                  ? 'border-kz-mint/30 text-kz-mint bg-kz-mint/5'
                  : 'border-kz-danger/30 text-kz-danger bg-kz-danger/5'
              )}>
                {testResult === 'success' ? '✓ DELIVERY_SUCCESS — Your endpoint returned 2xx' : '✗ DELIVERY_FAILED — Check your endpoint and try again'}
              </div>
            )}
            <button onClick={testWebhook} disabled={testing} className="w-full border border-kz-surfaceLine rounded-lg py-3 kz-mono text-[10px] tracking-widest text-kz-cyan/60 hover:text-kz-cyan hover:border-kz-cyan/40 transition-colors">
              {testing ? <><span className="kz-spinner-sm mr-2" />SENDING...</> : 'SEND TEST EVENT'}
            </button>
          </div>
        )}

        {/* Payload shape */}
        <div className="kz-panel">
          <p className="kz-mono text-[9px] tracking-widest text-kz-slate mb-4">PAYLOAD_SHAPE</p>
          <div className="bg-kz-voidRaised rounded-lg p-4 overflow-x-auto mb-4">
            <pre className="kz-mono text-[10px] text-white/50 leading-relaxed whitespace-pre">{`{
  "event": "kyc.verification.completed",
  "integrator_id_hex": "0101...01",
  "nullifier_hex": "abcd...ef",
  "status": "confirmed",
  "tx_hash": "a8ae...ba",
  "submission_id": "uuid",
  "timestamp": "2025-01-01T00:00:00Z"
}`}</pre>
          </div>
          <p className="kz-mono text-[9px] text-white/20 tracking-widest">
            VERIFY WITH: <span className="text-kz-cyan/40">X-Webhook-Signature</span> header · HMAC-SHA256
          </p>
          <div className="bg-kz-voidRaised rounded-lg p-4 mt-3 overflow-x-auto">
            <pre className="kz-mono text-[10px] text-white/50 leading-relaxed whitespace-pre">{`// Node.js verification
const sig = crypto
  .createHmac('sha256', YOUR_WEBHOOK_SECRET)
  .update(rawBody)
  .digest('hex');
if (sig !== req.headers['x-webhook-signature']) {
  return res.status(401).end();
}`}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}