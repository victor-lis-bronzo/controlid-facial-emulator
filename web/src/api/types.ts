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

// ---------------------------------------------------------------------------
// Admin Management Panel types (Req 1–9). These mirror the backend Admin API
// shapes under `/api/admin/*` (see design.md → "Admin API Endpoint
// Specification"). The panel consumes them read-only; write DTOs are the
// request bodies documented for POST/PUT.
// ---------------------------------------------------------------------------

/** A User as returned by the Admin API list/get endpoints (Req 2.4). */
export interface AdminUserView {
  id: number;
  registration: string;
  name: string;
  /** Whether a Facial_Photo is stored for the user (Req 2.4, 3.4). */
  hasPhoto: boolean;
  /** Ids of the Groups the user belongs to (Req 2.4). */
  groupIds: number[];
}

/** Create/update body for a User (Req 2.1, 2.7). PIN maps to `password`. */
export interface UserWriteDto {
  registration: string;
  name: string;
  pin?: string;
  groupIds: number[];
}

/** A Group summary row with member count (Req 4.3). */
export interface GroupView {
  id: number;
  name: string;
  memberCount: number;
}

/** A Group with its resolved member Users (Req 4.4). */
export interface GroupDetail {
  id: number;
  name: string;
  members: AdminUserView[];
}

/** Create/update body for a Group (Req 4.1, 4.6). */
export interface GroupWriteDto {
  name: string;
  memberIds: number[];
}

/** A Portal / door (Req 6.3). */
export interface PortalView {
  id: number;
  name: string;
}

/** Create/update body for a Portal (Req 6.1, 6.5). */
export interface PortalWriteDto {
  name: string;
}

/** A single weekly interval within a Time Zone (Req 5.4). */
export interface TimeRangeView {
  id: number;
  /** Weekday names this range applies to, e.g. `['mon','tue']` (Req 5.4). */
  days: string[];
  /** Start time as `HH:MM`, 24-hour (Req 5.2). */
  startTime: string;
  /** End time as `HH:MM`, strictly after `startTime` (Req 5.3). */
  endTime: string;
}

/** A named weekly schedule with its ranges (Req 5.5). */
export interface TimeZoneView {
  id: number;
  name: string;
  timeRanges: TimeRangeView[];
}

/** A submitted time range (no id) — the create/update shape (Req 5.1). */
export interface TimeRangeWriteDto {
  days: string[];
  startTime: string;
  endTime: string;
}

/** Create/update body for a Time Zone (Req 5.1, 5.7). */
export interface TimeZoneWriteDto {
  name: string;
  timeRanges: TimeRangeWriteDto[];
}

/** An Access Rule composing Groups / Time Zones / Portals (Req 7.4). */
export interface AccessRuleView {
  id: number;
  name: string;
  groupIds: number[];
  timeZoneIds: number[];
  portalIds: number[];
}

/** Create/update body for an Access Rule (Req 7.1, 7.6). */
export interface AccessRuleWriteDto {
  name: string;
  groupIds: number[];
  timeZoneIds: number[];
  portalIds: number[];
}

/**
 * An access-log record in the device wire shape (all strings), returned by the
 * Admin Access Logs and Dashboard endpoints (Req 8, 9.2). Mirrors the server's
 * `AccessLogRecord` envelope.
 */
export interface AccessLogRecord {
  id: string;
  time: string;
  event: string;
  device_id: string;
  identifier_id: string;
  user_id: string;
  portal_id: string;
  identification_rule_id: string;
  card_value: string;
  log_type_id: string;
}

/** Optional AND-combined filters for the Access Logs query (Req 8.2–8.5). */
export interface AccessLogFilter {
  /** Filter by `user_id` (Req 8.2). */
  userId?: string;
  /** Filter by event code (Req 8.3). */
  event?: string;
  /** Inclusive lower bound — ISO date or epoch seconds (Req 8.4). */
  from?: string;
  /** Inclusive upper bound — ISO date or epoch seconds (Req 8.4). */
  to?: string;
}

/** Aggregate entity counts shown on the Dashboard (Req 9.1, 9.3). */
export interface DashboardCounts {
  users: number;
  groups: number;
  accessRules: number;
  portals: number;
}

/** The Dashboard payload: counts + 10 most-recent logs (Req 9.1, 9.2). */
export interface DashboardData {
  counts: DashboardCounts;
  recentLogs: AccessLogRecord[];
}
