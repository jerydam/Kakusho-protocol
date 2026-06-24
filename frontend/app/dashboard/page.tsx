'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface IntegratorData {
  id: string;
  integrator_id_hex: string;
  name: string;
  webhook_url: string | null;
  daily_sponsored_tx_limit: number;
  is_active: boolean;
  created_at: string;
}

interface UsageStats {
  used_today: number;
  limit: number;
  total_submissions: number;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="kz-panel p-5">
      <p className="kz-mono text-[9px] tracking-widest text-kz-slate mb-2">{label}</p>
      <p className="kz-display text-3xl font-bold text-white">{value}</p>
      {sub && <p className="kz-mono text-[9px] text-kz-cyan/40 mt-1 tracking-widest">{sub}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [integrator, setIntegrator] = useState<IntegratorData | null>(null);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const apiKey = localStorage.getItem('kakusho_api_key');
    if (!apiKey) {
      router.push('/dashboard/login');
      return;
    }
    fetch('/api/kakusho/me', {
      headers: { 'X-API-Key': apiKey },
    })
      .then((r) => {
        if (r.status === 401) {
          localStorage.removeItem('kakusho_api_key');
          router.push('/dashboard/login');
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (!d) return;
        setIntegrator(d.integrator);
        setStats(d.stats);
      })
      .catch(() => setError('Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-kz-void flex items-center justify-center">
        <div className="text-center">
          <span className="kz-spinner" />
          <p className="kz-mono text-[11px] text-kz-cyan/50 tracking-widest mt-4">LOADING...</p>
        </div>
      </div>
    );
  }

  if (error || !integrator) {
    return (
      <div className="min-h-screen bg-kz-void flex items-center justify-center">
        <div className="kz-panel text-center p-8 max-w-sm">
          <p className="kz-mono text-kz-danger text-sm tracking-widest">{error || 'Not found'}</p>
        </div>
      </div>
    );
  }

  const usagePct = stats ? Math.round((stats.used_today / stats.limit) * 100) : 0;

  return (
    <div className="min-h-screen bg-kz-void">
      {/* Top nav */}
      <nav className="border-b border-kz-surfaceLine px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <circle cx="11" cy="11" r="7.5" stroke="#00D2FF" strokeWidth="1" />
            <circle cx="11" cy="11" r="2.5" fill="#00D2FF" />
          </svg>
          <span className="kz-mono text-xs tracking-widest text-white font-bold">KAKUSHŌ</span>
          <span className="kz-mono text-[9px] text-kz-cyan/30 tracking-widest">/ DASHBOARD</span>
        </div>
        <div className="flex items-center gap-4">
          <div className={`kz-mono text-[9px] tracking-widest px-2 py-1 rounded border ${integrator.is_active ? 'text-kz-mint border-kz-mint/30' : 'text-kz-danger border-kz-danger/30'}`}>
            ● {integrator.is_active ? 'ACTIVE' : 'INACTIVE'}
          </div>
          <button
            onClick={() => { localStorage.removeItem('kakusho_api_key'); router.push('/dashboard/login'); }}
            className="kz-mono text-[9px] text-kz-slate tracking-widest hover:text-white transition-colors"
          >
            SIGN_OUT →
          </button>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="mb-10">
          <p className="kz-mono text-[9px] text-kz-cyan/50 tracking-widest mb-2">INTEGRATOR</p>
          <h1 className="kz-display text-4xl font-bold text-white tracking-tight">{integrator.name}</h1>
          <p className="kz-mono text-[10px] text-kz-cyan/30 mt-2 tracking-widest">
            {integrator.integrator_id_hex}
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="PROOFS_TODAY" value={stats?.used_today ?? 0} sub={`OF ${stats?.limit ?? 0} LIMIT`} />
          <StatCard label="TOTAL_PROOFS" value={stats?.total_submissions ?? 0} sub="ALL TIME" />
          <StatCard label="DAILY_LIMIT" value={integrator.daily_sponsored_tx_limit} sub="SPONSORED TX" />
          <StatCard label="REGISTERED" value={new Date(integrator.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} sub={new Date(integrator.created_at).getFullYear().toString()} />
        </div>

        {/* Usage bar */}
        <div className="kz-panel p-5 mb-8">
          <div className="flex items-center justify-between mb-3">
            <p className="kz-mono text-[9px] tracking-widest text-kz-slate">DAILY_USAGE</p>
            <p className="kz-mono text-[10px] text-kz-cyan tracking-widest">{usagePct}%</p>
          </div>
          <div className="w-full h-1 bg-kz-surfaceLine rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(usagePct, 100)}%`,
                background: 'linear-gradient(90deg, #00D2FF, #2962FF)',
                opacity: usagePct > 80 ? 1 : 0.75,
              }}
            />
          </div>
          <p className="kz-mono text-[9px] text-kz-slate/60 mt-2 tracking-widest">
            {stats?.used_today ?? 0} / {stats?.limit ?? 0} TRANSACTIONS · RESETS IN 24H
          </p>
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { href: '/dashboard/apikey', label: 'API_KEY', desc: 'View or rotate your API key' },
            { href: '/dashboard/webhook', label: 'WEBHOOK', desc: integrator.webhook_url ? integrator.webhook_url : 'Not configured' },
            { href: '/dashboard/countries', label: 'COUNTRY_TREE', desc: 'Build restricted-country Merkle tree' },
            { href: '/dashboard/docs', label: 'SDK_DOCS', desc: 'Integration guide + code examples' },
          ].map(({ href, label, desc }) => (
            <Link key={href} href={href} className="kz-panel p-5 flex items-center gap-4 hover:border-kz-cyan/30 transition-colors group">
              <div className="kz-icon-frame shrink-0" style={{ width: 40, height: 40 }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="5.5" stroke="#00D2FF" strokeWidth="1" opacity="0.6" />
                  <circle cx="8" cy="8" r="1.5" fill="#00D2FF" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="kz-mono text-[10px] tracking-widest text-kz-cyan font-bold mb-1">{label}</p>
                <p className="kz-mono text-[9px] text-kz-slate truncate tracking-wide">{desc}</p>
              </div>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-kz-cyan/30 group-hover:text-kz-cyan transition-colors shrink-0">
                <path d="M2 6H10M10 6L7 3M10 6L7 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}