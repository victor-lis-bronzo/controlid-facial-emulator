/**
 * Push Engine outcome types and webhook envelope types.
 *
 * The webhook envelopes are grounded in the design's "Push / Webhook Payload
 * Catalog" (which reproduces the Official API Documentation shapes). All access
 * log field values are strings to match the device's `dao` wire shape.
 *
 * Types/interfaces only — no business logic.
 */

import type { AccessLogRecord } from './domain-types.js';

/**
 * The category of a failed dispatch, recorded on the interception record
 * (Req 8.4). `no_target` means no Push Target was configured, so no POST was
 * attempted (Req 5.5).
 */
export type PushFailureCategory = 'no_target' | 'timeout' | 'unreachable' | 'http_error';

/**
 * The result of a webhook dispatch attempt sequence.
 *
 * `success` is true only for a `2xx` response (Req 5.2). `attempts` is the
 * total number of HTTP attempts made (`1 + retries`, up to 4; Req 5.7).
 * `failureCategory` and `statusCode`/`timedOut` are populated on failure
 * (Req 5.8).
 */
export interface PushOutcome {
  /** True iff the target returned a status in the 200–299 range. */
  success: boolean;
  /** The composed target URL, or `null` when no target was configured. */
  target: string | null;
  /** Final HTTP status code, when a response was received. */
  statusCode?: number;
  /** True when the final attempt timed out. */
  timedOut?: boolean;
  /** Total number of HTTP attempts made (1 + retries). */
  attempts: number;
  /** Failure category, present only when `success` is false. */
  failureCategory?: PushFailureCategory;
}

/**
 * A single object change inside a `dao` (data-access-object) notification.
 *
 * Example (authorized access, event `7`):
 * `{ "object": "access_logs", "type": "inserted",
 *    "values": { "id": "519", "event": "7", ... } }`.
 */
export interface DaoObjectChange {
  /** The object type that changed, e.g. `"access_logs"`. */
  object: string;
  /** The kind of change, e.g. `"inserted"`, `"updated"`, `"deleted"`. */
  type: string;
  /** The changed record's values (an access-log record for `access_logs`). */
  values: AccessLogRecord;
}

/**
 * The `dao` webhook envelope POSTed to `.../dao` for authorized (event `7`)
 * and denied (event `6`) access events (Req 6.1, 6.2).
 *
 * Note the device sends `device_id` as a number at the envelope level, even
 * though the nested `values.device_id` is a string.
 */
export interface DaoNotification {
  /** One or more object changes; typically a single inserted access log. */
  object_changes: DaoObjectChange[];
  /** Synthetic device id (numeric at the envelope level). */
  device_id: number;
}

/**
 * The keep-alive webhook envelope POSTed to `.../device_is_alive` (Req 6.3).
 *
 * Example: `{ "access_logs": 0, "device_id": 6613047045004349,
 *             "time": 1739376235 }`.
 */
export interface DeviceIsAliveNotification {
  /** Count of pending access logs (0 for a plain keep-alive). */
  access_logs: number;
  /** Synthetic device id (numeric). */
  device_id: number;
  /** Event time as Unix epoch seconds (numeric). */
  time: number;
}

/**
 * The `operation_mode` webhook envelope POSTed to `.../operation_mode`.
 * Included for catalog completeness / future events.
 */
export interface OperationModeNotification {
  operation_mode: {
    mode: number;
    mode_name: string;
    time: number;
    last_offline: number;
    exception_mode: string;
  };
  device_id: number;
}

/**
 * The `door` webhook envelope POSTed to `.../door`.
 * Included for catalog completeness / future events.
 */
export interface DoorNotification {
  door: {
    id: number;
    open: boolean;
  };
  access_event_id: number;
  device_id: number;
  time: number;
}

/**
 * Union of all supported outbound webhook payloads dispatched by the Push
 * Engine.
 */
export type WebhookNotification =
  | DaoNotification
  | DeviceIsAliveNotification
  | OperationModeNotification
  | DoorNotification;
