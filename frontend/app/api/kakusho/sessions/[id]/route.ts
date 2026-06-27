// app/api/kakusho/sessions/[session]/route.ts
import { NextRequest, NextResponse } from 'next/server';

interface Session {
  status: 'pending' | 'wallet_connected' | 'verified' | 'error';
  address?: string;
  tx_hash?: string;
  error?: string;
  created_at: number;
}

// In-memory — fine for a single Koyeb instance / local dev.
// In production swap for: await redis.set(`session:${id}`, JSON.stringify(s), 'EX', 600)
const sessions = new Map<string, Session>();

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

function isExpired(s: Session) {
  return Date.now() - s.created_at > SESSION_TTL_MS;
}

// GET /api/kakusho/sessions/[session]
// Desktop polls this to check progress.
export async function GET(
  _req: NextRequest,
  { params }: { params: { session: string } },
) {
  const s = sessions.get(params.session);
  if (!s) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (isExpired(s)) {
    sessions.delete(params.session);
    return NextResponse.json({ error: 'expired' }, { status: 410 });
  }
  return NextResponse.json(s);
}

// POST /api/kakusho/sessions/[session]
// Desktop creates the session when it shows the QR code.
export async function POST(
  _req: NextRequest,
  { params }: { params: { session: string } },
) {
  if (sessions.has(params.session)) {
    return NextResponse.json({ error: 'already_exists' }, { status: 409 });
  }
  sessions.set(params.session, {
    status: 'pending',
    created_at: Date.now(),
  });
  return NextResponse.json({ ok: true });
}

// PATCH /api/kakusho/sessions/[session]
// Mobile handoff page and verify page call this to advance the status.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { session: string } },
) {
  const s = sessions.get(params.session);
  if (!s) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (isExpired(s)) {
    sessions.delete(params.session);
    return NextResponse.json({ error: 'expired' }, { status: 410 });
  }

  let body: Partial<Session>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  // Only allow forward-only status transitions to prevent race conditions.
  const ORDER: Session['status'][] = ['pending', 'wallet_connected', 'verified', 'error'];
  const currentIdx = ORDER.indexOf(s.status);
  const incomingIdx = body.status ? ORDER.indexOf(body.status) : -1;

  if (body.status && incomingIdx < currentIdx && body.status !== 'error') {
    // Silently ignore backward transitions (idempotent retries are fine).
    return NextResponse.json({ ok: true, status: s.status });
  }

  sessions.set(params.session, { ...s, ...body });
  return NextResponse.json({ ok: true, status: body.status ?? s.status });
}