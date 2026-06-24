'use client';

import Link from 'next/link';
import { Shield, Lock, FileText, Camera, Box, Terminal, Check } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-kz-void selection:bg-kz-cyan/30 overflow-hidden">
      {/* Navigation */}
      <nav className="border-b border-kz-surfaceLine bg-kz-void/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2.5">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="7" stroke="#00D2FF" strokeWidth="1" opacity="0.6" />
                <circle cx="10" cy="10" r="2.2" fill="#00D2FF" />
              </svg>
              <span className="kz-mono text-white font-bold tracking-widest text-sm">KAKUSHŌ</span>
            </div>
            <div className="hidden md:flex items-center gap-6 kz-mono text-xs text-kz-slate">
              <Link href="#protocol" className="hover:text-white transition-colors uppercase">Protocol</Link>
              <Link href="#widget" className="hover:text-white transition-colors uppercase">Widget</Link>
              <Link href="/dashboard/docs" className="hover:text-white transition-colors uppercase">Docs</Link>
              <Link href="/dashboard" className="hover:text-white transition-colors uppercase">Dashboard</Link>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="hidden sm:flex items-center gap-2 kz-mono text-xs text-kz-slate">
              <div className="w-2 h-2 rounded-full bg-kz-mint animate-pulse" />
              TESTNET LIVE
            </div>
            <Link href="/dashboard/register" className="kz-btn-primary py-2 px-4">
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-24 pb-20 px-6 max-w-7xl mx-auto grid lg:grid-cols-2 gap-16 items-center">
        {/* ambient cosmic glow */}
        <div className="absolute -top-40 left-1/3 w-[600px] h-[600px] rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(41,98,255,0.12) 0%, transparent 70%)' }} />

        <div className="relative z-10">
          <div className="kz-mono text-[10px] text-kz-cyan tracking-[0.2em] mb-8 uppercase flex items-center gap-4">
            <div className="h-px w-8 bg-kz-cyan" />
            確証 · Zero-Knowledge Identity Protocol
          </div>
          <h1 className="text-6xl md:text-7xl font-bold text-white leading-[1.1] mb-6 tracking-tight kz-display">
            Identity <br />
            proven, <br />
            <span style={{ background: 'linear-gradient(135deg, #00D2FF, #2962FF)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
              not <br />revealed.
            </span>
          </h1>
          <p className="text-kz-slate text-lg max-w-md leading-relaxed mb-10">
            Wallet-native KYC for Stellar with ZK-proof issuance. Identity is verified on-chain without exposing sensitive data — only a cryptographic proof that you are who you say you are.
          </p>
          <div className="flex items-center gap-4">
            <Link href="/dashboard/register" className="kz-btn-primary">
              <Shield className="w-4 h-4" /> Start KYC
            </Link>
            <Link href="#protocol" className="kz-btn-secondary">
              {'</>'} View Protocol
            </Link>
          </div>
        </div>

        {/* Terminal Window — proof generation, the signature moment */}
        <div className="relative z-10 kz-panel p-0 overflow-hidden kz-mono text-sm leading-relaxed">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-kz-surfaceLine bg-kz-voidRaised">
            <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
            <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
            <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
            <span className="ml-4 text-xs text-kz-slate/60">KAKUSHŌ-VERIFY@SOROBAN</span>
          </div>
          <div className="p-6 space-y-3">
            <div className="text-kz-cyan flex gap-3">
              <span>$</span> <span>kakusho verify --stellar GACZ...9F4K</span>
            </div>
            <div className="text-kz-slate pl-5">→ fetching nonce... <span className="text-kz-cyan">done</span></div>
            <div className="text-kz-slate pl-5">→ signing message... <span className="text-kz-cyan">done</span></div>
            <div className="text-kz-slate pl-5">→ reading document (OCR)... <span className="text-kz-cyan">done</span></div>
            <div className="text-kz-slate pl-5">→ liveness check [4/4]... <span className="text-kz-cyan">done</span></div>
            <div className="text-kz-slate pl-5">→ generating zk-proof...</div>
            <div className="text-kz-cyan/70 pl-5">π = [0x4fa8...e12c, 0x7b3d...9f01]</div>
            <div className="text-kz-slate pl-5">→ relaying to Soroban... <span className="text-kz-cyan">done</span></div>
            <div className="flex items-center gap-3 mt-4 text-kz-mint">
              <Check className="w-4 h-4" /> IDENTITY VERIFIED <span className="text-kz-slate/50 text-xs ml-2">ledger #52,108,471</span>
            </div>
            <div className="text-kz-cyan animate-pulse">█</div>
          </div>
          <div className="border-t border-kz-surfaceLine p-4 bg-kz-voidRaised flex items-start gap-3">
            <Lock className="w-4 h-4 text-kz-cyan mt-0.5 shrink-0" />
            <div>
              <p className="text-kz-cyan text-xs font-semibold mb-1">Groth16 Proof Attached</p>
              <p className="text-kz-slate text-xs">Personal data never leaves the device. Only the proof lives on-chain.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Divider */}
      <div className="border-y border-kz-surfaceLine bg-kz-voidRaised">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 divide-x divide-kz-surfaceLine">
          {[
            { value: '4,382', label: 'Identities Verified' },
            { value: '<2s', label: 'Proof Gen Time' },
            { value: '0 bytes', label: 'PII On-Chain' },
            { value: 'Soroban', label: 'Settlement Layer' },
          ].map((stat, i) => (
            <div key={i} className="py-10 px-6 flex flex-col items-center text-center">
              <span className="text-kz-cyan text-4xl kz-mono font-bold mb-2">{stat.value}</span>
              <span className="text-kz-slate text-xs kz-mono uppercase tracking-widest">{stat.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Protocol Grid */}
      <section id="protocol" className="py-24 px-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-4 mb-12 border-b border-kz-surfaceLine pb-6">
          <div className="kz-icon-frame" style={{ width: 36, height: 36 }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5" stroke="#00D2FF" strokeWidth="1.1" />
              <circle cx="7" cy="7" r="1.4" fill="#00D2FF" />
            </svg>
          </div>
          <h2 className="text-3xl font-bold text-white kz-display">Core Protocol</h2>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {[
            { icon: Shield, title: 'Wallet-native auth', desc: 'Sign-in with Freighter. No passwords, no email. Your Stellar wallet IS your identity.' },
            { icon: Lock, title: 'Client-side proving', desc: 'Document OCR and liveness checks run entirely in-browser. Groth16 proofs are generated on-device — raw data never transmits.' },
            { icon: Terminal, title: '1-line embed', desc: 'Drop the SDK widget into any dApp. It automatically checks and displays KYC status against your integrator rules.' },
            { icon: FileText, title: 'Multi-doc support', desc: "Passport, national ID, driver's license. OCR field extraction with live validation before proving starts." },
            { icon: Camera, title: '4-pose liveness', desc: 'Real-time face detection with left, right, up, down pose capture. Anti-spoofing built into the circuit itself.' },
            { icon: Box, title: 'On-chain anchoring', desc: 'Only the proof and a nullifier settle on Soroban. Restricted-country and age predicates verify without revealing the underlying value.' },
          ].map((feature, i) => (
            <div key={i} className="kz-panel group hover:border-kz-cyan/30 transition-colors">
              <div className="kz-icon-frame mb-6">
                <feature.icon className="w-5 h-5 text-kz-cyan" />
              </div>
              <h3 className="text-white kz-mono font-semibold mb-3 text-sm tracking-wide">{feature.title}</h3>
              <p className="text-kz-slate text-sm leading-relaxed">{feature.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Closing CTA — orbit signature */}
      <section className="relative py-24 px-6 max-w-3xl mx-auto text-center">
        <div className="kz-logo-ring mx-auto mb-8" style={{ width: 88, height: 88 }}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="relative z-10">
            <circle cx="24" cy="24" r="16" stroke="#00D2FF" strokeWidth="1" opacity="0.5" />
            <path d="M16 24L21 29L33 16" stroke="#00D2FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="kz-logo-pulse" />
        </div>
        <h2 className="kz-display text-3xl font-bold text-white mb-4 tracking-tight">
          Conclusive proof. Zero exposure.
        </h2>
        <p className="text-kz-slate mb-10 max-w-md mx-auto leading-relaxed">
          Register an integrator and deploy your KYC rules on Soroban in minutes.
        </p>
        <Link href="/dashboard/register" className="kz-btn-primary inline-flex">
          <Shield className="w-4 h-4" /> Register Integrator
        </Link>
      </section>
    </div>
  );
}