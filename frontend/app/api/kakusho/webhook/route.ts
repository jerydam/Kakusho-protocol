import { NextRequest, NextResponse } from 'next/server';

const RELAYER = process.env.TRUSTID_RELAYER_URL || 'http://localhost:8000';

export async function PATCH(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key') || '';
  if (!apiKey) return NextResponse.json({ detail: 'X-API-Key required' }, { status: 401 });

  const { webhook_url } = await req.json();

  const url = new URL(`${RELAYER}/integrators/me/webhook`);
  if (webhook_url) url.searchParams.set('webhook_url', webhook_url);

  const res = await fetch(url.toString(), {
    method: 'PATCH',
    headers: { 'X-API-Key': apiKey },
  });

  return NextResponse.json(await res.json(), { status: res.status });
}
