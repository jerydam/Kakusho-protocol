'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import Link from 'next/link';

// ISO 3166-1 numeric codes for common sanctioned/restricted jurisdictions
const PRESET_GROUPS: { label: string; codes: { name: string; code: number }[] }[] = [
  {
    label: 'OFAC_SANCTIONED',
    codes: [
      { name: 'North Korea', code: 408 },
      { name: 'Iran', code: 364 },
      { name: 'Syria', code: 760 },
      { name: 'Cuba', code: 192 },
      { name: 'Russia', code: 643 },
      { name: 'Belarus', code: 112 },
    ],
  },
  {
    label: 'FATF_HIGH_RISK',
    codes: [
      { name: 'Myanmar', code: 104 },
      { name: 'Yemen', code: 887 },
      { name: 'Mali', code: 466 },
      { name: 'Sudan', code: 729 },
    ],
  },
];

const ALL_PRESETS = PRESET_GROUPS.flatMap((g) => g.codes);

interface TreeResult {
  root: string;
  pairs: { low: number; high: number; pathElements: string[]; pathIndices: number[] }[];
}

// Inline poseidon-lite hash (deterministic, matches build_restricted_tree.js)
// For the browser we call our API route which runs the actual Node.js script
async function buildTree(codes: number[]): Promise<TreeResult> {
  const res = await fetch('/api/kakusho/build-tree', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codes }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || 'Tree build failed');
  return res.json();
}

export default function CountriesPage() {
  const router = useRouter();
  const [apiKey] = useState(() => typeof window !== 'undefined' ? localStorage.getItem('kakusho_api_key') || '' : '');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [customCode, setCustomCode] = useState('');
  const [building, setBuilding] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [tree, setTree] = useState<TreeResult | null>(null);
  const [rootCopied, setRootCopied] = useState(false);
  const [treeCopied, setTreeCopied] = useState(false);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState(false);

  useEffect(() => {
    if (!apiKey) router.push('/dashboard/login');
  }, [apiKey]);

  function toggle(code: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
    setTree(null);
  }

  function addCustom() {
    const code = parseInt(customCode.trim(), 10);
    if (isNaN(code) || code < 1 || code > 999) {
      setError('INVALID_CODE — Must be 1–999 (ISO 3166-1 numeric)');
      return;
    }
    setSelected((prev) => new Set([...prev, code]));
    setCustomCode('');
    setError('');
    setTree(null);
  }

  function selectGroup(codes: { code: number }[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      codes.forEach((c) => next.add(c.code));
      return next;
    });
    setTree(null);
  }

  async function build() {
    if (selected.size === 0) { setError('SELECT_AT_LEAST_ONE'); return; }
    setError('');
    setBuilding(true);
    try {
      const result = await buildTree(Array.from(selected));
      setTree(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBuilding(false);
    }
  }

  async function updateOnChain() {
    if (!tree) return;
    setUpdating(true);
    setError('');
    try {
      const rootHexForChain = BigInt(tree.root).toString(16).padStart(64, '0');
      const res = await fetch('/api/kakusho/update-root', {
        method: 'POST',
        headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ restricted_root: rootHexForChain }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || 'Update failed');
      setUpdated(true);
      setTimeout(() => setUpdated(false), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUpdating(false);
    }
  }

  function copy(text: string, setFn: (v: boolean) => void) {
    navigator.clipboard.writeText(text);
    setFn(true);
    setTimeout(() => setFn(false), 2000);
  }

  // Convert decimal root to hex for display
  const rootHex = tree ? BigInt(tree.root).toString(16).padStart(64, '0') : '';

  return (
    <div className="min-h-screen bg-kz-void">
      <nav className="border-b border-kz-surfaceLine px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="kz-mono text-[9px] text-kz-cyan/40 hover:text-kz-cyan tracking-widest transition-colors">
          ← DASHBOARD
        </Link>
        <span className="kz-mono text-[9px] text-white/20">/</span>
        <span className="kz-mono text-[9px] text-white/60 tracking-widest">COUNTRY_TREE</span>
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="mb-8">
          <p className="kz-mono text-[9px] text-kz-cyan/50 tracking-widest mb-2">COMPLIANCE</p>
          <h1 className="kz-display text-3xl font-bold text-white tracking-tight">Country Restrictions</h1>
          <p className="kz-mono text-[10px] text-kz-slate mt-2 tracking-wide">
            Build a Merkle tree of blocked nationalities. The root gets anchored on-chain — users prove membership or exclusion without revealing their nationality.
          </p>
        </div>

        {/* Preset groups */}
        <div className="kz-panel mb-6">
          <div className="flex items-center justify-between mb-4">
            <p className="kz-mono text-[9px] tracking-widest text-kz-slate">PRESET_LISTS</p>
            <button
              onClick={() => { setSelected(new Set()); setTree(null); }}
              className="kz-mono text-[9px] text-white/30 hover:text-white/60 tracking-widest transition-colors"
            >
              CLEAR ALL
            </button>
          </div>
          <div className="flex gap-2 mb-5">
            {PRESET_GROUPS.map((g) => (
              <button
                key={g.label}
                onClick={() => selectGroup(g.codes)}
                className="border border-kz-surfaceLine rounded-lg px-3 py-2 kz-mono text-[9px] tracking-widest text-kz-cyan/60 hover:text-kz-cyan hover:border-kz-cyan/40 transition-colors"
              >
                + {g.label}
              </button>
            ))}
          </div>

          {/* Country chips */}
          <div className="flex flex-wrap gap-2">
            {ALL_PRESETS.map(({ name, code }) => (
              <button
                key={code}
                onClick={() => toggle(code)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded border kz-mono text-[9px] tracking-widest transition-colors',
                  selected.has(code)
                    ? 'border-kz-danger/50 text-kz-danger bg-kz-danger/5'
                    : 'border-kz-surfaceLine text-kz-slate hover:border-kz-cyan/30 hover:text-white'
                )}
              >
                {selected.has(code) && <span>✕</span>}
                <span>{name}</span>
                <span className="text-[8px] opacity-50">({code})</span>
              </button>
            ))}

            {/* Custom selected codes not in presets */}
            {Array.from(selected)
              .filter((c) => !ALL_PRESETS.find((p) => p.code === c))
              .map((code) => (
                <button
                  key={code}
                  onClick={() => toggle(code)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-kz-danger/50 text-kz-danger bg-kz-danger/5 kz-mono text-[9px] tracking-widest transition-colors"
                >
                  <span>✕</span>
                  <span>Code {code}</span>
                </button>
              ))}
          </div>
        </div>

        {/* Custom code input */}
        <div className="kz-panel mb-6">
          <p className="kz-mono text-[9px] tracking-widest text-kz-slate mb-3">ADD_CUSTOM_CODE</p>
          <div className="flex gap-2">
            <input
              type="number"
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustom()}
              placeholder="e.g. 356 (India)"
              min={1} max={999}
              className="flex-1 bg-kz-voidRaised border border-kz-surfaceLine rounded-lg px-4 py-3 kz-mono text-sm text-white placeholder-white/20 focus:outline-none focus:border-kz-cyan/50 transition-colors"
            />
            <button
              onClick={addCustom}
              className="border border-kz-surfaceLine rounded-lg px-4 kz-mono text-[10px] tracking-widest text-kz-cyan/60 hover:text-kz-cyan hover:border-kz-cyan/40 transition-colors"
            >
              ADD
            </button>
          </div>
          <p className="kz-mono text-[9px] text-white/20 mt-2 tracking-widest">
            ISO 3166-1 NUMERIC · {selected.size} SELECTED
          </p>
        </div>

        {error && (
          <div className="kz-error-box mb-6">
            <span className="kz-mono text-[10px] text-kz-danger tracking-wider">{error}</span>
          </div>
        )}

        {/* Build button */}
        <button
          onClick={build}
          disabled={building || selected.size === 0}
          className="kz-btn-connect w-full py-4 mb-6 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <div className="kz-btn-scan" />
          <span className="relative z-10 flex items-center justify-center gap-3 kz-mono text-sm tracking-[0.2em] font-bold">
            {building ? (
              <><span className="kz-spinner-sm" />COMPUTING MERKLE TREE...</>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M4 7L6 9L10 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                BUILD TREE ({selected.size} COUNTRIES)
              </>
            )}
          </span>
        </button>

        {/* Result */}
        {tree && (
          <div className="space-y-4">
            <div className="kz-panel border-kz-cyan/20">
              <div className="flex items-center justify-between mb-3">
                <p className="kz-mono text-[9px] tracking-widest text-kz-cyan">MERKLE_ROOT</p>
                <button
                  onClick={() => copy(rootHex, setRootCopied)}
                  className={cn('kz-mono text-[9px] tracking-widest transition-colors',
                    rootCopied ? 'text-kz-cyan' : 'text-white/30 hover:text-white/60'
                  )}
                >
                  {rootCopied ? '✓ COPIED' : 'COPY HEX'}
                </button>
              </div>
              <div className="bg-kz-voidRaised rounded-lg p-4">
                <p className="kz-mono text-[10px] text-white/70 break-all leading-relaxed">{rootHex}</p>
              </div>
              <p className="kz-mono text-[9px] text-white/20 mt-2 tracking-widest">
                {tree.pairs.length} PAIRS · USE THIS AS restricted_root ON-CHAIN
              </p>
            </div>

            <div className="kz-panel">
              <div className="flex items-center justify-between mb-3">
                <p className="kz-mono text-[9px] tracking-widest text-kz-slate">TREE_JSON</p>
                <button
                  onClick={() => copy(JSON.stringify(tree, null, 2), setTreeCopied)}
                  className={cn('kz-mono text-[9px] tracking-widest transition-colors',
                    treeCopied ? 'text-kz-cyan' : 'text-white/30 hover:text-white/60'
                  )}
                >
                  {treeCopied ? '✓ COPIED' : 'COPY JSON'}
                </button>
              </div>
              <p className="kz-mono text-[9px] text-white/20 leading-relaxed tracking-widest">
                HOST THIS JSON on your CDN. Pass it as <span className="text-kz-cyan/40">integratorAssets.restrictedTree</span> when initialising the SDK.
              </p>
            </div>

            <button
              onClick={updateOnChain}
              disabled={updating}
              className={cn(
                'w-full border rounded-lg py-4 kz-mono text-sm tracking-widest font-bold transition-colors',
                updated
                  ? 'border-kz-cyan text-kz-cyan bg-kz-cyan/5'
                  : 'border-kz-cyan/30 text-kz-cyan/70 hover:border-kz-cyan hover:text-kz-cyan'
              )}
            >
              {updating
                ? <><span className="kz-spinner-sm mr-2" />UPDATING ON-CHAIN...</>
                : updated
                  ? '✓ RESTRICTED_ROOT UPDATED ON-CHAIN'
                  : 'UPDATE RESTRICTED_ROOT ON-CHAIN'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}