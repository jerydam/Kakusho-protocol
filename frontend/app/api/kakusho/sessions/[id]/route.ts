import { NextRequest, NextResponse } from 'next/server';

const RELAYER = process.env.Kakusho_RELAYER_URL || 'https://worrying-drucy-faucetdrops-aab2b1e1.koyeb.app';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const res = await fetch(`${RELAYER}/sessions/${encodeURIComponent(params.id)}`, {
    // Polling endpoint — never cache, the desktop tab needs the live status.
    cache: 'no-store',
  });

  if (!res.ok) {
    return NextResponse.json(await res.json(), { status: res.status });
  }
  return NextResponse.json(await res.json());
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();

  const res = await fetch(`${RELAYER}/sessions/${encodeURIComponent(params.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return NextResponse.json(await res.json(), { status: res.status });
  }
  return NextResponse.json(await res.json());
}