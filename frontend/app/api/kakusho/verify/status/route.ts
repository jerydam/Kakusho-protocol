// app/api/kakusho/verify/status/route.ts
import { NextRequest, NextResponse } from 'next/server';

const RELAYER = process.env.Kakusho_RELAYER_URL || 'https://worrying-drucy-faucetdrops-aab2b1e1.koyeb.app';

export async function GET(req: NextRequest) {
  const integratorId = req.nextUrl.searchParams.get('integrator_id');
  const stellarAddress = req.nextUrl.searchParams.get('stellar_address');

  if (!integratorId || !stellarAddress) {
    return NextResponse.json({ detail: 'integrator_id and stellar_address required' }, { status: 400 });
  }

  const res = await fetch(
    `${RELAYER}/proofs/status?integrator_id=${encodeURIComponent(integratorId)}&stellar_address=${encodeURIComponent(stellarAddress)}`,
  );

  if (!res.ok) {
    // If the relayer returns 404, that means "not verified yet" — not an error
    if (res.status === 404) return NextResponse.json({ verified: false });
    return NextResponse.json(await res.json(), { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json({ verified: data.status === 'confirmed' });
}