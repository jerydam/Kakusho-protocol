// app/api/kakusho/verify/integrator-info/route.ts
import { NextRequest, NextResponse } from 'next/server';

const RELAYER = process.env.Kakusho_RELAYER_URL || 'http://localhost:8000';

export async function GET(req: NextRequest) {
  const integratorId = req.nextUrl.searchParams.get('integrator_id');
  if (!integratorId) {
    return NextResponse.json({ detail: 'integrator_id required' }, { status: 400 });
  }

  const res = await fetch(`${RELAYER}/integrators/public/${encodeURIComponent(integratorId)}`);
  if (!res.ok) {
    return NextResponse.json({ detail: 'Integrator not found' }, { status: res.status });
  }

  const data = await res.json();

  // Shape the response for the verify page — only expose what users need to see.
  // allowed_document_types / nfc_policy drive which document-type picker options
  // are shown and whether the NFC (vs OCR-only) flow is forced for the type the
  // user picks — see app/verify/mobile/[session]/page.tsx and QRHandoff.tsx.
  return NextResponse.json({
    name: data.name,
    integrator_id_hex: data.integrator_id_hex,
    min_age_years: Math.round((data.min_age_seconds ?? 568025136) / (365 * 24 * 3600)),
    doc_max_age_years: Math.round((data.doc_max_age_seconds ?? 315360000) / (365 * 24 * 3600)),
    restricted_countries: data.restricted_countries ?? [],
    allowed_document_types: data.allowed_document_types ?? ['passport'],
    nfc_policy: data.nfc_policy ?? 'required_for_passport',
  });
}