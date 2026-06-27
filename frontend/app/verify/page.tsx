'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { generateKycProof, submitProof } from '@kakusho/zk-kyc-sdk';

type Stage =
  | 'loading_integrator'
  | 'already_verified'
  | 'connect_wallet'
  | 'capture_document'
  | 'capture_selfies'
  | 'generating_proof'
  | 'submitting'
  | 'done'
  | 'error';

type ProofStage = 'ocr' | 'liveness' | 'fetching_wasm' | 'fetching_zkey' | 'computing_witness' | 'generating_proof' | 'done';

interface IntegratorInfo {
  name: string;
  integrator_id_hex: string;
  min_age_years: number;
  doc_max_age_years: number;
  restricted_countries: string[];
}

interface Selfie {
  pose: 'left' | 'right' | 'up' | 'down';
  label: string;
  file: File | null;
  preview: string | null;
}

const PROOF_STAGE_LABELS: Record<ProofStage, string> = {
  ocr: 'Reading document fields...',
  liveness: 'Verifying liveness poses...',
  fetching_wasm: 'Loading circuit (WASM)...',
  fetching_zkey: 'Fetching proving key (~13 MB)...',
  computing_witness: 'Building ZK witness...',
  generating_proof: 'Generating Groth16 proof...',
  done: 'Proof ready',
};

const PROOF_STAGE_ORDER: ProofStage[] = [
  'ocr', 'liveness', 'fetching_wasm', 'fetching_zkey', 'computing_witness', 'generating_proof', 'done',
];

const SELFIE_POSES: Selfie[] = [
  { pose: 'left', label: 'LOOK LEFT', file: null, preview: null },
  { pose: 'right', label: 'LOOK RIGHT', file: null, preview: null },
  { pose: 'up', label: 'LOOK UP', file: null, preview: null },
  { pose: 'down', label: 'LOOK DOWN', file: null, preview: null },
];

// ── Camera hook ───────────────────────────────────────────────────────────────

function useCamera(active: boolean, facingMode: 'user' | 'environment' = 'environment') {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => setReady(true);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Camera access denied');
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      setReady(false);
    };
  }, [active, facingMode]);

  function capture(): File | null {
    if (!videoRef.current || !ready) return null;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext('2d')!.drawImage(videoRef.current, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const blob = dataURLtoBlob(dataUrl);
    return new File([blob], 'capture.jpg', { type: 'image/jpeg' });
  }

  return { videoRef, ready, error, capture };
}

function dataURLtoBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)![1];
  const binary = atob(data);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// ── UI primitives ─────────────────────────────────────────────────────────────

function KzSpinner({ sm }: { sm?: boolean }) {
  const s = sm ? 14 : 22;
  return (
    <svg width={s} height={s} viewBox="0 0 22 22" fill="none" className="animate-spin shrink-0">
      <circle cx="11" cy="11" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.2" />
      <path d="M11 2A9 9 0 0 1 20 11" stroke="#00D2FF" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function StepDot({ active, done, index }: { active: boolean; done: boolean; index: number }) {
  return (
    <div
      className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all duration-300"
      style={{
        background: done ? '#00D2FF14' : active ? '#00D2FF0A' : 'transparent',
        border: `1px solid ${done ? '#00D2FF60' : active ? '#00D2FF40' : '#ffffff18'}`,
      }}
    >
      {done ? (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 5L4 7L8 3" stroke="#00D2FF" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      ) : (
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: active ? '#00D2FF' : '#ffffff30' }}>
          {String(index).padStart(2, '0')}
        </span>
      )}
    </div>
  );
}

// ── Document capture step ─────────────────────────────────────────────────────

function DocumentCapture({ onCapture }: { onCapture: (file: File) => void }) {
  const [captured, setCaptured] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const cam = useCamera(!captured, 'environment');

  function shoot() {
    const file = cam.capture();
    if (!file) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 150);
    const url = URL.createObjectURL(file);
    setCaptured(url);
    onCapture(file);
  }

  function retake() {
    setCaptured(null);
  }

  return (
    <div className="space-y-4">
      <div className="relative rounded-xl overflow-hidden bg-black" style={{ aspectRatio: '4/3' }}>
        {!captured ? (
          <>
            <video
              ref={cam.videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {/* Document guide overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div
                className="border-2 rounded-lg"
                style={{
                  width: '85%',
                  height: '60%',
                  borderColor: '#00D2FF60',
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
                }}
              />
            </div>
            <div className="absolute bottom-3 left-0 right-0 flex justify-center">
              <p className="kz-mono text-[9px] text-white/60 tracking-widest bg-black/40 px-3 py-1 rounded-full">
                ALIGN DOCUMENT IN FRAME
              </p>
            </div>
            {flash && <div className="absolute inset-0 bg-white opacity-70 pointer-events-none" />}
            {cam.error && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                <p className="kz-mono text-[10px] text-kz-danger text-center px-4">{cam.error}</p>
              </div>
            )}
            {!cam.ready && !cam.error && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                <KzSpinner />
              </div>
            )}
          </>
        ) : (
          <img src={captured} alt="Captured document" className="w-full h-full object-cover" />
        )}
      </div>

      {!captured ? (
        <button
          onClick={shoot}
          disabled={!cam.ready}
          className="kz-btn-connect w-full py-4 disabled:opacity-30"
        >
          <div className="kz-btn-scan" />
          <span className="relative z-10 flex items-center justify-center gap-3 kz-mono text-sm tracking-[0.2em] font-bold">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="8" cy="8" r="2.5" fill="#00D2FF" />
            </svg>
            CAPTURE DOCUMENT
          </span>
        </button>
      ) : (
        <div className="flex gap-3">
          <button
            onClick={retake}
            className="flex-1 py-3 rounded-xl border border-white/20 kz-mono text-[10px] tracking-widest text-white/60 hover:text-white hover:border-white/40 transition-all"
          >
            RETAKE
          </button>
          <button
            onClick={() => {/* already called onCapture on shoot */}}
            className="flex-1 kz-btn-connect py-3"
          >
            <div className="kz-btn-scan" />
            <span className="relative z-10 kz-mono text-[10px] tracking-widest font-bold">USE THIS</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ── Selfie capture step ───────────────────────────────────────────────────────

function SelfieCapture({ selfies, onCapture }: {
  selfies: Selfie[];
  onCapture: (index: number, file: File, preview: string) => void;
}) {
  const currentIndex = selfies.findIndex(s => !s.file);
  const done = currentIndex === -1;
  const [flash, setFlash] = useState(false);
  const cam = useCamera(!done, 'user');
  const current = done ? null : selfies[currentIndex];

  function shoot() {
    const file = cam.capture();
    if (!file || !current) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 150);
    const preview = URL.createObjectURL(file);
    onCapture(currentIndex, file, preview);
  }

  const arrowRotation = { left: 180, right: 0, up: -90, down: 90 };

  return (
    <div className="space-y-4">
      {/* Captured thumbnails */}
      <div className="grid grid-cols-4 gap-2">
        {selfies.map((s, i) => (
          <div
            key={s.pose}
            className="relative rounded-lg overflow-hidden flex items-center justify-center"
            style={{
              aspectRatio: '1',
              background: s.preview ? 'transparent' : '#0a0a0f',
              border: `1px solid ${i === currentIndex ? '#00D2FF40' : s.file ? '#00D2FF30' : '#ffffff14'}`,
            }}
          >
            {s.preview ? (
              <>
                <img src={s.preview} alt={s.pose} className="w-full h-full object-cover" />
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 7L5.5 10.5L12 4" stroke="#00D2FF" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </div>
              </>
            ) : (
              <svg
                width="16" height="16" viewBox="0 0 24 24" fill="none"
                style={{ transform: `rotate(${arrowRotation[s.pose]}deg)`, opacity: i === currentIndex ? 0.8 : 0.2 }}
              >
                <path d="M5 12H19M19 12L13 6M19 12L13 18" stroke="#00D2FF" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
          </div>
        ))}
      </div>

      {/* Camera view */}
      <div className="relative rounded-xl overflow-hidden bg-black" style={{ aspectRatio: '3/4' }}>
        {!done ? (
          <>
            <video
              ref={cam.videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover scale-x-[-1]"
            />
            {/* Pose instruction overlay */}
            {current && (
              <div className="absolute inset-0 flex flex-col items-center justify-between py-6 pointer-events-none">
                <div className="bg-black/50 backdrop-blur-sm px-4 py-2 rounded-full">
                  <p className="kz-mono text-[11px] text-kz-cyan tracking-widest font-bold">
                    {current.label}
                  </p>
                </div>
                <div className="flex items-center justify-center">
                  <svg
                    width="48" height="48" viewBox="0 0 24 24" fill="none"
                    style={{ transform: `rotate(${arrowRotation[current.pose]}deg)`, opacity: 0.7 }}
                    className="animate-pulse"
                  >
                    <path d="M5 12H19M19 12L13 6M19 12L13 18" stroke="#00D2FF" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="kz-mono text-[9px] text-white/40 tracking-widest">
                  {selfies.filter(s => s.file).length} / 4 CAPTURED
                </div>
              </div>
            )}
            {flash && <div className="absolute inset-0 bg-white opacity-70 pointer-events-none" />}
            {cam.error && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                <p className="kz-mono text-[10px] text-kz-danger text-center px-4">{cam.error}</p>
              </div>
            )}
            {!cam.ready && !cam.error && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                <KzSpinner />
              </div>
            )}
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-kz-voidRaised">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <circle cx="20" cy="20" r="18" stroke="#00D2FF" strokeWidth="1.5" opacity="0.3" />
              <path d="M12 20L17 25L28 14" stroke="#00D2FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="kz-mono text-[10px] text-kz-cyan tracking-widest">ALL POSES CAPTURED</p>
          </div>
        )}
      </div>

      {!done && (
        <button
          onClick={shoot}
          disabled={!cam.ready}
          className="kz-btn-connect w-full py-4 disabled:opacity-30"
        >
          <div className="kz-btn-scan" />
          <span className="relative z-10 flex items-center justify-center gap-3 kz-mono text-sm tracking-[0.2em] font-bold">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="8" cy="8" r="2.5" fill="#00D2FF" />
            </svg>
            CAPTURE · {current?.label}
          </span>
        </button>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function VerifyPage() {
  const searchParams = useSearchParams();
  const integratorId = searchParams.get('integrator_id') || '';
  const callbackUrl = searchParams.get('callback_url') || '';
  const stateParam = searchParams.get('state') || '';

  const [integrator, setIntegrator] = useState<IntegratorInfo | null>(null);
  const [stage, setStage] = useState<Stage>('loading_integrator');
  const [error, setError] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [connectingWallet, setConnectingWallet] = useState(false);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [selfies, setSelfies] = useState<Selfie[]>(SELFIE_POSES);
  const [proofStage, setProofStage] = useState<ProofStage | null>(null);
  const [txHash, setTxHash] = useState<string | undefined>(undefined);

  // Load integrator
  useEffect(() => {
    if (!integratorId) { setError('Missing integrator_id parameter.'); setStage('error'); return; }
    fetch(`/api/kakusho/verify/integrator-info?integrator_id=${integratorId}`)
      .then(r => { if (!r.ok) throw new Error('Integrator not found.'); return r.json(); })
      .then((d: IntegratorInfo) => { setIntegrator(d); setStage('connect_wallet'); })
      .catch(e => { setError(e.message || 'Failed to load integrator.'); setStage('error'); });
  }, [integratorId]);

  async function connectWallet() {
    setConnectingWallet(true);
    setError('');
    try {
      const { isConnected, requestAccess } = await import('@stellar/freighter-api');
      const conn = await isConnected();
      if (conn.error) throw new Error('Install Freighter wallet at freighter.app');
      const access = await requestAccess();
      if (access.error) throw new Error(access.error.message || 'Connection rejected');
      if (!access.address) throw new Error('No address returned');
      setWalletAddress(access.address);
      const check = await fetch(`/api/kakusho/verify/status?integrator_id=${integratorId}&stellar_address=${access.address}`);
      const status = await check.json();
      if (status.verified) {
        setStage('already_verified');
        if (callbackUrl) redirectWithResult(access.address, true);
      } else {
        setStage('capture_document');
      }
    } catch (e: any) {
      setError(e.message || 'Wallet connection failed.');
    } finally {
      setConnectingWallet(false);
    }
  }

  function handleDocCapture(file: File) {
    setDocFile(file);
  }

  function handleSelfieCapture(index: number, file: File, preview: string) {
    setSelfies(prev => {
      const next = [...prev];
      next[index] = { ...next[index], file, preview };
      return next;
    });
  }

  const allSelfiesDone = selfies.every(s => s.file !== null);

  async function startProof() {
    if (!docFile || !allSelfiesDone) return;
    setStage('generating_proof');
    setError('');
    try {
      const [countryCodeMap, restrictedTree] = await Promise.all([
        fetch('/assets/country_codes.json').then(r => r.json()),
        fetch('/assets/restricted_tree.json').then(r => r.json()),
      ]);
      const integratorAssets = {
        integratorId: integrator!.integrator_id_hex,
        minAgeSeconds: BigInt(integrator!.min_age_years * 365 * 24 * 3600),
        docMaxAgeSeconds: BigInt(integrator!.doc_max_age_years * 365 * 24 * 3600),
        countryCodeMap,
        restrictedTree,
      };
      const proof = await generateKycProof({
        idDocument: docFile,
        selfies: selfies.map(s => s.file!) as [File, File, File, File],
        integratorAssets,
        proverAssets: {
          wasmUrl: process.env.NEXT_PUBLIC_WASM_URL!,
          zkeyUrl: process.env.NEXT_PUBLIC_ZKEY_URL!,
        },
        onProgress: (s: ProofStage) => setProofStage(s),
      });
      setStage('submitting');
      const result = await submitProof(
        proof,
        process.env.NEXT_PUBLIC_KAKUSHO_RELAYER_URL!,
        process.env.NEXT_PUBLIC_KAKUSHO_API_KEY!,
        walletAddress,
      );
      setTxHash(result.tx_hash ?? undefined);
      setStage('done');
      if (callbackUrl) redirectWithResult(walletAddress, true, result.tx_hash ?? undefined);
    } catch (e: any) {
      setError(e.reason ? `${e.reason}: ${e.message}` : e.message || 'Proof generation failed.');
      setStage('error');
    }
  }

  function redirectWithResult(address: string, verified: boolean, txHash?: string) {
    const url = new URL(callbackUrl);
    url.searchParams.set('verified', String(verified));
    url.searchParams.set('wallet', address);
    if (stateParam) url.searchParams.set('state', stateParam);
    if (txHash) url.searchParams.set('tx_hash', txHash);
    setTimeout(() => window.location.href = url.toString(), 2200);
  }

  const STEPS = ['Connect wallet', 'Capture ID', 'Liveness check', 'Generate proof'];
  const stepIndex: Record<Stage, number> = {
    loading_integrator: -1, already_verified: 4, connect_wallet: 0,
    capture_document: 1, capture_selfies: 2, generating_proof: 3,
    submitting: 3, done: 4, error: -1,
  };
  const currentStep = stepIndex[stage] ?? -1;

  // ── Render ────────────────────────────────────────────────────────────────

  if (stage === 'loading_integrator') return (
    <Shell>
      <div className="flex flex-col items-center gap-4 py-16">
        <KzSpinner />
        <p className="kz-mono text-[10px] tracking-widest text-kz-slate">LOADING_INTEGRATOR...</p>
      </div>
    </Shell>
  );

  if (stage === 'error') return (
    <Shell>
      <div className="kz-panel text-center py-10 px-6">
        <div className="kz-error-box mb-6">
          <p className="kz-mono text-[10px] text-kz-danger tracking-wider">{error}</p>
        </div>
        <p className="kz-mono text-[9px] text-kz-slate/50 tracking-widest">
          Contact the app that sent you here for support.
        </p>
      </div>
    </Shell>
  );

  if (stage === 'already_verified') return (
    <Shell integrator={integrator!}>
      <div className="kz-panel text-center py-12 px-6">
        <VerifiedBadge />
        <h2 className="kz-display text-2xl font-bold text-white mb-2 mt-6">Already verified</h2>
        <p className="kz-mono text-[10px] text-kz-cyan/50 tracking-widest mb-2">{walletAddress}</p>
        <p className="kz-mono text-[10px] text-kz-slate mt-4 tracking-wide">
          {callbackUrl ? 'Redirecting you back…' : 'Your proof is on-chain for this integrator.'}
        </p>
      </div>
    </Shell>
  );

  if (stage === 'done') return (
    <Shell integrator={integrator!}>
      <div className="kz-panel text-center py-12 px-6">
        <VerifiedBadge />
        <h2 className="kz-display text-2xl font-bold text-white mb-2 mt-6">Proof verified</h2>
        <p className="kz-mono text-[10px] text-kz-slate mt-1 tracking-wide mb-6">
          Your identity is anchored on Soroban — no personal data was transmitted.
        </p>
        {txHash && (
          <div className="bg-kz-voidRaised border border-kz-surfaceLine rounded-lg px-4 py-3 mb-4">
            <p className="kz-mono text-[9px] text-kz-cyan/40 tracking-widest mb-1">TX_HASH</p>
            <p className="kz-mono text-[10px] text-white/60 break-all">{txHash}</p>
          </div>
        )}
        {callbackUrl && (
          <p className="kz-mono text-[9px] text-kz-slate/50 tracking-widest">
            Redirecting back to {new URL(callbackUrl).hostname}…
          </p>
        )}
      </div>
    </Shell>
  );

  if (stage === 'generating_proof' || stage === 'submitting') {
    const stageIdx = proofStage ? PROOF_STAGE_ORDER.indexOf(proofStage) : -1;
    return (
      <Shell integrator={integrator!}>
        <div className="kz-panel py-10 px-6">
          <p className="kz-mono text-[9px] tracking-widest text-kz-cyan/50 mb-6">PROOF_GENERATION</p>
          <div className="space-y-3">
            {PROOF_STAGE_ORDER.filter(s => s !== 'done').map((s, i) => {
              const isDone = stageIdx > i;
              const isActive = stageIdx === i;
              return (
                <div key={s} className="flex items-center gap-3">
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all duration-300"
                    style={{
                      border: `1px solid ${isDone ? '#00D2FF60' : isActive ? '#00D2FF40' : '#ffffff14'}`,
                      background: isDone ? '#00D2FF14' : 'transparent',
                    }}
                  >
                    {isDone ? (
                      <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                        <path d="M2 4.5L3.5 6L7 3" stroke="#00D2FF" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    ) : isActive ? <KzSpinner sm /> : null}
                  </div>
                  <span
                    className="kz-mono text-[10px] tracking-widest transition-colors"
                    style={{ color: isDone ? '#00D2FF80' : isActive ? '#00D2FF' : '#ffffff30' }}
                  >
                    {PROOF_STAGE_LABELS[s]}
                  </span>
                </div>
              );
            })}
          </div>
          {stage === 'submitting' && (
            <div className="flex items-center gap-3 mt-6 pt-5 border-t border-kz-surfaceLine">
              <KzSpinner sm />
              <span className="kz-mono text-[10px] text-kz-cyan tracking-widest">Relaying to Soroban…</span>
            </div>
          )}
          <p className="kz-mono text-[9px] text-kz-slate/40 mt-6 tracking-widest leading-relaxed">
            Proof generation runs entirely in your browser. No personal data leaves your device.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell integrator={integrator!}>
      {/* Step progress */}
      <div className="kz-panel mb-5 py-4 px-5">
        <div className="flex items-center gap-2">
          {STEPS.map((label, i) => (
            <div key={i} className="flex items-center gap-2 flex-1 min-w-0">
              <StepDot index={i + 1} active={currentStep === i} done={currentStep > i} />
              <span
                className="kz-mono text-[8px] tracking-widest truncate hidden sm:block transition-colors"
                style={{ color: currentStep === i ? '#00D2FF' : currentStep > i ? '#00D2FF60' : '#ffffff20' }}
              >
                {label.toUpperCase()}
              </span>
              {i < STEPS.length - 1 && (
                <div className="flex-1 h-px mx-1" style={{ background: currentStep > i ? '#00D2FF30' : '#ffffff0a' }} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step 0: Connect wallet */}
      {stage === 'connect_wallet' && (
        <div className="kz-panel">
          <p className="kz-mono text-[9px] tracking-widest text-kz-cyan/50 mb-6">STEP_01 · WALLET</p>
          <div className="text-center py-6">
            <div className="kz-icon-frame mx-auto mb-6" style={{ width: 56, height: 56 }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="6" width="18" height="13" rx="2" stroke="#00D2FF" strokeWidth="1.2" />
                <path d="M3 10H21" stroke="#00D2FF" strokeWidth="1.2" />
                <rect x="15" y="13" width="4" height="3" rx="1" fill="#00D2FF" opacity="0.6" />
              </svg>
            </div>
            <h2 className="kz-display text-xl font-bold text-white mb-2">Connect your wallet</h2>
            <p className="kz-mono text-[10px] text-kz-slate tracking-wide mb-8 max-w-xs mx-auto leading-relaxed">
              Sign in with Freighter to prove ownership of your Stellar address.
            </p>
            {error && (
              <div className="kz-error-box mb-5 text-left">
                <span className="kz-mono text-[10px] text-kz-danger tracking-wider">{error}</span>
              </div>
            )}
            <button onClick={connectWallet} disabled={connectingWallet} className="kz-btn-connect w-full py-4">
              <div className="kz-btn-scan" />
              <span className="relative z-10 flex items-center justify-center gap-3 kz-mono text-sm tracking-[0.2em] font-bold">
                {connectingWallet ? <><KzSpinner sm />CONNECTING...</> : <>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M7 1L13 7L7 13M1 7H13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  CONNECT FREIGHTER
                </>}
              </span>
            </button>
            <p className="kz-mono text-[9px] text-white/20 mt-4 tracking-widest">
              Don&apos;t have Freighter?{' '}
              <a href="https://freighter.app" target="_blank" rel="noopener noreferrer" className="text-kz-cyan/40 hover:text-kz-cyan transition-colors">
                freighter.app →
              </a>
            </p>
          </div>
        </div>
      )}

      {/* Step 1: Capture document */}
      {stage === 'capture_document' && (
        <div className="kz-panel">
          <div className="flex items-center justify-between mb-6">
            <p className="kz-mono text-[9px] tracking-widest text-kz-cyan/50">STEP_02 · DOCUMENT</p>
            <span className="kz-mono text-[9px] text-kz-slate tracking-widest truncate max-w-[140px]">
              {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
            </span>
          </div>
          <h2 className="kz-display text-xl font-bold text-white mb-1">Capture your ID</h2>
          <p className="kz-mono text-[10px] text-kz-slate tracking-wide mb-5 leading-relaxed">
            Position your passport, national ID, or driver&apos;s license in the frame.
          </p>
          <DocumentCapture onCapture={handleDocCapture} />
          {docFile && (
            <button
              onClick={() => setStage('capture_selfies')}
              className="kz-btn-connect w-full py-4 mt-4"
            >
              <div className="kz-btn-scan" />
              <span className="relative z-10 flex items-center justify-center gap-3 kz-mono text-sm tracking-[0.2em] font-bold">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 1L13 7L7 13M1 7H13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                CONTINUE
              </span>
            </button>
          )}
        </div>
      )}

      {/* Step 2: Selfies */}
      {stage === 'capture_selfies' && (
        <div className="kz-panel">
          <div className="flex items-center justify-between mb-6">
            <p className="kz-mono text-[9px] tracking-widest text-kz-cyan/50">STEP_03 · LIVENESS</p>
            <button
              onClick={() => setStage('capture_document')}
              className="kz-mono text-[9px] text-white/30 hover:text-white/60 tracking-widest transition-colors"
            >
              ← BACK
            </button>
          </div>
          <h2 className="kz-display text-xl font-bold text-white mb-1">Liveness check</h2>
          <p className="kz-mono text-[10px] text-kz-slate tracking-wide mb-5 leading-relaxed">
            Follow the arrows and capture each pose.
          </p>
          <SelfieCapture selfies={selfies} onCapture={handleSelfieCapture} />
          {allSelfiesDone && (
            <button onClick={startProof} className="kz-btn-connect w-full py-4 mt-4">
              <div className="kz-btn-scan" />
              <span className="relative z-10 flex items-center justify-center gap-3 kz-mono text-sm tracking-[0.2em] font-bold">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M4 7L6 9L10 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                GENERATE PROOF
              </span>
            </button>
          )}
        </div>
      )}

      {/* Verification rules */}
      {(stage === 'connect_wallet' || stage === 'capture_document' || stage === 'capture_selfies') && integrator && (
        <div className="kz-panel mt-5 border-kz-surfaceLine/60">
          <p className="kz-mono text-[9px] tracking-widest text-kz-slate mb-4">VERIFICATION_RULES</p>
          <div className="space-y-2.5">
            <RuleRow label="MIN_AGE" value={`${integrator.min_age_years}+ years`} />
            <RuleRow label="DOC_MAX_AGE" value={`Issued within ${integrator.doc_max_age_years} years`} />
            {integrator.restricted_countries.length > 0 && (
              <RuleRow label="RESTRICTED" value={`${integrator.restricted_countries.length} jurisdictions excluded`} danger />
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Shell({ children, integrator }: { children: React.ReactNode; integrator?: IntegratorInfo | null }) {
  return (
    <div className="min-h-screen bg-kz-void flex flex-col">
      <div className="border-b border-kz-surfaceLine px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="6.5" stroke="#00D2FF" strokeWidth="1" opacity="0.6" />
            <circle cx="9" cy="9" r="2" fill="#00D2FF" />
          </svg>
          <span className="kz-mono text-xs tracking-widest text-white font-bold">KAKUSHŌ</span>
        </div>
        {integrator && (
          <div className="flex items-center gap-2">
            <span className="kz-mono text-[9px] text-kz-slate tracking-widest">Requested by</span>
            <span className="kz-mono text-[9px] text-white/70 tracking-widest font-bold">{integrator.name}</span>
          </div>
        )}
      </div>
      <div className="flex-1 flex flex-col items-center justify-start py-10 px-4">
        {integrator && (
          <div className="w-full max-w-sm mb-5 text-center">
            <p className="kz-mono text-[9px] text-kz-cyan/50 tracking-widest mb-1">IDENTITY VERIFICATION</p>
            <h1 className="kz-display text-2xl font-bold text-white">{integrator.name}</h1>
            <p className="kz-mono text-[9px] text-kz-slate tracking-widest mt-1">requires ZK KYC via Kakushō Protocol</p>
          </div>
        )}
        <div className="w-full max-w-sm">{children}</div>
      </div>
      <div className="border-t border-kz-surfaceLine px-6 py-4 text-center">
        <p className="kz-mono text-[9px] text-white/20 tracking-widest">
          POWERED BY KAKUSHŌ · ZERO-KNOWLEDGE KYC · NO PII ON-CHAIN
        </p>
      </div>
    </div>
  );
}

function VerifiedBadge() {
  return (
    <div className="kz-proof-badge mx-auto">
      <div className="kz-proof-outer">
        <div className="kz-proof-inner">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path d="M7 14L11.5 18.5L21 8.5" stroke="#00E676" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </div>
  );
}

function RuleRow({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-kz-surfaceLine/40">
      <span className="kz-mono text-[9px] text-kz-slate tracking-widest">{label}</span>
      <span className="kz-mono text-[9px] tracking-widest" style={{ color: danger ? '#FF5252' : '#00D2FF80' }}>
        {value}
      </span>
    </div>
  );
}