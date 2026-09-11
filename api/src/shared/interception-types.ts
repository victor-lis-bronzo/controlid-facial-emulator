/**
 * Interception log record types.
 *
 * Grounded in the design's "Components and Interfaces → InterceptionLogger" and
 * "Data Models → interception_log" sections. Records both inbound `.fcgi`
 * requests and outbound webhook dispatches (Req 8.1–8.5).
 *
 * Types/interfaces only — no business logic.
 */

import type { PushFailureCategory } from './push-types.js';

/** The direction of a recorded interception. */
export type InterceptionDirection = 'inbound' | 'outbound';

/** The recorded outcome of an outbound dispatch (undefined for inbound). */
export type InterceptionOutcome = 'success' | 'failure' | 'no_target';

/**
 * A single interception log entry.
 *
 * For inbound records, `path`/`method`/`body` describe the received request.
 * For outbound records, `path` is the composed target URL and the
 * `outcome`/`statusCode`/`attempts`/`failureCategory` fields describe the
 * dispatch result (Req 8.3, 8.4).
 */
export interface InterceptionRecord {
  /** Auto-incremented, insertion-monotonic id (used for newest-first order). */
  id: number;
  /** Whether this record is an inbound request or outbound dispatch. */
  direction: InterceptionDirection;
  /** HTTP method (e.g. `"POST"`); for outbound, the dispatch method. */
  method: string;
  /** Inbound request path or outbound target URL. */
  path: string;
  /** ISO 8601 UTC timestamp with millisecond precision. */
  timestamp: string;
  /** Request/response body (possibly truncated — see `truncated`). */
  body: string;
  /** True when the body was truncated to the first 64 KB (Req 8.2). */
  truncated: boolean;
  /** Dispatch outcome (outbound only). */
  outcome?: InterceptionOutcome;
  /** Final HTTP status code, when available. */
  statusCode?: number;
  /** Total attempts made (outbound only). */
  attempts?: number;
  /** Failure category, when the dispatch failed (outbound only). */
  failureCategory?: PushFailureCategory;
}
