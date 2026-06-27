'use client';

import Link from 'next/link';
import { useState } from 'react';
import { cn } from '@/lib/utils';

function CodeBlock({ code, language = 'bash' }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative group">
      <div className="bg-kz-voidRaised border border-kz-surfaceLine rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-kz-surfaceLine">
          <span className="kz-mono text-[9px] text-kz-cyan/30 tracking-widest">{language.toUpperCase()}</span>
          <button
            onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            className={cn('kz-mono text-[9px] tracking-widest transition-colors', copied ? 'text-kz-cyan' : 'text-white/20 hover:text-white/50')}
          >
            {copied ? '✓ COPIED' : 'COPY'}
          </button>
        </div>
        <pre className="p-4 overflow-x-auto kz-mono text-[11px] text-white/60 leading-relaxed whitespace-pre">{code}</pre>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-12">
      <p className="kz-mono text-[9px] tracking-widest text-kz-slate mb-1">{title}</p>
      <div className="w-8 h-px bg-kz-cyan/20 mb-5" />
      {children}
    </div>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-kz-cyan/5 border border-kz-cyan/20 rounded-lg px-4 py-3 mb-4">
      <p className="kz-mono text-[10px] text-kz-cyan/70 tracking-wide leading-relaxed">{children}</p>
    </div>
  );
}

function WarningBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg px-4 py-3 mb-4">
      <p className="kz-mono text-[10px] text-yellow-400/70 tracking-wide leading-relaxed">{children}</p>
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'kz-mono text-[10px] tracking-widest px-4 py-2 rounded-t-lg border transition-all',
        active
          ? 'bg-kz-voidRaised border-kz-surfaceLine border-b-kz-voidRaised text-kz-cyan'
          : 'bg-transparent border-transparent text-white/30 hover:text-white/60'
      )}
    >
      {children}
    </button>
  );
}

export default function DocsPage() {
  const [integrationMode, setIntegrationMode] = useState<'hosted' | 'sdk'>('hosted');

  return (
    <div className="min-h-screen bg-kz-void">
      <nav className="border-b border-kz-surfaceLine px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="kz-mono text-[9px] text-kz-cyan/40 hover:text-kz-cyan tracking-widest transition-colors">
          ← DASHBOARD
        </Link>
        <span className="kz-mono text-[9px] text-white/20">/</span>
        <span className="kz-mono text-[9px] text-white/60 tracking-widest">INTEGRATION_DOCS</span>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="mb-10">
          <p className="kz-mono text-[9px] text-kz-cyan/50 tracking-widest mb-2">DEVELOPER DOCUMENTATION</p>
          <h1 className="kz-display text-3xl font-bold text-white tracking-tight">Kakushō Integration Guide</h1>
          <p className="kz-mono text-[10px] text-kz-slate mt-2 tracking-wide leading-relaxed">
            Add zero-knowledge KYC to your platform. Two integration paths — pick what fits your stack.
            No PII ever leaves the user's device.
          </p>
        </div>

        {/* Architecture overview */}
        <Section title="00 · HOW IT WORKS">
          <p className="kz-mono text-[10px] text-kz-slate mb-4 tracking-wide leading-relaxed">
            Kakushō is a B2B2C ZK KYC protocol on Stellar/Soroban. Your app (the integrator) registers once
            and gets an <span className="text-kz-cyan/60">integrator_id</span> and an API key. When your users
            need to verify their identity, they go through the Kakushō flow — either on your own UI using the
            SDK, or on the Kakushō-hosted verify page. Either way, the proof is generated entirely in the
            user's browser and submitted to the Soroban contract. No personal data is transmitted or stored.
          </p>

          <div className="space-y-3 mb-4">
            {[
              { step: '01', label: 'User uploads ID + takes 4 liveness selfies', detail: 'OCR + MediaPipe run locally in browser' },
              { step: '02', label: 'Groth16 proof generated in Web Worker', detail: 'snarkjs runs the circuit client-side (~10–60s)' },
              { step: '03', label: 'Proof submitted to Kakushō relayer', detail: 'Relayer sponsors the Stellar transaction fee' },
              { step: '04', label: 'KYC registry contract verified on-chain', detail: 'Nullifier anchored on Soroban — no PII on-chain' },
              { step: '05', label: 'Webhook + callback fired to your app', detail: 'Mark user as verified in your DB' },
            ].map(({ step, label, detail }) => (
              <div key={step} className="flex items-start gap-4 py-3 border-b border-kz-surfaceLine/40">
                <span className="kz-mono text-[9px] text-kz-cyan/40 tracking-widest w-6 shrink-0">{step}</span>
                <div>
                  <p className="kz-mono text-[10px] text-white/80 tracking-wide">{label}</p>
                  <p className="kz-mono text-[9px] text-kz-slate tracking-wide mt-0.5">{detail}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Pick integration path */}
        <Section title="01 · CHOOSE YOUR INTEGRATION PATH">
          <p className="kz-mono text-[10px] text-kz-slate mb-5 tracking-wide leading-relaxed">
            There are two ways to integrate. Choose based on how much UI control you need.
          </p>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <button
              onClick={() => setIntegrationMode('hosted')}
              className={cn(
                'text-left p-4 rounded-xl border transition-all',
                integrationMode === 'hosted'
                  ? 'border-kz-cyan/40 bg-kz-cyan/5'
                  : 'border-kz-surfaceLine bg-kz-voidRaised hover:border-white/20'
              )}
            >
              <p className="kz-mono text-[10px] text-kz-cyan tracking-widest mb-2">PATH A · HOSTED UI</p>
              <p className="kz-mono text-[9px] text-kz-slate tracking-wide leading-relaxed">
                Redirect users to the Kakushō verify page. Zero frontend work — just build a callback handler.
                Best for: fast integration, small teams, MVPs.
              </p>
              <div className="mt-3 flex flex-wrap gap-1">
                {['No UI to build', 'Works on mobile', '~30 min to integrate'].map(t => (
                  <span key={t} className="kz-mono text-[8px] text-kz-cyan/50 border border-kz-cyan/20 rounded px-2 py-0.5">{t}</span>
                ))}
              </div>
            </button>

            <button
              onClick={() => setIntegrationMode('sdk')}
              className={cn(
                'text-left p-4 rounded-xl border transition-all',
                integrationMode === 'sdk'
                  ? 'border-kz-cyan/40 bg-kz-cyan/5'
                  : 'border-kz-surfaceLine bg-kz-voidRaised hover:border-white/20'
              )}
            >
              <p className="kz-mono text-[10px] text-kz-cyan tracking-widest mb-2">PATH B · SDK</p>
              <p className="kz-mono text-[9px] text-kz-slate tracking-wide leading-relaxed">
                Use the npm SDK to build your own fully-custom KYC UI inside your app. Full control over
                design and flow.
                Best for: custom branding, complex flows.
              </p>
              <div className="mt-3 flex flex-wrap gap-1">
                {['Full UI control', 'Custom branding', 'More setup required'].map(t => (
                  <span key={t} className="kz-mono text-[8px] text-kz-cyan/50 border border-kz-cyan/20 rounded px-2 py-0.5">{t}</span>
                ))}
              </div>
            </button>
          </div>

          {/* PATH A */}
          {integrationMode === 'hosted' && (
            <div className="space-y-6">
              <InfoBox>
                PATH A — Your users are redirected to kakusho-protocol.vercel.app/verify with your
                integrator_id. After verification, they are redirected back to your callback_url with the
                result. You never handle any identity data directly.
              </InfoBox>

              <div>
                <p className="kz-mono text-[10px] text-white/60 tracking-wide mb-3">
                  Step 1 — Build the verify URL and show it to your user (QR code on desktop, button on mobile):
                </p>
                <CodeBlock language="typescript" code={`// Build the Kakushō verify URL
const KAKUSHO_URL = 'https://kakusho-protocol.vercel.app';
const INTEGRATOR_ID = 'your_integrator_id_hex'; // from your dashboard

const callbackUrl = \`\${window.location.origin}/verify/callback\`;
const state = currentUser.id; // optional — passed back unchanged on callback

const verifyUrl = [
  \`\${KAKUSHO_URL}/verify\`,
  \`?integrator_id=\${INTEGRATOR_ID}\`,
  \`&callback_url=\${encodeURIComponent(callbackUrl)}\`,
  \`&state=\${encodeURIComponent(state)}\`,
].join('');

// On desktop: render as QR code
<QRCode value={verifyUrl} />

// On mobile: render as a button
<button onClick={() => window.open(verifyUrl, '_blank')}>
  Verify Identity
</button>`} />
              </div>

              <div>
                <p className="kz-mono text-[10px] text-white/60 tracking-wide mb-3">
                  Step 2 — Handle the callback. After the user completes verification, Kakushō redirects
                  to your <span className="text-kz-cyan/60">callback_url</span> with these query params:
                </p>
                <div className="space-y-2 mb-4">
                  {[
                    { param: 'verified', desc: '"true" if proof was accepted, "false" otherwise' },
                    { param: 'wallet', desc: 'The user\'s Stellar address that was verified' },
                    { param: 'tx_hash', desc: 'The Soroban transaction hash (present if verified=true)' },
                    { param: 'state', desc: 'The state value you passed in — use to identify your user' },
                  ].map(({ param, desc }) => (
                    <div key={param} className="flex items-start gap-4 py-2 border-b border-kz-surfaceLine/40">
                      <span className="kz-mono text-[10px] text-kz-cyan/70 tracking-widest w-24 shrink-0">{param}</span>
                      <span className="kz-mono text-[9px] text-kz-slate tracking-wide">{desc}</span>
                    </div>
                  ))}
                </div>
                <CodeBlock language="typescript" code={`// app/verify/callback/page.tsx (Next.js)
'use client';
import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

export default function CallbackPage() {
  const params = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const verified = params.get('verified');  // 'true' | 'false'
    const wallet   = params.get('wallet');    // Stellar address
    const txHash   = params.get('tx_hash');   // Soroban tx
    const state    = params.get('state');     // your user ID

    if (verified === 'true' && wallet) {
      // Persist to your DB — mark this user as KYC verified
      fetch('/api/kyc/mark-verified', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: state, wallet, txHash }),
      }).then(() => router.replace('/dashboard'));
    } else {
      router.replace('/verify?error=verification_failed');
    }
  }, []);

  return <div>Processing verification...</div>;
}`} />
              </div>

              <div>
                <p className="kz-mono text-[10px] text-white/60 tracking-wide mb-3">
                  Step 3 — Verify the result server-side before granting access. Never trust the callback
                  params alone — always confirm on-chain or via the status endpoint:
                </p>
                <CodeBlock language="typescript" code={`// app/api/kyc/mark-verified/route.ts
const RELAYER = 'https://worrying-drucy-faucetdrops-aab2b1e1.koyeb.app';

export async function POST(req: Request) {
  const { userId, wallet } = await req.json();

  // Confirm with the relayer that this address is actually verified
  const res = await fetch(
    \`\${RELAYER}/verify/status?integrator_id=YOUR_ID&stellar_address=\${wallet}\`
  );
  const { verified } = await res.json();

  if (!verified) {
    return Response.json({ error: 'Not verified' }, { status: 403 });
  }

  // Safe to mark verified in your DB
  await db.users.update({ where: { id: userId }, data: { kyc_verified: true } });
  return Response.json({ ok: true });
}`} />
              </div>
            </div>
          )}

          {/* PATH B */}
          {integrationMode === 'sdk' && (
            <div className="space-y-6">
              <InfoBox>
                PATH B — Install the npm SDK and build your own UI. The SDK handles OCR, liveness checks,
                proof generation, and submission. You control every pixel of the experience.
              </InfoBox>

              <div>
                <p className="kz-mono text-[10px] text-white/60 tracking-wide mb-3">Step 1 — Install:</p>
                <CodeBlock language="bash" code={`npm install @kakusho/zk-kyc-sdk snarkjs tesseract.js @mediapipe/tasks-vision`} />
                <p className="kz-mono text-[10px] text-kz-slate mt-3 tracking-wide leading-relaxed">
                  <span className="text-kz-cyan/60">snarkjs</span> — Groth16 proving in a Web Worker.
                  {' '}<span className="text-kz-cyan/60">tesseract.js</span> — client-side OCR for document fields.
                  {' '}<span className="text-kz-cyan/60">@mediapipe/tasks-vision</span> — liveness pose detection.
                </p>
              </div>

              <div>
                <p className="kz-mono text-[10px] text-white/60 tracking-wide mb-3">
                  Step 2 — Host your circuit assets on a CDN. These are large files (~13MB for the zkey)
                  that must be served with long cache headers. Do not serve from your own origin server.
                </p>
                <CodeBlock language="bash" code={`# After running the trusted setup (circuits/trusted_setup.sh):
circuits/build/kyc_ocr_js/kyc_ocr.wasm   → https://cdn.your-org.com/kyc_ocr.wasm
circuits/build/kyc_ocr_final.zkey         → https://cdn.your-org.com/kyc_ocr_final.zkey

# Required cache headers — these files never change after trusted setup:
Cache-Control: public, max-age=31536000, immutable`} />
              </div>

              <div>
                <p className="kz-mono text-[10px] text-white/60 tracking-wide mb-3">Step 3 — Configure env vars:</p>
                <CodeBlock language="bash" code={`# .env.local
NEXT_PUBLIC_KAKUSHO_RELAYER_URL=https://worrying-drucy-faucetdrops-aab2b1e1.koyeb.app
NEXT_PUBLIC_KAKUSHO_API_KEY=zkkyc_your_api_key_here
NEXT_PUBLIC_WASM_URL=https://cdn.your-org.com/kyc_ocr.wasm
NEXT_PUBLIC_ZKEY_URL=https://cdn.your-org.com/kyc_ocr_final.zkey`} />
              </div>

              <div>
                <p className="kz-mono text-[10px] text-white/60 tracking-wide mb-3">
                  Step 4 — Generate and submit the proof. Call <span className="text-kz-cyan/60">generateKycProof</span> with
                  the user's document and selfies, then pass the result to <span className="text-kz-cyan/60">submitProof</span>.
                  Both functions run entirely client-side — no identity data is ever sent to your servers.
                </p>
                <CodeBlock language="typescript" code={`import { generateKycProof, submitProof, KycRejectedError } from '@kakusho/zk-kyc-sdk';

// Load integrator config once (cache in component state)
const integratorAssets = {
  integratorId: 'your_integrator_id_hex',  // from your Kakushō dashboard
  minAgeSeconds: BigInt(568025136),          // 18 years — must match your on-chain config
  docMaxAgeSeconds: BigInt(315360000),       // 10 years — must match your on-chain config
  countryCodeMap: await fetch('/assets/country_codes.json').then(r => r.json()),
  restrictedTree: await fetch('/assets/restricted_tree.json').then(r => r.json()),
};

try {
  // Step A: generate proof client-side
  // idDocument  — File object from camera capture or <input type="file">
  // selfies     — exactly 4 Files: [lookLeft, lookRight, lookUp, lookDown]
  // onProgress  — called as each stage completes (use to drive a progress UI)
  const proof = await generateKycProof({
    idDocument: documentFile,
    selfies: [leftFile, rightFile, upFile, downFile],
    integratorAssets,
    proverAssets: {
      wasmUrl: process.env.NEXT_PUBLIC_WASM_URL!,
      zkeyUrl: process.env.NEXT_PUBLIC_ZKEY_URL!,
    },
    onProgress: (stage) => console.log('Progress:', stage),
    // stages: ocr → liveness → fetching_wasm → fetching_zkey
    //       → computing_witness → generating_proof → done
  });

  // Step B: submit proof to relayer (relayer pays Stellar fee on your behalf)
  const result = await submitProof(
    proof,
    process.env.NEXT_PUBLIC_KAKUSHO_RELAYER_URL!,
    process.env.NEXT_PUBLIC_KAKUSHO_API_KEY!,
    userStellarAddress, // the address to anchor the proof against
  );

  console.log('Verified! tx_hash:', result.tx_hash);
  // result.tx_hash — Soroban transaction hash, link to stellar.expert

} catch (e) {
  if (e instanceof KycRejectedError) {
    // e.reason: 'ocr_failed' | 'liveness_failed' | 'predicate_failed'
    // e.message: human-readable explanation
    console.error('KYC rejected:', e.reason, e.message);
  } else {
    console.error('Unexpected error:', e);
  }
}`} />
              </div>

              <div>
                <p className="kz-mono text-[10px] text-white/60 tracking-wide mb-3">
                  Step 5 — Confirm on your backend before granting access. The SDK returns a tx_hash —
                  use it or the status endpoint to confirm before marking a user verified in your DB:
                </p>
                <CodeBlock language="typescript" code={`// After submitProof resolves, confirm server-side:
const res = await fetch('/api/kyc/confirm', {
  method: 'POST',
  body: JSON.stringify({ wallet: userStellarAddress, txHash: result.tx_hash }),
});

// app/api/kyc/confirm/route.ts
const RELAYER = process.env.KAKUSHO_RELAYER_URL!;

export async function POST(req: Request) {
  const { wallet } = await req.json();

  const check = await fetch(
    \`\${RELAYER}/verify/status?integrator_id=\${process.env.KAKUSHO_INTEGRATOR_ID}&stellar_address=\${wallet}\`
  );
  const { verified } = await check.json();
  if (!verified) return Response.json({ error: 'Not verified' }, { status: 403 });

  await db.users.update({ where: { stellarAddress: wallet }, data: { kycVerified: true } });
  return Response.json({ ok: true });
}`} />
              </div>
            </div>
          )}
        </Section>

        {/* Webhooks */}
        <Section title="02 · WEBHOOKS (BOTH PATHS)">
          <p className="kz-mono text-[10px] text-kz-slate mb-4 tracking-wide leading-relaxed">
            Kakushō fires a webhook to your registered URL when a verification completes. This is the
            recommended way to update your DB — more reliable than the callback redirect, which can be
            missed if the user closes the tab. Set your webhook URL in the dashboard.
          </p>
          <WarningBox>
            Always verify the HMAC signature before processing a webhook. Never skip this — any client
            could POST to your webhook URL without it.
          </WarningBox>
          <CodeBlock language="typescript" code={`// app/api/webhook/kakusho/route.ts
import crypto from 'crypto';

export async function POST(req: Request) {
  const rawBody = await req.text();
  const sig = req.headers.get('x-webhook-signature');

  // Verify HMAC — your webhook secret is in the Kakushō dashboard
  const expected = crypto
    .createHmac('sha256', process.env.KAKUSHO_WEBHOOK_SECRET!)
    .update(rawBody)
    .digest('hex');

  if (sig !== expected) {
    return new Response('Unauthorized', { status: 401 });
  }

  const event = JSON.parse(rawBody);
  // event.event          — 'kyc.verification.completed'
  // event.status         — 'confirmed' | 'rejected'
  // event.nullifier_hex  — unique per user per integrator (use as idempotency key)
  // event.tx_hash        — Soroban transaction hash
  // event.integrator_id  — your integrator ID

  if (event.event === 'kyc.verification.completed' && event.status === 'confirmed') {
    await db.verifications.upsert({
      where: { nullifier: event.nullifier_hex },
      update: { verified: true, txHash: event.tx_hash },
      create: { nullifier: event.nullifier_hex, verified: true, txHash: event.tx_hash },
    });
  }

  return new Response('OK', { status: 200 });
}`} />
        </Section>

        {/* Status endpoint */}
        <Section title="03 · CHECK STATUS ANYTIME">
          <p className="kz-mono text-[10px] text-kz-slate mb-4 tracking-wide leading-relaxed">
            Poll or check the verification status of any Stellar address at any time.
            Use this to gate features or confirm before granting access.
          </p>
          <CodeBlock language="bash" code={`# Check if a Stellar address is verified for your integrator
GET https://worrying-drucy-faucetdrops-aab2b1e1.koyeb.app/verify/status
  ?integrator_id=your_integrator_id_hex
  &stellar_address=GXXXXXX...

# Response
{ "verified": true, "tx_hash": "abc123..." }
{ "verified": false }`} />
        </Section>

        {/* Drop-in widget */}
        <Section title="04 · STATUS WIDGET (SDK PATH)">
          <p className="kz-mono text-[10px] text-kz-slate mb-4 tracking-wide">
            Drop-in React badge. Shows a verified checkmark if the user is verified, or a CTA button if not.
            Only available when using Path B (SDK).
          </p>
          <CodeBlock language="typescript" code={`import { KYCWidget } from '@kakusho/zk-kyc-sdk/widget';

// In your component:
<KYCWidget
  walletAddress={userStellarAddress}
  relayerUrl={process.env.NEXT_PUBLIC_KAKUSHO_RELAYER_URL}
  // kycUrl — where to send unverified users (your /kyc page or the hosted Kakushō URL)
  kycUrl="https://your-app.com/kyc"
  compact={false} // true = icon only, false = full badge with label
/>`} />
        </Section>

        {/* Progress stages */}
        <Section title="05 · PROOF GENERATION STAGES">
          <p className="kz-mono text-[10px] text-kz-slate mb-4 tracking-wide">
            The <span className="text-kz-cyan/60">onProgress</span> callback fires with these stage values
            in order. Use them to build a progress UI so users know what is happening during the ~10–60s proof generation.
          </p>
          <div className="space-y-0">
            {[
              { stage: 'ocr', desc: 'Tesseract.js reads document fields in-browser. Fails if document is blurry or fields are missing.' },
              { stage: 'liveness', desc: 'MediaPipe checks 4 selfie poses (left, right, up, down). Fails if any pose is undetected.' },
              { stage: 'fetching_wasm', desc: 'Downloads the circuit WASM from your CDN (~200KB). Cached after first load.' },
              { stage: 'fetching_zkey', desc: 'Downloads the Groth16 proving key (~13MB). Cached after first load — long on first run.' },
              { stage: 'computing_witness', desc: 'Builds the ZK witness from document fields. Fast — runs in milliseconds.' },
              { stage: 'generating_proof', desc: 'Runs the Groth16 prover in a Web Worker. Takes 10–60s depending on device.' },
              { stage: 'done', desc: 'Proof object ready — pass it directly to submitProof().' },
            ].map(({ stage, desc }) => (
              <div key={stage} className="flex items-start gap-4 py-3 border-b border-kz-surfaceLine/50">
                <span className="kz-mono text-[10px] text-kz-cyan tracking-widest w-36 shrink-0 mt-0.5">{stage}</span>
                <span className="kz-mono text-[9px] text-kz-slate tracking-wide leading-relaxed">{desc}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Errors */}
        <Section title="06 · ERROR REFERENCE">
          <p className="kz-mono text-[10px] text-kz-slate mb-4 tracking-wide">
            All SDK errors extend <span className="text-kz-cyan/60">KakushoError</span>.
            Catch <span className="text-kz-cyan/60">KycRejectedError</span> for user-facing failures — these
            mean the user's document or selfies didn't pass, not a code bug.
          </p>
          <div className="space-y-0">
            {[
              { cls: 'KycRejectedError', reason: 'ocr_failed', desc: 'Document unreadable — ask user to retake with better lighting and a flat surface.' },
              { cls: 'KycRejectedError', reason: 'liveness_failed', desc: 'Not all 4 poses detected — list missing poses from e.message and ask user to retry.' },
              { cls: 'KycRejectedError', reason: 'predicate_failed', desc: "User doesn't meet age or country rules for your integrator config." },
              { cls: 'OCRError', reason: '', desc: 'Tesseract failed to process the image entirely — usually a corrupted or unsupported file format.' },
              { cls: 'WitnessBuildError', reason: '', desc: 'Date parsing failed or nationality not in country code map — check your countryCodeMap asset.' },
              { cls: 'RelayerError', reason: '', desc: 'The Kakushō relayer returned an error — check your API key and daily tx limit in the dashboard.' },
            ].map(({ cls, reason, desc }) => (
              <div key={cls + reason} className="flex items-start gap-4 py-3 border-b border-kz-surfaceLine/50">
                <div className="w-52 shrink-0">
                  <span className="kz-mono text-[10px] text-kz-danger/70 tracking-wide">{cls}</span>
                  {reason && <span className="kz-mono text-[9px] text-kz-danger/40 tracking-wide block">{reason}</span>}
                </div>
                <span className="kz-mono text-[9px] text-kz-slate tracking-wide leading-relaxed">{desc}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Support */}
        <div className="kz-panel py-6 px-6 text-center">
          <p className="kz-mono text-[9px] text-kz-slate tracking-widest mb-2">NEED HELP?</p>
          <p className="kz-mono text-[10px] text-white/40 tracking-wide leading-relaxed">
            Open an issue on{' '}
            <a href="https://github.com/jerydam/kakusho-zk-kyc-sdk" target="_blank" rel="noopener noreferrer" className="text-kz-cyan/60 hover:text-kz-cyan transition-colors">
              github.com/jerydam/kakusho-zk-kyc-sdk
            </a>
            {' '}or contact your account manager.
          </p>
        </div>

      </div>
    </div>
  );
}