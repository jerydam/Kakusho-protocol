import { NextRequest, NextResponse } from 'next/server';
import { Keypair } from '@stellar/stellar-sdk';
import { createHash } from 'crypto';

const RELAYER = process.env.Kakusho_RELAYER_URL || 'http://localhost:8000';

function sep53Hash(message: string): Buffer {
  const prefix = Buffer.from('Stellar Signed Message:\n', 'utf-8');
  const payload = Buffer.concat([prefix, Buffer.from(message, 'utf-8')]);
  return createHash('sha256').update(payload).digest();
}

function verifySignature(stellar_address: string, message: string, signed_message: string): boolean {
  const kp = Keypair.fromPublicKey(stellar_address);
  const hash = sep53Hash(message);
  return kp.verify(hash, Buffer.from(signed_message, 'base64'));
}

export async function POST(req: NextRequest) {
  const { stellar_address, signed_message, message, integrator_id } = await req.json();

  if (!stellar_address || !signed_message || !message) {
    return NextResponse.json({ detail: 'Missing required fields' }, { status: 400 });
  }

  // Single, correct signature verification using SEP-53 hash
  try {
    if (!verifySignature(stellar_address, message, signed_message)) {
      return NextResponse.json({ detail: 'Invalid signature' }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ detail: 'Signature verification failed' }, { status: 401 });
  }

  if (!integrator_id) {
    const ownerRes = await fetch(`${RELAYER}/integrators/by-owner/${encodeURIComponent(stellar_address)}`);
    if (!ownerRes.ok) {
      if (ownerRes.status === 404) {
        return NextResponse.json({ detail: 'No projects found. Register first.' }, { status: 404 });
      }
      return NextResponse.json(await ownerRes.json(), { status: ownerRes.status });
    }
    const projects = await ownerRes.json();
    if (projects.length > 1) {
      return NextResponse.json({ projects });
    }
    return loginWithProject(stellar_address, signed_message, message, projects[0].id);
  }

  return loginWithProject(stellar_address, signed_message, message, integrator_id);
}

async function loginWithProject(
  stellar_address: string,
  signed_message: string,
  message: string,
  integrator_id: string,
) {
  const rotateRes = await fetch(`${RELAYER}/integrators/rotate-by-owner`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stellar_address, signed_message, message, integrator_id }),
  });
  if (!rotateRes.ok) return NextResponse.json(await rotateRes.json(), { status: rotateRes.status });
  const { api_key } = await rotateRes.json();
  return NextResponse.json({ api_key });
}