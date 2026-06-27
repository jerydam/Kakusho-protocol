import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const RELAYER = process.env.Kakusho_RELAYER_URL || 'https://worrying-drucy-faucetdrops-aab2b1e1.koyeb.app';

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key') || '';
  if (!apiKey) return NextResponse.json({ detail: 'X-API-Key required' }, { status: 401 });

  // Get integrator details
  const meRes = await fetch(`${RELAYER}/integrators/me`, {
    headers: { 'X-API-Key': apiKey },
  });
  if (!meRes.ok) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });
  const integrator = await meRes.json();

  if (!integrator.webhook_url) {
    return NextResponse.json({ detail: 'No webhook URL configured' }, { status: 400 });
  }

  const payload = JSON.stringify({
    event: 'kyc.verification.completed',
    integrator_id_hex: integrator.integrator_id_hex,
    nullifier_hex: 'test_' + '0'.repeat(59),
    status: 'confirmed',
    tx_hash: 'test_' + crypto.randomBytes(28).toString('hex'),
    submission_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    _test: true,
  });

  // Sign with webhook secret — relayer stores it, we get it via a dedicated endpoint
  const secretRes = await fetch(`${RELAYER}/integrators/me/webhook-secret`, {
    headers: { 'X-API-Key': apiKey },
  });
  const secret = secretRes.ok ? (await secretRes.json()).webhook_secret : 'test-secret';
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  try {
    const webhookRes = await fetch(integrator.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': sig,
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });

    if (!webhookRes.ok) {
      return NextResponse.json(
        { detail: `Endpoint returned ${webhookRes.status}` },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, status: webhookRes.status });
  } catch (e: any) {
    return NextResponse.json({ detail: e.message || 'Delivery failed' }, { status: 502 });
  }
}
