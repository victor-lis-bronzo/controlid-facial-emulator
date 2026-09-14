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


// ===========================================================================
// Admin Management Panel API clients (Req 2–10).
//
// These reuse the same `request<T>`/`ApiError` semantics as the control-panel
// functions above and target the same-origin `/api/admin/*` surface. Reads
// require no session; every mutation appends `?session=<token>` obtained from
// the session helper (Req 10.2, 10.3). See design.md → "Frontend → API client".
// ===========================================================================

import type {
  AccessLogFilter,
  AccessLogRecord,
  AccessRuleView,
  AccessRuleWriteDto,
  AdminUserView,
  DashboardData,
  GroupDetail,
  GroupView,
  GroupWriteDto,
  PortalView,
  PortalWriteDto,
  TimeZoneView,
  TimeZoneWriteDto,
  UserWriteDto,
} from './types.ts';

export type {
  AccessLogFilter,
  AccessLogRecord,
  AccessRuleView,
  AccessRuleWriteDto,
  AdminUserView,
  DashboardCounts,
  DashboardData,
  GroupDetail,
  GroupView,
  GroupWriteDto,
  PortalView,
  PortalWriteDto,
  TimeRangeView,
  TimeRangeWriteDto,
  TimeZoneView,
  TimeZoneWriteDto,
  UserWriteDto,
} from './types.ts';

/** Response body of a successful `POST /login.fcgi`. */
interface LoginResponse {
  session: string;
}

/** Default admin credentials for this dev tool (documented in README). */
const DEFAULT_LOGIN = 'admin';
const DEFAULT_PASSWORD = 'admin';

/** sessionStorage key under which the admin session token is cached. */
const SESSION_STORAGE_KEY = 'controlid-admin-session';

/** In-memory cache of the current session token (mirrors sessionStorage). */
let cachedSession: string | null = null;

/** Read any persisted token from `sessionStorage` (survives reloads, per-tab). */
function readStoredSession(): string | null {
  try {
    return window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Persist the token to `sessionStorage`, ignoring storage failures. */
function writeStoredSession(token: string): void {
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, token);
  } catch {
    // Storage unavailable (private mode / tests) — the in-memory cache still works.
  }
}

/**
 * Authenticate against the existing `POST /login.fcgi` device flow with the
 * default admin credentials and cache the returned token (Req 10.1). Mutations
 * append this token as `?session=`.
 */
export async function login(
  loginName = DEFAULT_LOGIN,
  password = DEFAULT_PASSWORD,
): Promise<string> {
  const body = await request<LoginResponse>('/login.fcgi', {
    method: 'POST',
    body: JSON.stringify({ login: loginName, password }),
  });
  cachedSession = body.session;
  writeStoredSession(body.session);
  return body.session;
}

/**
 * Return a valid session token, logging in on demand if none is cached (Req
 * 10.1). Admin mutations call this to obtain the `?session=` value; a fresh
 * login is transparent for this dev tool.
 */
export async function ensureSession(): Promise<string> {
  if (cachedSession !== null) {
    return cachedSession;
  }
  const stored = readStoredSession();
  if (stored !== null && stored.length > 0) {
    cachedSession = stored;
    return stored;
  }
  return login();
}

/** Forget the cached token (used to force re-login after a 401). */
export function clearSession(): void {
  cachedSession = null;
  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Append `?session=<token>`, ensuring a fresh token exists first. */
async function withSession(path: string): Promise<string> {
  const token = await ensureSession();
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}session=${encodeURIComponent(token)}`;
}

/** JSON mutation helper: obtains a session, then issues the request. */
async function mutate<T>(
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const url = await withSession(path);
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return request<T>(url, init);
}

/** Users admin client (Req 2, 3). */
export const adminUsers = {
  list: (): Promise<AdminUserView[]> => request<AdminUserView[]>('/api/admin/users'),
  get: (id: number): Promise<AdminUserView> =>
    request<AdminUserView>(`/api/admin/users/${String(id)}`),
  create: (body: UserWriteDto): Promise<AdminUserView> =>
    mutate<AdminUserView>('/api/admin/users', 'POST', body),
  update: (id: number, body: UserWriteDto): Promise<AdminUserView> =>
    mutate<AdminUserView>(`/api/admin/users/${String(id)}`, 'PUT', body),
  remove: (id: number): Promise<{ deleted: boolean }> =>
    mutate<{ deleted: boolean }>(`/api/admin/users/${String(id)}`, 'DELETE'),
  uploadPhoto: async (id: number, file: File): Promise<{ hasPhoto: boolean }> => {
    const url = await withSession(`/api/admin/users/${String(id)}/photo`);
    const fd = new FormData();
    fd.append('file', file);
    // Empty headers so the browser sets the multipart boundary itself; this
    // overrides the default JSON Content-Type in `request`.
    return request<{ hasPhoto: boolean }>(url, {
      method: 'POST',
      body: fd,
      headers: {},
    });
  },
  deletePhoto: (id: number): Promise<{ hasPhoto: boolean }> =>
    mutate<{ hasPhoto: boolean }>(`/api/admin/users/${String(id)}/photo`, 'DELETE'),
};

/** Groups admin client (Req 4). */
export const adminGroups = {
  list: (): Promise<GroupView[]> => request<GroupView[]>('/api/admin/groups'),
  get: (id: number): Promise<GroupDetail> =>
    request<GroupDetail>(`/api/admin/groups/${String(id)}`),
  create: (body: GroupWriteDto): Promise<GroupDetail> =>
    mutate<GroupDetail>('/api/admin/groups', 'POST', body),
  update: (id: number, body: GroupWriteDto): Promise<GroupDetail> =>
    mutate<GroupDetail>(`/api/admin/groups/${String(id)}`, 'PUT', body),
  remove: (id: number): Promise<{ deleted: boolean }> =>
    mutate<{ deleted: boolean }>(`/api/admin/groups/${String(id)}`, 'DELETE'),
};

/** Portals admin client (Req 6). */
export const adminPortals = {
  list: (): Promise<PortalView[]> => request<PortalView[]>('/api/admin/portals'),
  get: (id: number): Promise<PortalView> =>
    request<PortalView>(`/api/admin/portals/${String(id)}`),
  create: (body: PortalWriteDto): Promise<PortalView> =>
    mutate<PortalView>('/api/admin/portals', 'POST', body),
  update: (id: number, body: PortalWriteDto): Promise<PortalView> =>
    mutate<PortalView>(`/api/admin/portals/${String(id)}`, 'PUT', body),
  remove: (id: number): Promise<{ deleted: boolean }> =>
    mutate<{ deleted: boolean }>(`/api/admin/portals/${String(id)}`, 'DELETE'),
};

/** Time Zones admin client (Req 5). */
export const adminTimeZones = {
  list: (): Promise<TimeZoneView[]> => request<TimeZoneView[]>('/api/admin/time-zones'),
  get: (id: number): Promise<TimeZoneView> =>
    request<TimeZoneView>(`/api/admin/time-zones/${String(id)}`),
  create: (body: TimeZoneWriteDto): Promise<TimeZoneView> =>
    mutate<TimeZoneView>('/api/admin/time-zones', 'POST', body),
  update: (id: number, body: TimeZoneWriteDto): Promise<TimeZoneView> =>
    mutate<TimeZoneView>(`/api/admin/time-zones/${String(id)}`, 'PUT', body),
  remove: (id: number): Promise<{ deleted: boolean }> =>
    mutate<{ deleted: boolean }>(`/api/admin/time-zones/${String(id)}`, 'DELETE'),
};

/** Access Rules admin client (Req 7). */
export const adminAccessRules = {
  list: (): Promise<AccessRuleView[]> =>
    request<AccessRuleView[]>('/api/admin/access-rules'),
  get: (id: number): Promise<AccessRuleView> =>
    request<AccessRuleView>(`/api/admin/access-rules/${String(id)}`),
  create: (body: AccessRuleWriteDto): Promise<AccessRuleView> =>
    mutate<AccessRuleView>('/api/admin/access-rules', 'POST', body),
  update: (id: number, body: AccessRuleWriteDto): Promise<AccessRuleView> =>
    mutate<AccessRuleView>(`/api/admin/access-rules/${String(id)}`, 'PUT', body),
  remove: (id: number): Promise<{ deleted: boolean }> =>
    mutate<{ deleted: boolean }>(`/api/admin/access-rules/${String(id)}`, 'DELETE'),
};

/** Access Logs admin client — read-only with optional filters (Req 8). */
export const adminAccessLogs = {
  list: (filter: AccessLogFilter = {}): Promise<AccessLogRecord[]> => {
    const params = new URLSearchParams();
    if (filter.userId !== undefined && filter.userId !== '') {
      params.set('user_id', filter.userId);
    }
    if (filter.event !== undefined && filter.event !== '') {
      params.set('event', filter.event);
    }
    if (filter.from !== undefined && filter.from !== '') {
      params.set('from', filter.from);
    }
    if (filter.to !== undefined && filter.to !== '') {
      params.set('to', filter.to);
    }
    const query = params.toString();
    return request<AccessLogRecord[]>(
      `/api/admin/access-logs${query.length > 0 ? `?${query}` : ''}`,
    );
  },
};

/** Dashboard admin client — read-only aggregate (Req 9). */
export const adminDashboard = {
  get: (): Promise<DashboardData> => request<DashboardData>('/api/admin/dashboard'),
};
