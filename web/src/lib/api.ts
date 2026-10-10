import type { ApiError } from '../../../shared/types';

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;
export const setCsrf = (t: string | null) => {
  csrfToken = t;
};

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (csrfToken && method !== 'GET') headers['x-csrf-token'] = csrfToken;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  } catch {
    throw new ApiFailure(0, 'NETWORK', 'Cannot reach the server. Check your Wi-Fi connection.');
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const e = (json as ApiError | null)?.error;
    throw new ApiFailure(res.status, e?.code ?? 'ERROR', e?.message ?? `Request failed (${res.status}).`);
  }
  return json as T;
}

/** Request ids must work on plain-HTTP LAN origins, where crypto.randomUUID is unavailable. */
export function newRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : 'Something went wrong.');
