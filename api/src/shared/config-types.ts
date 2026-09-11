/**
 * Configuration payload types for the Control-iD `monitor` module.
 *
 * Grounded in the Official API Documentation
 * (https://www.controlid.com.br/docs/access-api-pt/) as reproduced in the
 * design's "Components and Interfaces → ConfigService" and
 * "API / Endpoint Specification" sections.
 *
 * This module contains ONLY types/interfaces and documented default constants.
 * No business logic, no service/DB imports.
 */

/**
 * The `monitor` configuration block that drives the Push/webhook mechanism.
 *
 * Field names and value types mirror the device's `set_configuration.fcgi`
 * request shape exactly, e.g.:
 * `{ "monitor": { "hostname": "192.168.0.20", "port": "8000",
 *    "path": "api/notifications", "alive_interval": 30000,
 *    "enable_photo_upload": 1, "request_timeout": "5000" } }`.
 *
 * Note the device's mixed conventions: `hostname`, `port`, `path`, and
 * `request_timeout` are strings, whereas `alive_interval` is a number and
 * `enable_photo_upload` is the numeric flag `0 | 1`.
 */
export interface MonitorConfig {
  /** Per-request timeout in milliseconds, as a numeric string (e.g. "5000"). */
  request_timeout: string;
  /** Push target host (IP or DNS name), e.g. "192.168.0.20". */
  hostname: string;
  /** Push target TCP port, as a numeric string (e.g. "8000"). */
  port: string;
  /** Push target base path (no leading slash), e.g. "api/notifications". */
  path: string;
  /** Keep-alive interval in milliseconds. */
  alive_interval: number;
  /** Whether the device uploads the identification photo (`1`) or not (`0`). */
  enable_photo_upload: 0 | 1;
}

/**
 * A partial patch over a single configuration module (e.g. `monitor`).
 *
 * Every key is optional so a client may submit any recognized subset; unknown
 * keys are rejected by the ConfigService (all-or-nothing, Req 3.2).
 */
export type ConfigModulePatch<T = MonitorConfig> = Partial<T>;

/**
 * A configuration change as accepted by `set_configuration.fcgi`: a map from
 * module name to a partial patch of that module's keys.
 *
 * Example: `{ "monitor": { "hostname": "10.0.0.1", "port": "9000" } }`.
 */
export type ConfigPatch = Record<string, ConfigModulePatch<Record<string, unknown>>>;

/**
 * The shape returned by `ConfigService.getDefaults()`: the documented default
 * value for every recognized module, keyed by module name.
 */
export interface ConfigDefaults {
  monitor: MonitorConfig;
}

/**
 * Documented default for the `monitor` module.
 *
 * These defaults are returned for any recognized key that has never been
 * written (Req 3.4) and re-seeded on a fresh/ephemeral store (Req 9.3). The
 * empty `hostname`/`port`/`path` encode "no Push Target configured", which
 * causes the Push Engine to record `no_target` and skip dispatch (Req 5.5).
 */
export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  request_timeout: '5000',
  hostname: '',
  port: '',
  path: '',
  alive_interval: 30000,
  enable_photo_upload: 0,
} as const;

/**
 * The full documented default configuration, keyed by module name. Mirrors the
 * env/config defaults described in the design's Configuration and Deployment
 * section.
 */
export const CONFIG_DEFAULTS: ConfigDefaults = {
  monitor: DEFAULT_MONITOR_CONFIG,
} as const;
