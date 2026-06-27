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

const ISO_COUNTRIES: { name: string; code: number }[] = [
  { name: 'Afghanistan', code: 4 },
  { name: 'Albania', code: 8 },
  { name: 'Algeria', code: 12 },
  { name: 'Andorra', code: 20 },
  { name: 'Angola', code: 24 },
  { name: 'Argentina', code: 32 },
  { name: 'Armenia', code: 51 },
  { name: 'Australia', code: 36 },
  { name: 'Austria', code: 40 },
  { name: 'Azerbaijan', code: 31 },
  { name: 'Bahrain', code: 48 },
  { name: 'Bangladesh', code: 50 },
  { name: 'Belarus', code: 112 },
  { name: 'Belgium', code: 56 },
  { name: 'Benin', code: 204 },
  { name: 'Bolivia', code: 68 },
  { name: 'Bosnia and Herzegovina', code: 70 },
  { name: 'Brazil', code: 76 },
  { name: 'Bulgaria', code: 100 },
  { name: 'Burkina Faso', code: 854 },
  { name: 'Cambodia', code: 116 },
  { name: 'Cameroon', code: 120 },
  { name: 'Canada', code: 124 },
  { name: 'Chad', code: 148 },
  { name: 'Chile', code: 152 },
  { name: 'China', code: 156 },
  { name: 'Colombia', code: 170 },
  { name: 'Congo (DRC)', code: 180 },
  { name: 'Congo (Republic)', code: 178 },
  { name: 'Costa Rica', code: 188 },
  { name: 'Croatia', code: 191 },
  { name: 'Cuba', code: 192 },
  { name: 'Cyprus', code: 196 },
  { name: 'Czech Republic', code: 203 },
  { name: 'Denmark', code: 208 },
  { name: 'Ecuador', code: 218 },
  { name: 'Egypt', code: 818 },
  { name: 'El Salvador', code: 222 },
  { name: 'Estonia', code: 233 },
  { name: 'Ethiopia', code: 231 },
  { name: 'Finland', code: 246 },
  { name: 'France', code: 250 },
  { name: 'Georgia', code: 268 },
  { name: 'Germany', code: 276 },
  { name: 'Ghana', code: 288 },
  { name: 'Greece', code: 300 },
  { name: 'Guatemala', code: 320 },
  { name: 'Guinea', code: 324 },
  { name: 'Honduras', code: 340 },
  { name: 'Hungary', code: 348 },
  { name: 'India', code: 356 },
  { name: 'Indonesia', code: 360 },
  { name: 'Iran', code: 364 },
  { name: 'Iraq', code: 368 },
  { name: 'Ireland', code: 372 },
  { name: 'Israel', code: 376 },
  { name: 'Italy', code: 380 },
  { name: 'Jamaica', code: 388 },
  { name: 'Japan', code: 392 },
  { name: 'Jordan', code: 400 },
  { name: 'Kazakhstan', code: 398 },
  { name: 'Kenya', code: 404 },
  { name: 'Kosovo', code: 383 },
  { name: 'Kuwait', code: 414 },
  { name: 'Kyrgyzstan', code: 417 },
  { name: 'Laos', code: 418 },
  { name: 'Latvia', code: 428 },
  { name: 'Lebanon', code: 422 },
  { name: 'Libya', code: 434 },
  { name: 'Lithuania', code: 440 },
  { name: 'Luxembourg', code: 442 },
  { name: 'Malaysia', code: 458 },
  { name: 'Mali', code: 466 },
  { name: 'Mexico', code: 484 },
  { name: 'Moldova', code: 498 },
  { name: 'Mongolia', code: 496 },
  { name: 'Morocco', code: 504 },
  { name: 'Mozambique', code: 508 },
  { name: 'Myanmar', code: 104 },
  { name: 'Nepal', code: 524 },
  { name: 'Netherlands', code: 528 },
  { name: 'New Zealand', code: 554 },
  { name: 'Nicaragua', code: 558 },
  { name: 'Niger', code: 562 },
  { name: 'Nigeria', code: 566 },
  { name: 'North Korea', code: 408 },
  { name: 'North Macedonia', code: 807 },
  { name: 'Norway', code: 578 },
  { name: 'Oman', code: 512 },
  { name: 'Pakistan', code: 586 },
  { name: 'Palestine', code: 275 },
  { name: 'Panama', code: 591 },
  { name: 'Paraguay', code: 600 },
  { name: 'Peru', code: 604 },
  { name: 'Philippines', code: 608 },
  { name: 'Poland', code: 616 },
  { name: 'Portugal', code: 620 },
  { name: 'Qatar', code: 634 },
  { name: 'Romania', code: 642 },
  { name: 'Russia', code: 643 },
  { name: 'Rwanda', code: 646 },
  { name: 'Saudi Arabia', code: 682 },
  { name: 'Senegal', code: 686 },
  { name: 'Serbia', code: 688 },
  { name: 'Sierra Leone', code: 694 },
  { name: 'Singapore', code: 702 },
  { name: 'Slovakia', code: 703 },
  { name: 'Slovenia', code: 705 },
  { name: 'Somalia', code: 706 },
  { name: 'South Africa', code: 710 },
  { name: 'South Korea', code: 410 },
  { name: 'South Sudan', code: 728 },
  { name: 'Spain', code: 724 },
  { name: 'Sri Lanka', code: 144 },
  { name: 'Sudan', code: 729 },
  { name: 'Sweden', code: 752 },
  { name: 'Switzerland', code: 756 },
  { name: 'Syria', code: 760 },
  { name: 'Taiwan', code: 158 },
  { name: 'Tajikistan', code: 762 },
  { name: 'Tanzania', code: 834 },
  { name: 'Thailand', code: 764 },
  { name: 'Tunisia', code: 788 },
  { name: 'Turkey', code: 792 },
  { name: 'Turkmenistan', code: 795 },
  { name: 'Uganda', code: 800 },
  { name: 'Ukraine', code: 804 },
  { name: 'United Arab Emirates', code: 784 },
  { name: 'United Kingdom', code: 826 },
  { name: 'United States', code: 840 },
  { name: 'Uruguay', code: 858 },
  { name: 'Uzbekistan', code: 860 },
  { name: 'Venezuela', code: 862 },
  { name: 'Vietnam', code: 704 },
  { name: 'Yemen', code: 887 },
  { name: 'Zambia', code: 894 },
  { name: 'Zimbabwe', code: 716 },
];

interface TreeResult {
  root: string;
  pairs: { low: number; high: number; pathElements: string[]; pathIndices: number[] }[];
}

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
  const [apiKey] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('kakusho_api_key') || '' : ''
  );
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
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

  // Filtered dropdown list — excludes already-selected, matches name or numeric code
  const filteredCountries = ISO_COUNTRIES.filter(
    (c) =>
      !selected.has(c.code) &&
      (c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.code.toString().includes(search))
  ).slice(0, 30);

  function toggle(code: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
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

  // Resolve a code to a display name (preset list or ISO list, fallback to raw code)
  function resolveName(code: number): string {
    const preset = ALL_PRESETS.find((p) => p.code === code);
    if (preset) return preset.name;
    const iso = ISO_COUNTRIES.find((c) => c.code === code);
    if (iso) return iso.name;
    return `Code ${code}`;
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

  const rootHex = tree ? BigInt(tree.root).toString(16).padStart(64, '0') : '';

  return (
    <div className="min-h-screen bg-kz-void">
      <nav className="border-b border-kz-surfaceLine px-6 py-4 flex items-center gap-4">
        <Link
          href="/dashboard"
          className="kz-mono text-[9px] text-kz-cyan/40 hover:text-kz-cyan tracking-widest transition-colors"
        >
          ← DASHBOARD
        </Link>
        <span className="kz-mono text-[9px] text-white/20">/</span>
        <span className="kz-mono text-[9px] text-white/60 tracking-widest">COUNTRY_TREE</span>
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="mb-8">
          <p className="kz-mono text-[9px] text-kz-cyan/50 tracking-widest mb-2">COMPLIANCE</p>
          <h1 className="kz-display text-3xl font-bold text-white tracking-tight">
            Country Restrictions
          </h1>
          <p className="kz-mono text-[10px] text-kz-slate mt-2 tracking-wide">
            Build a Merkle tree of blocked nationalities. The root gets anchored on-chain — users
            prove membership or exclusion without revealing their nationality.
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

            {/* Custom selected codes not in presets — now resolved via ISO list too */}
            {Array.from(selected)
              .filter((c) => !ALL_PRESETS.find((p) => p.code === c))
              .map((code) => (
                <button
                  key={code}
                  onClick={() => toggle(code)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-kz-danger/50 text-kz-danger bg-kz-danger/5 kz-mono text-[9px] tracking-widest transition-colors"
                >
                  <span>✕</span>
                  <span>{resolveName(code)}</span>
                  <span className="text-[8px] opacity-50">({code})</span>
                </button>
              ))}
          </div>
        </div>

        {/* Country search dropdown */}
        <div className="kz-panel mb-6">
          <p className="kz-mono text-[9px] tracking-widest text-kz-slate mb-3">ADD_COUNTRY</p>
          <div className="relative">
            <div className="flex items-center gap-2 bg-kz-voidRaised border border-kz-surfaceLine rounded-lg px-4 py-3 focus-within:border-kz-cyan/50 transition-colors">
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                className="shrink-0 text-kz-cyan/40"
              >
                <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.2" />
                <path
                  d="M8 8L10.5 10.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setDropdownOpen(true); }}
                onFocus={() => setDropdownOpen(true)}
                placeholder="Search country name or ISO numeric code..."
                className="flex-1 bg-transparent kz-mono text-sm text-white placeholder-white/20 focus:outline-none"
              />
              {search && (
                <button
                  onClick={() => { setSearch(''); setDropdownOpen(false); }}
                  className="kz-mono text-[10px] text-white/30 hover:text-white/60 transition-colors"
                >
                  ✕
                </button>
              )}
            </div>

            {dropdownOpen && search.length > 0 && (
              <>
                {/* Backdrop */}
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => { setDropdownOpen(false); }}
                />
                <div className="absolute z-20 w-full mt-1 bg-kz-voidRaised border border-kz-surfaceLine rounded-lg overflow-hidden shadow-xl">
                  {filteredCountries.length === 0 ? (
                    <div className="px-4 py-3 kz-mono text-[10px] text-white/30 tracking-widest">
                      NO_MATCH — try a name or numeric code
                    </div>
                  ) : (
                    <div className="max-h-52 overflow-y-auto">
                      {filteredCountries.map(({ name, code }) => (
                        <button
                          key={code}
                          onClick={() => {
                            toggle(code);
                            setSearch('');
                            setDropdownOpen(false);
                          }}
                          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-kz-cyan/5 transition-colors text-left"
                        >
                          <span className="kz-mono text-[11px] text-white/80 tracking-wide">
                            {name}
                          </span>
                          <span className="kz-mono text-[9px] text-white/30 tracking-widest">
                            {code}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
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
              <>
                <span className="kz-spinner-sm" />
                COMPUTING MERKLE TREE...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.2" />
                  <path
                    d="M4 7L6 9L10 5"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
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
                  className={cn(
                    'kz-mono text-[9px] tracking-widest transition-colors',
                    rootCopied ? 'text-kz-cyan' : 'text-white/30 hover:text-white/60'
                  )}
                >
                  {rootCopied ? '✓ COPIED' : 'COPY HEX'}
                </button>
              </div>
              <div className="bg-kz-voidRaised rounded-lg p-4">
                <p className="kz-mono text-[10px] text-white/70 break-all leading-relaxed">
                  {rootHex}
                </p>
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
                  className={cn(
                    'kz-mono text-[9px] tracking-widest transition-colors',
                    treeCopied ? 'text-kz-cyan' : 'text-white/30 hover:text-white/60'
                  )}
                >
                  {treeCopied ? '✓ COPIED' : 'COPY JSON'}
                </button>
              </div>
              <p className="kz-mono text-[9px] text-white/20 leading-relaxed tracking-widest">
                HOST THIS JSON on your CDN. Pass it as{' '}
                <span className="text-kz-cyan/40">integratorAssets.restrictedTree</span> when
                initialising the SDK.
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
              {updating ? (
                <>
                  <span className="kz-spinner-sm mr-2" />
                  UPDATING ON-CHAIN...
                </>
              ) : updated ? (
                '✓ RESTRICTED_ROOT UPDATED ON-CHAIN'
              ) : (
                'UPDATE RESTRICTED_ROOT ON-CHAIN'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}