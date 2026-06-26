import { NextRequest, NextResponse } from 'next/server';

// In-memory nonce store — replace with Redis or DB for production
const nonces = new Map<string, { nonce: string; expires: number }>();

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address') || '';
  if (!address) {
    return NextResponse.json({ error: 'address required' }, { status: 400 });
  }

  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const expires = Date.now() + 5 * 60 * 1000; // 5 minutes

  const message =
    `Kakusho Dashboard Authentication\n\n` +
    `Address: ${address}\n` +
    `Nonce: ${nonce}\n` +
    `Issued: ${new Date().toISOString()}\n` +
    `Expires: ${new Date(expires).toISOString()}\n\n` +
    `Sign this message to prove ownership of your Stellar address.`;

  nonces.set(address.toLowerCase(), { nonce, expires });

  // Clean up expired nonces
  for (const [key, val] of nonces.entries()) {
    if (val.expires < Date.now()) nonces.delete(key);
  }

  return NextResponse.json({ message, nonce });
}
