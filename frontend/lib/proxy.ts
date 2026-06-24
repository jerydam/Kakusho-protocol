/**
 * lib/proxy.ts
 *
 * Thin helpers for forwarding requests to the FastAPI backend.
 * All routes use these instead of calling FastAPI directly,
 * so the base URL is always read from one place.
 */

const BASE = () => {
  const url = "http://127.0.0.1:8000";
  if (!url) throw new Error('FASTAPI_URL env var is not set');
  return url.replace(/\/$/, ''); // strip trailing slash
};

// ── JSON proxy ─────────────────────────────────────────────────────

export async function proxyJSON(
  path: string,
  method: string,
  body: unknown,
  authHeader?: string | null
): Promise<Response> {
  return fetch(`${BASE()}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ── GET proxy ──────────────────────────────────────────────────────

export async function proxyGET(
  path: string,
  authHeader?: string | null,
  queryParams?: Record<string, string>
): Promise<Response> {
  const url = new URL(`${BASE()}${path}`);
  if (queryParams) {
    Object.entries(queryParams).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  return fetch(url.toString(), {
    headers: {
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
  });
}

// ── FormData proxy ─────────────────────────────────────────────────

export async function proxyFormData(
  path: string,
  formData: FormData,
  authHeader?: string | null
): Promise<Response> {
  return fetch(`${BASE()}${path}`, {
    method: 'POST',
    headers: {
      // Do NOT set Content-Type — let fetch set it with the boundary
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: formData,
  });
}

// ── Response helper ────────────────────────────────────────────────

/**
 * Forward a FastAPI Response as a Next.js NextResponse.
 * Preserves status code and passes the JSON body through.
 */
export async function forwardResponse(res: Response): Promise<import('next/server').NextResponse> {
  const { NextResponse } = await import('next/server');
  const data = await res.json().catch(() => ({ error: 'Backend returned non-JSON response' }));
  return NextResponse.json(data, { status: res.status });
}