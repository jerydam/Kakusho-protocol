'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { isConnected, requestAccess, signMessage } from '@stellar/freighter-api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  integrator_id_hex: string;
  name: string;
  owner_stellar_address: string;
  daily_sponsored_tx_limit: number;
  created_at: string;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProjectCard({
  project,
  selected,
  onSelect,
}: {
  project: Project;
  selected: boolean;
  onSelect: () => void;
}) {
  const createdDate = new Date(project.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).toUpperCase();

  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full text-left rounded-xl border px-4 py-3.5 transition-all duration-150 cursor-pointer',
        'bg-[#0d0d14] flex items-center justify-between gap-3',
        selected
          ? 'border-kz-cyan/60 bg-kz-cyan/[0.04]'
          : 'border-white/[0.07] hover:border-kz-cyan/30 hover:bg-white/[0.02]'
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="kz-mono text-[13px] font-bold text-white tracking-wider mb-1.5 truncate">
          {project.name}
        </div>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="kz-mono text-[9px] text-white/25 tracking-widest">{createdDate}</span>
          <span className="text-white/10 text-[9px]">·</span>
          <span className="kz-mono text-[9px] text-white/25 tracking-widest">
            {project.daily_sponsored_tx_limit.toLocaleString()} TX/DAY
          </span>
        </div>
        <span className="kz-mono text-[8px] text-kz-cyan/40 bg-kz-cyan/[0.06] border border-kz-cyan/[0.12] rounded px-1.5 py-0.5 tracking-wider truncate max-w-[220px] inline-block">
          {project.integrator_id_hex}
        </span>
      </div>

      {/* Radio */}
      <div
        className={cn(
          'w-[18px] h-[18px] rounded-full border-[1.5px] flex items-center justify-center flex-shrink-0 transition-colors',
          selected ? 'border-kz-cyan' : 'border-white/15'
        )}
      >
        <div
          className={cn(
            'w-2 h-2 rounded-full bg-kz-cyan transition-all duration-150',
            selected ? 'opacity-100 scale-100' : 'opacity-0 scale-50'
          )}
        />
      </div>
    </button>
  );
}

function SkeletonCard() {
  return (
    <div className="w-full rounded-xl border border-white/[0.07] bg-[#0d0d14] px-4 py-3.5 animate-pulse">
      <div className="h-3 w-32 bg-white/10 rounded mb-2" />
      <div className="h-2 w-48 bg-white/[0.06] rounded mb-2" />
      <div className="h-2 w-40 bg-white/[0.04] rounded" />
    </div>
  );
}

// ─── Project Picker Modal ─────────────────────────────────────────────────────

function ProjectPickerModal({
  publicKey,
  onSelect,
  onBack,
}: {
  publicKey: string;
  onSelect: (project: Project) => void;
  onBack: () => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/kakusho/integrators/by-owner/${publicKey}`)
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || 'Failed to load projects');
        }
        return res.json() as Promise<Project[]>;
      })
      .then((data) => {
        setProjects(data);
        if (data.length > 0) setSelected(data[0].id);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [publicKey]);

  const selectedProject = projects.find((p) => p.id === selected) ?? null;

  const truncatedKey = publicKey
    ? `${publicKey.slice(0, 8)}...${publicKey.slice(-6)}`
    : '';

  return (
    <div className="w-full max-w-sm">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="kz-mono text-[9px] text-kz-cyan/40 tracking-[0.2em] mb-2">
          ● WALLET VERIFIED
        </div>
        <h2 className="kz-display text-[22px] font-bold text-white tracking-tight mb-1">
          Select Project
        </h2>
        <p className="kz-mono text-[9px] text-white/25 tracking-[0.16em]">
          CHOOSE WHICH PROJECT TO ACCESS
        </p>
      </div>

      <div className="kz-panel">
        {/* Active address */}
        <div className="flex items-center gap-2 px-3 py-2.5 bg-[#0d0d14] border border-white/[0.06] rounded-lg mb-5">
          <div className="w-1.5 h-1.5 rounded-full bg-kz-cyan flex-shrink-0" />
          <span className="kz-mono text-[9px] text-white/40 tracking-wider truncate">
            {publicKey}
          </span>
        </div>

        {/* Project list */}
        {error ? (
          <div className="kz-error-box mb-5">
            <div className="flex items-start gap-2.5">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="mt-0.5 shrink-0">
                <path d="M6 1L11 11H1L6 1Z" stroke="#FF4D6A" strokeWidth="1.2" />
                <path d="M6 4.5V7M6 8.5V9" stroke="#FF4D6A" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              <span className="kz-mono text-[10px] text-kz-danger tracking-wider leading-relaxed">
                {error}
              </span>
            </div>
          </div>
        ) : loading ? (
          <div className="space-y-2.5 mb-5">
            <div className="kz-mono text-[9px] text-white/20 tracking-[0.14em] mb-3">
              LOADING PROJECTS...
            </div>
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : projects.length === 0 ? (
          <div className="py-6 text-center mb-5">
            <div className="kz-mono text-[10px] text-white/20 tracking-widest mb-3">
              NO PROJECTS FOUND
            </div>
            <p className="kz-mono text-[9px] text-white/15 tracking-wider">
              This wallet has no registered projects.
            </p>
          </div>
        ) : (
          <div className="space-y-2 mb-5">
            <div className="kz-mono text-[9px] text-white/20 tracking-[0.14em] mb-3">
              {projects.length} PROJECT{projects.length !== 1 ? 'S' : ''} FOUND
            </div>
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                selected={selected === project.id}
                onSelect={() => setSelected(project.id)}
              />
            ))}
          </div>
        )}

        <div className="h-px bg-white/[0.06] mb-5" />

        {/* Login button */}
        <button
          disabled={!selectedProject || loading}
          onClick={() => selectedProject && onSelect(selectedProject)}
          className={cn(
            'kz-btn-connect w-full py-4 relative overflow-hidden',
            (!selectedProject || loading) && 'opacity-30 cursor-not-allowed'
          )}
        >
          <div className="kz-btn-scan" />
          <span className="relative z-10 flex items-center justify-center gap-3 kz-mono text-sm tracking-[0.2em] font-bold">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <path d="M7 1L13 7L7 13M1 7H13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            LOGIN TO PROJECT
          </span>
        </button>

        {/* Register new */}
        <a
          href="/dashboard/register"
          className="block text-center kz-mono text-[9px] text-kz-cyan/35 hover:text-kz-cyan mt-3.5 tracking-[0.16em] transition-colors"
        >
          + REGISTER NEW PROJECT →
        </a>
      </div>

      {/* Back link */}
      <button
        onClick={onBack}
        className="block mx-auto mt-5 kz-mono text-[9px] text-white/20 hover:text-white/50 tracking-widest transition-colors"
      >
        ← DISCONNECT WALLET
      </button>
    </div>
  );
}

// ─── Main Login Page ───────────────────────────────────────────────────────────

export default function DashboardLoginPage() {
  const router = useRouter();

  // 'idle' → connect wallet
  // 'project-pick' → show picker
  // 'signing' / 'verifying' → auth in progress
  const [stage, setStage] = useState<'idle' | 'project-pick' | 'signing' | 'verifying'>('idle');
  const [publicKey, setPublicKey] = useState('');
  const [error, setError] = useState('');
  const [walletAvailable, setWalletAvailable] = useState<boolean | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);

  useEffect(() => {
    isConnected()
      .then((res) => setWalletAvailable(!res.error))
      .catch(() => setWalletAvailable(false));
  }, []);

  // Step 1: connect wallet → show project picker
  async function connectFreighter() {
    setError('');
    setConnectLoading(true);
    try {
      const access = await requestAccess();
      if (access.error) throw new Error(access.error.message || 'Freighter connection was rejected.');
      if (!access.address) throw new Error('No address returned by Freighter.');
      setPublicKey(access.address);
      setStage('project-pick');
    } catch (e: any) {
      setError(e.message || 'CONNECTION_FAILED');
    } finally {
      setConnectLoading(false);
    }
  }

  // Step 2: user picked a project → sign + verify
  async function loginToProject(project: Project) {
    setError('');
    try {
      setStage('signing');
      const nonceRes = await fetch(`/api/kakusho/auth/nonce?address=${publicKey}`);
      const { message } = await nonceRes.json();

      const signed = await signMessage(message, { address: publicKey });
      if (signed.error) throw new Error(signed.error.message || 'Signature request was rejected.');

      const signedMessage =
        typeof signed.signedMessage === 'string'
          ? signed.signedMessage
          : Buffer.from(signed.signedMessage as any).toString('base64');

      setStage('verifying');
      const loginRes = await fetch('/api/kakusho/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stellar_address: publicKey,
          signed_message: signedMessage,
          message,
          integrator_id: project.id,
        }),
      });

      if (!loginRes.ok) {
        const err = await loginRes.json();
        throw new Error(err.detail || 'Login failed');
      }

      const { api_key } = await loginRes.json();
      localStorage.setItem('kakusho_api_key', api_key);
      localStorage.setItem('kakusho_project_id', project.id);
      localStorage.setItem('kakusho_project_name', project.name);
      router.push('/dashboard');
    } catch (e: any) {
      setError(e.message || 'AUTH_FAILED');
      setStage('project-pick');
    }
  }

  // ── Render: project picker ────────────────────────────────────────────────
  if (stage === 'project-pick') {
    return (
      <div className="min-h-screen bg-kz-void flex items-center justify-center px-4">
        {error && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 kz-error-box max-w-sm w-full">
            <span className="kz-mono text-[10px] text-kz-danger tracking-wider">{error}</span>
          </div>
        )}
        <ProjectPickerModal
          publicKey={publicKey}
          onSelect={loginToProject}
          onBack={() => { setStage('idle'); setPublicKey(''); setError(''); }}
        />
      </div>
    );
  }

  // ── Render: signing / verifying overlay ──────────────────────────────────
  if (stage === 'signing' || stage === 'verifying') {
    const label = stage === 'signing' ? 'AWAITING_SIGNATURE...' : 'VERIFYING...';
    return (
      <div className="min-h-screen bg-kz-void flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="kz-panel">
            <div className="flex items-center justify-center gap-3 py-2">
              <span className="kz-spinner-sm" />
              <span className="kz-mono text-[12px] text-kz-cyan tracking-[0.2em] font-bold">{label}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: initial connect screen ────────────────────────────────────────
  const stepLabels: Record<string, string> = {
    connecting: 'CONNECTING...',
  };

  return (
    <div className="min-h-screen bg-kz-void flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="kz-logo-ring mx-auto mb-6" style={{ width: 72, height: 72 }}>
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" className="relative z-10">
              <circle cx="20" cy="20" r="13" stroke="#00D2FF" strokeWidth="1.1" opacity="0.5" />
              <path d="M13 20L18 25L28 13" stroke="#00D2FF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="kz-logo-pulse" />
          </div>
          <h1 className="kz-display text-2xl font-bold text-white mb-1 tracking-tight">Kakushō</h1>
          <p className="kz-mono text-[10px] text-kz-cyan/50 tracking-widest">確証 · INTEGRATOR PORTAL</p>
        </div>

        <div className="kz-panel animate-kz-rise">
          <div className="space-y-1.5 mb-8">
            {[
              { label: 'NETWORK', value: 'STELLAR / SOROBAN' },
              { label: 'WALLET', value: 'FREIGHTER' },
              { label: 'AUTH', value: 'ED25519 SIGNATURE' },
              { label: 'SESSION', value: 'API KEY SCOPED' },
            ].map(({ label, value }) => (
              <div key={label} className="kz-spec-row">
                <span className="kz-mono text-[10px] text-kz-slate tracking-widest">{label}</span>
                <div className="kz-spec-line flex-1 mx-3" />
                <span className="kz-mono text-[10px] text-kz-cyan tracking-widest">{value}</span>
              </div>
            ))}
          </div>

          {walletAvailable === false && !error && (
            <div className="kz-error-box mb-6">
              <div className="flex items-start gap-2.5">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="mt-0.5 shrink-0">
                  <path d="M6 1L11 11H1L6 1Z" stroke="#FF4D6A" strokeWidth="1.2" />
                  <path d="M6 4.5V7M6 8.5V9" stroke="#FF4D6A" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                <span className="kz-mono text-[10px] text-kz-danger leading-relaxed tracking-wider">
                  NO_WALLET — Install Freighter wallet (freighter.app) to continue.
                </span>
              </div>
            </div>
          )}

          {error && (
            <div className="kz-error-box mb-6">
              <div className="flex items-start gap-2.5">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="mt-0.5 shrink-0">
                  <path d="M6 1L11 11H1L6 1Z" stroke="#FF4D6A" strokeWidth="1.2" />
                  <path d="M6 4.5V7M6 8.5V9" stroke="#FF4D6A" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                <span className="kz-mono text-[10px] text-kz-danger leading-relaxed tracking-wider">{error}</span>
              </div>
            </div>
          )}

          <button
            onClick={connectFreighter}
            disabled={connectLoading || walletAvailable === false}
            className={cn('kz-btn-connect w-full py-4 relative overflow-hidden', connectLoading && 'kz-btn-loading')}
          >
            <div className="kz-btn-scan" />
            <span className="relative z-10 flex items-center justify-center gap-3 kz-mono text-sm tracking-[0.2em] font-bold">
              {connectLoading ? (
                <><span className="kz-spinner-sm" />CONNECTING...</>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <rect x="2" y="4" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M5 4V3a3 3 0 016 0v1" stroke="currentColor" strokeWidth="1.2" />
                    <circle cx="8" cy="9" r="1.5" fill="currentColor" />
                  </svg>
                  CONNECT FREIGHTER
                </>
              )}
            </span>
          </button>

          {walletAvailable === false && (
            <a
              href="https://www.freighter.app/"
              target="_blank"
              rel="noreferrer"
              className="block text-center kz-mono text-[9px] text-kz-cyan/60 hover:text-kz-cyan mt-3 tracking-widest transition-colors"
            >
              GET FREIGHTER →
            </a>
          )}

          <p className="kz-mono text-[9px] text-center text-kz-cyan/25 mt-5 tracking-widest">
            SIGN ONCE · GASLESS · YOUR KEY NEVER LEAVES YOUR DEVICE
          </p>
        </div>

        <p className="kz-mono text-[9px] text-center text-kz-slate/50 mt-6 tracking-widest">
          DON'T HAVE AN ACCOUNT?{' '}
          <a href="/dashboard/register" className="text-kz-cyan/60 hover:text-kz-cyan transition-colors">
            REGISTER →
          </a>
        </p>
      </div>
    </div>
  );
}