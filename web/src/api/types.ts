/**
 * TypeScript types mirroring the Control Panel / Interception API contracts
 * exposed by the emulator (see the design's "ControlPanelApi", "Interception
 * API", and shared type modules in `api/src/shared`). Kept in sync with the
 * server-side shapes; the web app only consumes these read-only.
 */

/**
 * A user/identity record returned by `GET /api/identities`. Feeds the identity
 * picker for authorized-access simulation (Req 7.3). Extra device fields may be
 * present but the panel only relies on `id`, `registration`, and `name`.
 */
export interface UserRecord {
  id: number;
  registration: string;
  name: string;
  password?: string;
  image_path?: string;
}

/** Category of a failed webhook dispatch, surfaced in the outcome (Req 8.4). */
export type PushFailureCategory =
  | 'no_target'
  | 'timeout'
  | 'unreachable'
  | 'http_error';

/**
 * The result of a simulated event's webhook dispatch, returned by the
 * `POST /api/simulate/*` endpoints (Req 7.6, 7.7).
 */
export interface PushOutcome {
  success: boolean;
  target: string | null;
  statusCode?: number;
  timedOut?: boolean;
  attempts: number;
  failureCategory?: PushFailureCategory;
}

/** Direction of a recorded interception. */
export type InterceptionDirection = 'inbound' | 'outbound';

/** Outcome recorded for an outbound dispatch (undefined for inbound). */
export type InterceptionOutcome = 'success' | 'failure' | 'no_target';

/**
 * A single interception log entry returned by `GET /api/interception`
 * (newest-first). For inbound records, `path`/`method`/`body` describe the
 * received request; for outbound records `path` is the composed target URL.
 */
export interface InterceptionRecord {
  id: number;
  direction: InterceptionDirection;
  method: string;
  path: string;
  timestamp: string;
  body: string;
  truncated: boolean;
  outcome?: InterceptionOutcome;
  statusCode?: number;
  attempts?: number;
  failureCategory?: PushFailureCategory;
}
