/**
 * Bootstrap / StateMode selector for the Control-iD Facial Emulator.
 *
 * Resolves startup configuration from the environment, selects the state mode
 * (ephemeral vs persistent), verifies the persistent volume, opens the store,
 * and seeds the documented configuration defaults — all BEFORE the server would
 * bind a port (Req 9.4). This module is deliberately free of any HTTP/Fastify
 * concern (that lives in the composition root / `main.ts`, task 14.1) and does
 * not itself bind a port.
 *
 * Behavior grounded in the design's "Bootstrap / StateMode selector",
 * "Configuration and Deployment → Environment variables", the Error Handling
 * table, and Requirements 9.3–9.6 and 10.4:
 *
 *   - `EMULATOR_STATE_MODE` (persistent|ephemeral; default ephemeral with a
 *     warning when unset/unknown — Req 9.6).
 *   - `EMULATOR_DB_PATH` (default `/data/emulator.sqlite`).
 *   - `EMULATOR_PORT` (default 8080; 1–65535; invalid → fatal startup error,
 *     Req 10.4).
 *   - `EMULATOR_DEVICE_ID` (default: a generated synthetic integer id; validated
 *     as an integer when set).
 *   - `EMULATOR_LOGIN` / `EMULATOR_PASSWORD` (default `admin`; ≤ 64 chars).
 *
 * A persistent volume that is missing or unwritable aborts startup with a clear
 * error so the caller can exit non-zero without listening (Req 9.5, 10.4).
 *
 * See design.md → "Bootstrap / StateMode selector" and "Error Handling".
 */
import { access, constants, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createDb, type DrizzleDb } from '../db/connection.js';
import { ConfigService } from '../services/config-service.js';

/** The two supported storage modes. */
export type StateMode = 'ephemeral' | 'persistent';

/**
 * The environment shape read at startup. Structurally identical to
 * `NodeJS.ProcessEnv` (a string-keyed map of optional string values), declared
 * locally so the module does not depend on the ambient `NodeJS` namespace and
 * accepts `process.env` directly.
 */
export type EmulatorEnv = Record<string, string | undefined>;

/** Documented default SQLite file path for persistent mode. */
export const DEFAULT_DB_PATH = '/data/emulator.sqlite';
/** Documented default listen port. */
export const DEFAULT_PORT = 8080;
/** Documented default admin credentials (mirror the device defaults). */
export const DEFAULT_LOGIN = 'admin';
export const DEFAULT_PASSWORD = 'admin';
/** Maximum length for the admin login/password (Req 2.1 field bound). */
export const MAX_CREDENTIAL_LENGTH = 64;
/** Valid TCP port range. */
const MIN_PORT = 1;
const MAX_PORT = 65535;

/**
 * A fully-resolved, validated startup configuration. `warnings` collects any
 * non-fatal advisories (e.g. defaulting to ephemeral, Req 9.6) so the caller can
 * surface them however it likes.
 */
export interface ResolvedConfig {
  mode: StateMode;
  dbPath: string;
  port: number;
  deviceId: number;
  login: string;
  password: string;
  warnings: string[];
}

/**
 * Thrown when startup configuration is invalid and the process must abort with a
 * non-zero exit code without listening (Req 10.4, 9.5). The message names the
 * specific offending item.
 */
export class BootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapError';
    // Restore prototype chain for reliable `instanceof` across transpilation.
    Object.setPrototypeOf(this, BootstrapError.prototype);
  }
}

/**
 * Resolve the state mode from the environment (Req 9.6).
 *
 * - `persistent` / `ephemeral` (case-insensitive) are honored.
 * - Unset or unknown values default to `ephemeral` and produce a warning
 *   describing that the default was applied.
 */
export function resolveMode(env: EmulatorEnv): {
  mode: StateMode;
  warning?: string;
} {
  const raw = env.EMULATOR_STATE_MODE;

  if (raw === undefined || raw.trim() === '') {
    return {
      mode: 'ephemeral',
      warning:
        'EMULATOR_STATE_MODE is not set; defaulting to ephemeral state mode.',
    };
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'persistent' || normalized === 'ephemeral') {
    return { mode: normalized };
  }

  return {
    mode: 'ephemeral',
    warning: `EMULATOR_STATE_MODE has an unrecognized value "${raw}"; defaulting to ephemeral state mode.`,
  };
}

/**
 * Generate a synthetic device id when `EMULATOR_DEVICE_ID` is unset. The device
 * emits this id in webhook payloads; any positive integer is acceptable for
 * fidelity, so a random 6–7 digit value is used.
 */
function generateDeviceId(): number {
  // Range keeps it within a device-like 6–7 digit id and safely integral.
  return 100000 + Math.floor(Math.random() * 900000);
}

/**
 * Parse and validate the full startup configuration from the environment.
 *
 * Fatal problems (invalid port, non-integer device id, over-length credentials)
 * throw {@link BootstrapError} so the caller can exit non-zero (Req 10.4).
 * Non-fatal advisories (mode defaulting) are collected in `warnings`.
 */
export function resolveConfig(env: EmulatorEnv): ResolvedConfig {
  const warnings: string[] = [];

  const { mode, warning } = resolveMode(env);
  if (warning !== undefined) {
    warnings.push(warning);
  }

  const dbPathRaw = env.EMULATOR_DB_PATH;
  const dbPath =
    dbPathRaw !== undefined && dbPathRaw.trim() !== ''
      ? dbPathRaw.trim()
      : DEFAULT_DB_PATH;

  const port = parsePort(env.EMULATOR_PORT);
  const deviceId = parseDeviceId(env.EMULATOR_DEVICE_ID);
  const login = parseCredential('EMULATOR_LOGIN', env.EMULATOR_LOGIN, DEFAULT_LOGIN);
  const password = parseCredential(
    'EMULATOR_PASSWORD',
    env.EMULATOR_PASSWORD,
    DEFAULT_PASSWORD,
  );

  return { mode, dbPath, port, deviceId, login, password, warnings };
}

/** Parse/validate `EMULATOR_PORT`; default 8080; must be an integer in 1–65535. */
function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_PORT;
  }
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new BootstrapError(
      `Invalid EMULATOR_PORT "${raw}": port must be an integer between ${String(MIN_PORT)} and ${String(MAX_PORT)}.`,
    );
  }
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new BootstrapError(
      `Invalid EMULATOR_PORT "${raw}": port must be an integer between ${String(MIN_PORT)} and ${String(MAX_PORT)}.`,
    );
  }
  return port;
}

/** Parse/validate `EMULATOR_DEVICE_ID`; default synthetic; must be an integer when set. */
function parseDeviceId(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return generateDeviceId();
  }
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new BootstrapError(
      `Invalid EMULATOR_DEVICE_ID "${raw}": device id must be a positive integer.`,
    );
  }
  const deviceId = Number(trimmed);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    throw new BootstrapError(
      `Invalid EMULATOR_DEVICE_ID "${raw}": device id must be a positive integer.`,
    );
  }
  return deviceId;
}

/** Parse/validate an admin credential; default when unset; must be ≤ 64 chars. */
function parseCredential(
  name: string,
  raw: string | undefined,
  fallback: string,
): string {
  if (raw === undefined) {
    return fallback;
  }
  if (raw.length > MAX_CREDENTIAL_LENGTH) {
    throw new BootstrapError(
      `Invalid ${name}: must be at most ${String(MAX_CREDENTIAL_LENGTH)} characters.`,
    );
  }
  return raw;
}

/**
 * Verify that the persistent SQLite file at `path` can be created and written
 * (Req 9.5). The parent directory (typically a mounted volume) must already
 * exist and be writable; a missing volume dir is a fatal condition and is NOT
 * created for the caller. When the parent exists and is writable, the file
 * itself is opened for append to confirm write access (creating it if absent,
 * which is reasonable).
 *
 * @throws BootstrapError when the parent directory is missing or unwritable, or
 *   when the file cannot be opened for writing.
 */
export async function ensureVolumeWritable(path: string): Promise<void> {
  const parent = dirname(path);

  // The parent directory (mounted volume) must already exist and be writable.
  try {
    await access(parent, constants.W_OK);
  } catch {
    throw new BootstrapError(
      `Persistent mode requires a writable storage volume, but the directory "${parent}" is missing or not writable. Mount a writable volume for the database path "${path}".`,
    );
  }

  // Confirm the DB file itself can be opened for writing (create if absent).
  try {
    const handle = await open(path, 'a');
    await handle.close();
  } catch {
    throw new BootstrapError(
      `Persistent mode cannot open the database file "${path}" for writing. Verify the mounted volume is writable.`,
    );
  }
}

/**
 * Open the storage backend for the resolved configuration, applying the selected
 * mode (Req 9.4). Ephemeral opens an in-memory DB; persistent verifies the
 * volume first (Req 9.5) then opens the file. `createTables` is invoked by
 * `createDb`.
 *
 * @throws BootstrapError (via {@link ensureVolumeWritable}) when a persistent
 *   volume is missing/unwritable.
 */
export async function openStore(resolved: ResolvedConfig): Promise<DrizzleDb> {
  if (resolved.mode === 'ephemeral') {
    return createDb({ mode: 'ephemeral' });
  }
  await ensureVolumeWritable(resolved.dbPath);
  return createDb({ mode: 'persistent', filePath: resolved.dbPath });
}

/**
 * Seed the documented configuration defaults when the store has never been
 * written (Req 9.3). `ConfigService.get` already merges defaults on read, and
 * `set` is idempotent last-write-wins, so seeding the defaults for every module
 * is safe on both a fresh store and an existing one: this writes the current
 * merged values back, which equals the persisted values when they already exist
 * and equals the documented defaults when they do not.
 */
export async function initDefaultsIfEmpty(config: ConfigService): Promise<void> {
  const defaults = config.getDefaults();
  for (const module of Object.keys(defaults)) {
    // `get` fills documented defaults for unset keys; persisting the merged
    // result seeds defaults on a fresh store while preserving existing values.
    const current = await config.get(module);
    await config.set({ [module]: current });
  }
}

/** The ready-to-serve result of a successful {@link bootstrap}. */
export interface BootstrapResult {
  resolved: ResolvedConfig;
  db: DrizzleDb;
}

/** Optional hooks for {@link bootstrap} (used mainly for testing). */
export interface BootstrapOptions {
  /** Sink for warnings; defaults to `console.warn`. */
  onWarning?: (message: string) => void;
}

/**
 * Top-level orchestration (Req 9.3, 9.4, 9.5, 10.4).
 *
 * Resolves and validates the configuration (collecting warnings), opens the
 * store applying the selected mode BEFORE any port would be bound, and seeds the
 * documented defaults when the store is empty. Fatal validation problems throw a
 * {@link BootstrapError} with a specific message so the caller can exit non-zero
 * without listening. This function neither imports Fastify nor binds a port.
 */
export async function bootstrap(
  env: EmulatorEnv,
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const emitWarning =
    options.onWarning ??
    ((message: string) => {
      console.warn(message);
    });

  // Resolve + validate configuration. Fatal problems throw BootstrapError.
  const resolved = resolveConfig(env);

  for (const warning of resolved.warnings) {
    emitWarning(warning);
  }

  // Apply the selected storage mode (verifying the volume for persistent) BEFORE
  // the server would bind — the store must be ready first (Req 9.4).
  const db = await openStore(resolved);

  // Seed documented defaults when the store is empty (Req 9.3).
  const configService = new ConfigService(db);
  await initDefaultsIfEmpty(configService);

  return { resolved, db };
}
