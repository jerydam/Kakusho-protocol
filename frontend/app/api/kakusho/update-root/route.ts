import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';

const RELAYER = process.env.Kakusho_RELAYER_URL || 'https://worrying-drucy-faucetdrops-aab2b1e1.koyeb.app';
const CONTRACT_ID = process.env.KYC_REGISTRY_CONTRACT_ID || '';
const STELLAR_SOURCE = process.env.STELLAR_SOURCE_ACCOUNT || 'admin';
const STELLAR_NETWORK = process.env.STELLAR_NETWORK || 'testnet';

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key') || '';
  if (!apiKey) return NextResponse.json({ detail: 'X-API-Key required' }, { status: 401 });

  const { restricted_root } = await req.json();
  if (!restricted_root || !/^[0-9a-f]{64}$/i.test(restricted_root)) {
    return NextResponse.json(
      { detail: 'restricted_root must be a 64-char hex string' },
      { status: 400 }
    );
  }

  if (!CONTRACT_ID) {
    return NextResponse.json(
      { detail: 'KYC_REGISTRY_CONTRACT_ID not configured on server' },
      { status: 500 }
    );
  }

  // Get integrator details
  const meRes = await fetch(`${RELAYER}/integrators/me`, {
    headers: { 'X-API-Key': apiKey },
  });
  if (!meRes.ok) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });
  const integrator = await meRes.json();

  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        'stellar',
        [
          'contract', 'invoke',
          '--id', CONTRACT_ID,
          '--source', STELLAR_SOURCE,
          '--network', STELLAR_NETWORK,
          '--',
          'update_integrator_rules',
          '--integrator_id', integrator.integrator_id_hex,
          '--min_age_seconds', String(integrator.min_age_seconds || 568025136),
          '--restricted_root', restricted_root,
          '--doc_max_age_seconds', String(integrator.doc_max_age_seconds || 315360000),
        ],
        { timeout: 60_000 },
        (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve();
        }
      );
    });

    return NextResponse.json({ ok: true, restricted_root });
  } catch (e: any) {
    return NextResponse.json({ detail: e.message }, { status: 500 });
  }
}
