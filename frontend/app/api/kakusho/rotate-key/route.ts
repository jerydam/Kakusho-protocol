// ── rotate-key/route.ts ──────────────────────────────────────────────────────
// app/api/Kakusho/rotate-key/route.ts
import { NextRequest, NextResponse } from 'next/server';

const RELAYER = process.env.Kakusho_RELAYER_URL || 'https://worrying-drucy-faucetdrops-aab2b1e1.koyeb.app';

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key') || '';
  if (!apiKey) return NextResponse.json({ detail: 'X-API-Key required' }, { status: 401 });

  const res = await fetch(`${RELAYER}/integrators/me/rotate-key`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey },
  });

  return NextResponse.json(await res.json(), { status: res.status });
}
