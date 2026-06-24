/**
 * lib/auth.ts
 *
 * Option A: FastAPI is the sole JWT authority.
 * This file only VERIFIES tokens that FastAPI issued.
 * It no longer signs anything.
 */

import { NextRequest } from 'next/server';
import { AuthPayload } from './types';

const JWT_SECRET = process.env.JWT_SECRET || '';

// ── base64url helpers ──────────────────────────────────────────────

function decodeBase64url(str: string): string {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

async function hmacVerify(data: string, secret: string, sig: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  // decode the received signature from base64url
  const padded = sig + '='.repeat((4 - (sig.length % 4)) % 4);
  const sigBytes = Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(data));
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Verify a JWT issued by FastAPI.
 * FastAPI uses python-jose with HS256 and a payload shaped like:
 *   { sub: "<user_id>", exp: <unix>, type: "access" }
 *
 * We map that onto AuthPayload for use in Next.js route handlers.
 */
export async function verifyJwt(token: string): Promise<AuthPayload | null> {
  if (!JWT_SECRET) {
    console.error('[auth] JWT_SECRET is not set');
    return null;
  }

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;

    const valid = await hmacVerify(`${header}.${body}`, JWT_SECRET, sig);
    if (!valid) return null;

    const raw = JSON.parse(decodeBase64url(body));

    // FastAPI sets type: "access" and sub: user_id (UUID string)
    if (raw.type !== 'access') return null;
    if (raw.exp < Math.floor(Date.now() / 1000)) return null;

    return {
      userId: raw.sub,
      walletAddress: raw.wallet_address ?? '',
      isAdmin: raw.is_admin ?? false,
      iat: raw.iat,
      exp: raw.exp,
    } satisfies AuthPayload;
  } catch {
    return null;
  }
}

export async function getAuthFromRequest(req: NextRequest): Promise<AuthPayload | null> {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  return verifyJwt(auth.slice(7));
}

/** Nonce generation (still used by the nonce route) */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}