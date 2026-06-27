import { NextRequest, NextResponse } from 'next/server';

const RELAYER = process.env.Kakusho_RELAYER_URL || 'http://localhost:8000';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { integrator_id, document_type } = body;

  if (!integrator_id) {
    return NextResponse.json({ detail: 'integrator_id required' }, { status: 400 });
  }

  const res = await fetch(`${RELAYER}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ integrator_id, document_type: document_type ?? 'passport' }),
  });

  if (!res.ok) {
    return NextResponse.json(await res.json(), { status: res.status });
  }

  return NextResponse.json(await res.json());
}