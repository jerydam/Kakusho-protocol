import { NextRequest, NextResponse } from 'next/server';

const RELAYER = process.env.Kakusho_RELAYER_URL || 'http://localhost:8000';

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key') || '';
  if (!apiKey) {
    return NextResponse.json({ detail: 'X-API-Key required' }, { status: 401 });
  }

  const [meRes, statsRes] = await Promise.all([
    fetch(`${RELAYER}/integrators/me`, { headers: { 'X-API-Key': apiKey } }),
    fetch(`${RELAYER}/integrators/me/stats`, { headers: { 'X-API-Key': apiKey } }),
  ]);

  if (!meRes.ok) {
    return NextResponse.json(await meRes.json(), { status: meRes.status });
  }

  const integrator = await meRes.json();
  const stats = statsRes.ok ? await statsRes.json() : { used_today: 0, limit: integrator.daily_sponsored_tx_limit, total_submissions: 0 };

  return NextResponse.json({ integrator, stats });
}