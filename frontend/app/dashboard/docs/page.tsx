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
    <div className="mb-10">
      <p className="kz-mono text-[9px] tracking-widest text-kz-slate mb-1">{title}</p>
      <div className="w-8 h-px bg-kz-cyan/20 mb-5" />
      {children}
    </div>
  );
}

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-kz-void">
      <nav className="border-b border-kz-surfaceLine px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="kz-mono text-[9px] text-kz-cyan/40 hover:text-kz-cyan tracking-widest transition-colors">
          ← DASHBOARD
        </Link>
        <span className="kz-mono text-[9px] text-white/20">/</span>
        <span className="kz-mono text-[9px] text-white/60 tracking-widest">SDK_DOCS</span>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="mb-10">
          <p className="kz-mono text-[9px] text-kz-cyan/50 tracking-widest mb-2">INTEGRATION GUIDE</p>
          <h1 className="kz-display text-3xl font-bold text-white tracking-tight">SDK Documentation</h1>
          <p className="kz-mono text-[10px] text-kz-slate mt-2 tracking-wide">
            Add ZK KYC to your app in 4 steps. No PII ever leaves the user's device.
          </p>
        </div>

        <Section title="01 · INSTALL">
          <CodeBlock language="bash" code={`npm install @kakusho/zk-kyc-sdk snarkjs tesseract.js @mediapipe/tasks-vision`} />
          <p className="kz-mono text-[10px] text-kz-slate mt-3 tracking-wide leading-relaxed">
            The SDK runs entirely client-side. <span className="text-kz-cyan/60">snarkjs</span> handles Groth16 proving in a Web Worker.
            <span className="text-kz-cyan/60"> tesseract.js</span> reads document fields via OCR.
            <span className="text-kz-cyan/60"> @mediapipe/tasks-vision</span> does the liveness check.
          </p>
        </Section>

        <Section title="02 · HOST CIRCUIT ASSETS">
          <p className="kz-mono text-[10px] text-kz-slate mb-4 tracking-wide leading-relaxed">
            Upload these two files to a CDN (Cloudflare R2, S3, etc.). They're large so don't serve from your own origin.
          </p>
          <CodeBlock language="bash" code={`# Files to upload after running trusted_setup.sh:
circuits/build/kyc_ocr_js/kyc_ocr.wasm   → https://cdn.your-org.com/kyc_ocr.wasm
circuits/build/kyc_ocr_final.zkey         → https://cdn.your-org.com/kyc_ocr_final.zkey

# Set long cache headers — these only change when you rerun trusted setup:
Cache-Control: public, max-age=31536000, immutable`} />
        </Section>

        <Section title="03 · CONFIGURE">
          <CodeBlock language="typescript" code={`// .env.local in your Next.js app
NEXT_PUBLIC_KAKUSHO_RELAYER_URL=http://localhost:8000
NEXT_PUBLIC_KAKUSHO_API_KEY=zkkyc_your_key_here
NEXT_PUBLIC_WASM_URL=https://cdn.your-org.com/kyc_ocr.wasm
NEXT_PUBLIC_ZKEY_URL=https://cdn.your-org.com/kyc_ocr_final.zkey`} />
        </Section>

        <Section title="04 · GENERATE PROOF">
          <CodeBlock language="typescript" code={`import { generateKycProof, submitProof, KycRejectedError } from '@kakusho/zk-kyc-sdk';

// 1. Load your integrator assets (fetch once, cache in state)
const integratorAssets = {
  integratorId: '0101...01',          // from Kakushō dashboard
  minAgeSeconds: BigInt(568025136),    // 18 years
  docMaxAgeSeconds: BigInt(315360000), // 10 years
  countryCodeMap: await fetch('/assets/country_codes.json').then(r => r.json()),
  restrictedTree: await fetch('/assets/restricted_tree.json').then(r => r.json()),
};

try {
  // 2. Generate proof client-side (no data leaves the browser)
  const proof = await generateKycProof({
    idDocument: documentFile,                          // File from <input>
    selfies: [leftFile, rightFile, upFile, downFile],  // 4 pose selfies
    integratorAssets,
    proverAssets: {
      wasmUrl: process.env.NEXT_PUBLIC_WASM_URL!,
      zkeyUrl: process.env.NEXT_PUBLIC_ZKEY_URL!,
    },
    onProgress: (stage) => setStage(stage), // ocr | liveness | generating_proof | done
  });

  // 3. Submit proof to Kakushō relayer (pays Stellar fees for the user)
  const result = await submitProof(
    proof,
    process.env.NEXT_PUBLIC_KAKUSHO_RELAYER_URL!,
    process.env.NEXT_PUBLIC_KAKUSHO_API_KEY!,
    userStellarAddress, // optional
  );

  console.log('Verified! tx:', result.tx_hash);

} catch (e) {
  if (e instanceof KycRejectedError) {
    // reason: 'ocr_failed' | 'liveness_failed' | 'predicate_failed'
    console.error(e.reason, e.message);
  }
}`} />
        </Section>

        <Section title="05 · STATUS WIDGET">
          <p className="kz-mono text-[10px] text-kz-slate mb-4 tracking-wide">
            Drop-in badge that shows verified status or a "complete KYC" CTA.
          </p>
          <CodeBlock language="typescript" code={`import { KYCWidget } from '@kakusho/zk-kyc-sdk/widget';

// Shows ● PROOF_VALID badge if user is verified, otherwise CTA button
<KYCWidget
  walletAddress={userStellarAddress}
  relayerUrl={process.env.NEXT_PUBLIC_KAKUSHO_RELAYER_URL}
  kycUrl="https://your-app.com/kyc"
  compact={false}
/>`} />
        </Section>

        <Section title="06 · WEBHOOK VERIFICATION">
          <p className="kz-mono text-[10px] text-kz-slate mb-4 tracking-wide">
            Verify every webhook delivery using the HMAC-SHA256 signature in <span className="text-kz-cyan/60">X-Webhook-Signature</span>.
          </p>
          <CodeBlock language="typescript" code={`// pages/api/webhook.ts (Next.js)
import crypto from 'crypto';

export async function POST(req: Request) {
  const rawBody = await req.text();
  const sig = req.headers.get('x-webhook-signature');

  const expected = crypto
    .createHmac('sha256', process.env.KAKUSHO_WEBHOOK_SECRET!)
    .update(rawBody)
    .digest('hex');

  if (sig !== expected) {
    return new Response('Unauthorized', { status: 401 });
  }

  const event = JSON.parse(rawBody);
  // event.event === 'kyc.verification.completed'
  // event.status === 'confirmed' | 'rejected'
  // event.nullifier_hex — unique per user per integrator

  // Mark user as verified in your DB using event.nullifier_hex
  await db.users.update({
    where: { nullifier: event.nullifier_hex },
    data: { kyc_verified: event.status === 'confirmed' },
  });

  return new Response('OK', { status: 200 });
}`} />
        </Section>

        <Section title="PROGRESS STAGES">
          <div className="space-y-2">
            {[
              { stage: 'ocr', desc: 'Tesseract.js reads document fields in-browser' },
              { stage: 'liveness', desc: 'MediaPipe checks 4 selfie poses (left, right, up, down)' },
              { stage: 'fetching_wasm', desc: 'Downloading circuit WASM from your CDN' },
              { stage: 'fetching_zkey', desc: 'Downloading proving key (~13MB) from your CDN' },
              { stage: 'computing_witness', desc: 'Building Groth16 witness from document fields' },
              { stage: 'generating_proof', desc: 'Running Groth16 prover in Web Worker (10–60s)' },
              { stage: 'done', desc: 'Proof ready to submit' },
            ].map(({ stage, desc }) => (
              <div key={stage} className="flex items-start gap-4 py-3 border-b border-kz-surfaceLine/50">
                <span className="kz-mono text-[10px] text-kz-cyan tracking-widest w-36 shrink-0">{stage}</span>
                <span className="kz-mono text-[10px] text-kz-slate tracking-wide">{desc}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="ERRORS">
          <div className="space-y-2">
            {[
              { cls: 'KycRejectedError (ocr_failed)', desc: 'Document unreadable or fields missing — ask user to retake' },
              { cls: 'KycRejectedError (liveness_failed)', desc: 'Not all 4 poses detected — list missing poses from e.message' },
              { cls: 'KycRejectedError (predicate_failed)', desc: "User doesn't meet age or country rules for this integrator" },
              { cls: 'OCRError', desc: 'Tesseract failed to process the image entirely' },
              { cls: 'WitnessBuildError', desc: 'Date parsing failed or nationality not in country code map' },
            ].map(({ cls, desc }) => (
              <div key={cls} className="flex items-start gap-4 py-3 border-b border-kz-surfaceLine/50">
                <span className="kz-mono text-[10px] text-kz-danger/70 tracking-wide w-48 shrink-0">{cls}</span>
                <span className="kz-mono text-[10px] text-kz-slate tracking-wide">{desc}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}