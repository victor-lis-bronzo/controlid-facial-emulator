/**
 * Typed API client for the emulator's Control Panel and Interception APIs.
 *
 * Uses same-origin `fetch` with an empty base path so it works both when the
 * SPA is served by the API at `/admin` and via the Vite dev-server proxy for
 * `/api` (see vite.config.ts). On a non-2xx response it throws an
 * {@link ApiError} carrying the server's `error-description` message when
 * present, so callers can surface a meaningful message while retaining the
 * developer's selection (Req 7.8).
 */
import type { InterceptionRecord, PushOutcome, UserRecord } from './types.ts';

export type { InterceptionRecord, PushOutcome, UserRecord } from './types.ts';

/** Same-origin base path; empty so requests resolve under `/admin` or the proxy. */
const BASE_PATH = '';

/** Shape of an error body returned by the API on a failed request. */
interface ApiErrorBody {
  'error-description'?: string;
  message?: string;
}

/** An error raised for a failed API request, carrying the HTTP status. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (text.length === 0) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

/**
 * Executes a request and returns the parsed JSON body. Throws {@link ApiError}
 * on a non-2xx response (preferring the server's `error-description`) or on a
 * network/parse failure.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_PATH}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new ApiError(`Network request failed: ${detail}`, 0);
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const body = await parseJson<ApiErrorBody>(response);
      const description = body?.['error-description'] ?? body?.message;
      if (typeof description === 'string' && description.length > 0) {
        message = description;
      }
    } catch {
      // Non-JSON error body; keep the generic status message.
    }
    throw new ApiError(message, response.status);
  }

  return parseJson<T>(response);
}

/** `GET /api/identities` — list selectable identities (Req 7.3). */
export function getIdentities(): Promise<UserRecord[]> {
  return request<UserRecord[]>('/api/identities');
}

/** `POST /api/simulate/authorized` — simulate an authorized access (Req 6.1). */
export function simulateAuthorized(userId: number): Promise<PushOutcome> {
  return request<PushOutcome>('/api/simulate/authorized', {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}

/** `POST /api/simulate/denied` — simulate a denied access (Req 6.2). */
export function simulateDenied(): Promise<PushOutcome> {
  return request<PushOutcome>('/api/simulate/denied', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** `POST /api/simulate/keep-alive` — force a keep-alive event (Req 6.3). */
export function simulateKeepAlive(): Promise<PushOutcome> {
  return request<PushOutcome>('/api/simulate/keep-alive', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** `GET /api/interception?limit=` — newest-first interception records (Req 8.5). */
export function getInterception(limit?: number): Promise<InterceptionRecord[]> {
  const query =
    typeof limit === 'number' ? `?limit=${encodeURIComponent(limit)}` : '';
  return request<InterceptionRecord[]>(`/api/interception${query}`);
}
