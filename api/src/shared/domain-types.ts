/**
 * Core domain record types for the Control-iD object model.
 *
 * Field names and (string) types mirror the device shapes reproduced in the
 * design's "Data Models" and "Push / Webhook Payload Catalog" sections. Access
 * log fields are intentionally all strings to match the device's `dao`
 * webhook envelope.
 *
 * Types/interfaces and const mappings only — no business logic.
 */

/**
 * A user/identity record. Feeds the Control Panel identity picker (Req 7.3)
 * and the `users` object model exposed via `create_objects`/`load_objects`.
 */
export interface UserRecord {
  /** Auto-incremented numeric id assigned by the object store. */
  id: number;
  /** External registration/enrollment number (device: `registration`). */
  registration: string;
  /** Display name. */
  name: string;
  /** Optional password (mirrors device `users` shape; not required). */
  password?: string;
  /** Optional path to a stored face image. */
  image_path?: string;
}

/**
 * An access-log record as emitted in the `dao` webhook envelope and returned
 * by `load_objects` for the `access_logs` object.
 *
 * All fields are strings to faithfully match the device wire shape, e.g.:
 * `{ "id": "519", "time": "1532977090", "event": "7", "device_id": "478435",
 *    "identifier_id": "0", "user_id": "8", "portal_id": "1",
 *    "identification_rule_id": "0", "card_value": "0", "log_type_id": "-1" }`.
 */
export interface AccessLogRecord {
  /** Record id (string, device shape). */
  id: string;
  /** Event time as Unix epoch seconds (string, device shape). */
  time: string;
  /** Event code — see {@link AccessEvent} / {@link ACCESS_EVENT}. */
  event: string;
  /** Synthetic device id. */
  device_id: string;
  /** Identifier id (biometry simplified; defaults to "0"). */
  identifier_id: string;
  /** Associated user id ("0" when none, e.g. denied/unidentified). */
  user_id: string;
  /** Portal id (defaults to "1"). */
  portal_id: string;
  /** Identification rule id (defaults to "0"). */
  identification_rule_id: string;
  /** Card value (defaults to "0"). */
  card_value: string;
  /** Log type id (defaults to "-1"). */
  log_type_id: string;
}

/**
 * An opaque session token issued on successful login, persisted with its
 * issuance and expiry instants. TTL is 3600 seconds (Req 2.4).
 */
export interface SessionToken {
  /** URL-safe random token string passed as `?session=<token>`. */
  token: string;
  /** Issuance instant, epoch milliseconds. */
  issuedAt: number;
  /** Expiry instant (`issuedAt + 3600_000`), epoch milliseconds. */
  expiresAt: number;
}

/**
 * Symbolic names for the Control-iD access event codes carried in
 * `access_logs.event`. Values match the device's numeric codes.
 *
 * - `7`  → access granted
 * - `6`  → access denied
 * - `3`  → not identified
 * - `11` → REX / botoeira (request-to-exit button)
 */
export const ACCESS_EVENT = {
  granted: 7,
  denied: 6,
  not_identified: 3,
  rex: 11,
} as const;

/** The numeric access-event code values (e.g. `7 | 6 | 3 | 11`). */
export type AccessEvent = (typeof ACCESS_EVENT)[keyof typeof ACCESS_EVENT];

/** The symbolic access-event names (e.g. `'granted' | 'denied' | ...`). */
export type AccessEventName = keyof typeof ACCESS_EVENT;
