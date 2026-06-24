import { NextRequest, NextResponse } from 'next/server';
import { apiKeyCache } from '../_lib/apiKeyCache';

const RELAYER = process.env.TRUSTID_RELAYER_URL || 'http://localhost:8000';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, webhook_url, owner_stellar_address, integrator_id_hex, min_age_seconds, doc_max_age_seconds } = body;

  if (!name || !owner_stellar_address || !integrator_id_hex) {
    return NextResponse.json(
      { detail: 'name, owner_stellar_address, and integrator_id_hex are required' },
      { status: 400 },
    );
  }

  const relayerRes = await fetch(`${RELAYER}/integrators`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ integrator_id_hex, name, owner_stellar_address, webhook_url: webhook_url || null, min_age_seconds, doc_max_age_seconds }),
  });

  if (!relayerRes.ok) {
    return NextResponse.json(await relayerRes.json(), { status: relayerRes.status });
  }

  const data = await relayerRes.json();
  apiKeyCache.set(data.id, data.api_key);

  return NextResponse.json({
    api_key: data.api_key,
    integrator_id_hex,
    id: data.id,
    message: 'Integrator registered. Your API key is shown only once.',
  });
}