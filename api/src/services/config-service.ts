/**
 * ConfigService — configuration persistence for the Control-iD Facial Emulator.
 *
 * Stores configuration per module as a JSON blob in the `config` table (module
 * primary key, serialized `Record<string, unknown>`, ISO 8601 UTC `updatedAt`).
 * Reads merge the persisted store over the documented defaults so every
 * recognized key always resolves to a value (Req 3.4). Writes are all-or-nothing:
 * the entire patch is validated before anything is persisted, and a
 * {@link ValidationError} naming the rejected key is thrown when any module, key,
 * or value is invalid — leaving the store unchanged (Req 3.2). Successful writes
 * merge each module patch over the currently-stored values with last-write-wins
 * replace semantics (Req 3.6).
 *
 * This is a pure service over the DB — no Fastify/HTTP concerns live here.
 *
 * See design.md → "Components and Interfaces → ConfigService",
 * "Data Models → config", and Correctness Properties 1, 6, 8.
 */
import { eq } from 'drizzle-orm';
import type { DrizzleDb } from '../db/connection.js';
import { config } from '../db/schema.js';
import {
  CONFIG_DEFAULTS,
  DEFAULT_MONITOR_CONFIG,
  type ConfigPatch,
  type MonitorConfig,
} from '../shared/index.js';

/**
 * Thrown when a configuration write is rejected. Carries the offending
 * `module`/`key` so callers (and the `.fcgi` layer) can report exactly which
 * value failed validation (Req 3.2).
 */
export class ValidationError extends Error {
  /** The module the rejected key belongs to (e.g. `'monitor'`). */
  readonly module: string;
  /** The rejected configuration key, or `undefined` when the module itself is unknown. */
  readonly key?: string;

  constructor(message: string, module: string, key?: string) {
    super(message);
    this.name = 'ValidationError';
    this.module = module;
    this.key = key;
    // Restore prototype chain for reliable `instanceof` across transpilation.
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/** Push_Target composed/hostname string length upper bound (Req 3.5). */
const MAX_STRING_LENGTH = 2048;

/** The recognized keys of the `monitor` module (exactly the MonitorConfig keys). */
const MONITOR_KEYS: readonly (keyof MonitorConfig)[] = [
  'request_timeout',
  'hostname',
  'port',
  'path',
  'alive_interval',
  'enable_photo_upload',
];

/** A validator returns `null` when the value is acceptable, or an error message. */
type KeyValidator = (value: unknown) => string | null;

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** `alive_interval` must be a positive integer. */
function validateAliveInterval(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return 'must be a positive integer';
  }
  return null;
}

/** `enable_photo_upload` must be exactly 0 or 1. */
function validateEnablePhotoUpload(value: unknown): string | null {
  if (value !== 0 && value !== 1) {
    return 'must be 0 or 1';
  }
  return null;
}

/** `port` must be a string; when non-empty, a numeric string in 1–65535. */
function validatePort(value: unknown): string | null {
  if (!isString(value)) {
    return 'must be a string';
  }
  if (value === '') {
    return null; // empty encodes "no target configured"
  }
  if (!/^\d+$/.test(value)) {
    return 'must be a numeric string';
  }
  const port = Number(value);
  if (port < 1 || port > 65535) {
    return 'must be a port number between 1 and 65535';
  }
  return null;
}

/** `hostname` must be a string; when non-empty, within 1–2048 chars (Req 3.5). */
function validateHostname(value: unknown): string | null {
  if (!isString(value)) {
    return 'must be a string';
  }
  if (value.length > MAX_STRING_LENGTH) {
    return `must be at most ${String(MAX_STRING_LENGTH)} characters`;
  }
  return null;
}

/** `path`/`request_timeout` must simply be strings (bounded by the length rule). */
function validateBoundedString(value: unknown): string | null {
  if (!isString(value)) {
    return 'must be a string';
  }
  if (value.length > MAX_STRING_LENGTH) {
    return `must be at most ${String(MAX_STRING_LENGTH)} characters`;
  }
  return null;
}

/** Per-module validators for every recognized key. */
const MONITOR_VALIDATORS: Record<keyof MonitorConfig, KeyValidator> = {
  request_timeout: validateBoundedString,
  hostname: validateHostname,
  port: validatePort,
  path: validateBoundedString,
  alive_interval: validateAliveInterval,
  enable_photo_upload: validateEnablePhotoUpload,
};

/** Registry of recognized modules and their validators. */
const MODULE_VALIDATORS: Record<string, Record<string, KeyValidator>> = {
  monitor: MONITOR_VALIDATORS as Record<string, KeyValidator>,
};

/**
 * Reads and writes emulator configuration, filling documented defaults for
 * unset keys and validating every write all-or-nothing.
 */
export class ConfigService {
  constructor(private readonly db: DrizzleDb) {}

  /**
   * Return the stored values for `module` merged over the documented defaults.
   * Unset recognized keys fall back to the module's default (Req 3.4); persisted
   * values take precedence. When `keys` is supplied, only those keys are
   * returned.
   *
   * @throws ValidationError when `module` is not a recognized module.
   */
  async get(module: string, keys?: string[]): Promise<Record<string, unknown>> {
    if (!Object.hasOwn(MODULE_DEFAULTS, module)) {
      throw new ValidationError(
        `Unrecognized configuration module: ${module}`,
        module,
      );
    }
    const defaults = MODULE_DEFAULTS[module] as Record<string, unknown>;

    const stored = await this.readModule(module);
    const merged: Record<string, unknown> = { ...defaults, ...stored };

    if (keys === undefined) {
      return merged;
    }

    const selected: Record<string, unknown> = {};
    for (const key of keys) {
      if (Object.hasOwn(merged, key)) {
        selected[key] = merged[key];
      }
    }
    return selected;
  }

  /**
   * Validate and persist a configuration patch, all-or-nothing (Req 3.2).
   *
   * Every module, key, and value is validated first. If any module or key is
   * unrecognized, or any value fails type/range validation, a
   * {@link ValidationError} identifying the rejected key is thrown and NOTHING
   * is written. On success, each module patch is merged over the currently
   * stored module values (last-write-wins, Req 3.6) and persisted with a fresh
   * `updatedAt`.
   */
  async set(patch: ConfigPatch): Promise<void> {
    // --- Phase 1: validate everything before touching the store. ---
    for (const [module, modulePatch] of Object.entries(patch)) {
      if (!Object.hasOwn(MODULE_VALIDATORS, module)) {
        throw new ValidationError(
          `Unrecognized configuration module: ${module}`,
          module,
        );
      }
      const validators = MODULE_VALIDATORS[module] as Record<
        string,
        KeyValidator
      >;
      for (const [key, value] of Object.entries(modulePatch)) {
        if (!Object.hasOwn(validators, key)) {
          throw new ValidationError(
            `Unrecognized configuration key: ${module}.${key}`,
            module,
            key,
          );
        }
        const validate = validators[key] as KeyValidator;
        const failure = validate(value);
        if (failure !== null) {
          throw new ValidationError(
            `Invalid value for ${module}.${key}: ${failure}`,
            module,
            key,
          );
        }
      }
    }

    // --- Phase 2: merge each module patch over stored values and persist. ---
    const now = new Date().toISOString();
    for (const [module, modulePatch] of Object.entries(patch)) {
      const stored = await this.readModule(module);
      const nextValues: Record<string, unknown> = { ...stored, ...modulePatch };
      const json = JSON.stringify(nextValues);
      this.db
        .insert(config)
        .values({ module, json, updatedAt: now })
        .onConflictDoUpdate({
          target: config.module,
          set: { json, updatedAt: now },
        })
        .run();
    }
  }

  /**
   * Return a deep clone of the documented defaults for every recognized module.
   */
  getDefaults(): Record<string, Record<string, unknown>> {
    return JSON.parse(JSON.stringify(CONFIG_DEFAULTS)) as Record<
      string,
      Record<string, unknown>
    >;
  }

  /**
   * Resolve the Push_Target base URL from the `monitor` block (Req 5.1, 5.5).
   *
   * When `hostname`, `port`, and `path` are all present and non-empty, composes
   * `http://<hostname>:<port>/<path>` — stripping any leading slash from `path`
   * and any trailing slash from the result. Returns `null` when any of the three
   * is empty ("no target configured").
   */
  async resolvePushTarget(): Promise<string | null> {
    const monitor = await this.get('monitor');
    const hostname = monitor.hostname;
    const port = monitor.port;
    const path = monitor.path;

    if (
      !isString(hostname) ||
      !isString(port) ||
      !isString(path) ||
      hostname === '' ||
      port === '' ||
      path === ''
    ) {
      return null;
    }

    const cleanPath = path.replace(/^\/+/, '').replace(/\/+$/, '');
    const url = `http://${hostname}:${port}/${cleanPath}`;
    return url.replace(/\/+$/, '');
  }

  /** Read and parse the stored JSON blob for a module (empty object when unset). */
  private async readModule(module: string): Promise<Record<string, unknown>> {
    const rows = await this.db
      .select()
      .from(config)
      .where(eq(config.module, module))
      .all();
    const row = rows[0];
    if (!row) {
      return {};
    }
    const parsed: unknown = JSON.parse(row.json);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  }
}

/** Documented default values keyed by module name, for merge-on-read. */
const MODULE_DEFAULTS: Record<string, Record<string, unknown>> = {
  monitor: DEFAULT_MONITOR_CONFIG as unknown as Record<string, unknown>,
};

/** Re-export the recognized monitor keys for test generators. */
export { MONITOR_KEYS };
