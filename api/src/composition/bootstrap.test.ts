/**
 * Unit tests for the Bootstrap / StateMode selector.
 *
 * Covers (Req 9.3, 9.5, 9.6, 10.4; design "Error Handling" table):
 *   - resolveMode: persistent/ephemeral honored; unset → ephemeral + warning;
 *     unknown value → ephemeral + warning (9.6).
 *   - Persistent mode with a missing/unwritable volume → bootstrap/openStore
 *     rejects with a clear error and returns no store (9.5, 10.4).
 *   - Documented defaults initialized when the store is empty (9.3).
 *   - Invalid EMULATOR_PORT → bootstrap throws a specific error naming the port
 *     (10.4).
 *   - Ephemeral is the applied default when EMULATOR_STATE_MODE is unset.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bootstrap,
  BootstrapError,
  ensureVolumeWritable,
  openStore,
  resolveMode,
  resolveConfig,
  type ResolvedConfig,
} from './bootstrap.js';
import { ConfigService } from '../services/config-service.js';
import { CONFIG_DEFAULTS } from '../shared/index.js';

/** Track temp dirs created during a test so they can be cleaned up. */
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'controlid-boot-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveMode (Req 9.6)', () => {
  it('honors an explicit persistent mode without warning', () => {
    const result = resolveMode({ EMULATOR_STATE_MODE: 'persistent' });
    expect(result.mode).toBe('persistent');
    expect(result.warning).toBeUndefined();
  });

  it('honors an explicit ephemeral mode without warning', () => {
    const result = resolveMode({ EMULATOR_STATE_MODE: 'ephemeral' });
    expect(result.mode).toBe('ephemeral');
    expect(result.warning).toBeUndefined();
  });

  it('is case-insensitive and trims surrounding whitespace', () => {
    expect(resolveMode({ EMULATOR_STATE_MODE: '  PERSISTENT ' }).mode).toBe(
      'persistent',
    );
    expect(resolveMode({ EMULATOR_STATE_MODE: 'Ephemeral' }).mode).toBe(
      'ephemeral',
    );
  });

  it('defaults to ephemeral with a warning when unset', () => {
    const result = resolveMode({});
    expect(result.mode).toBe('ephemeral');
    expect(result.warning).toBeDefined();
    expect(result.warning).toMatch(/ephemeral/i);
  });

  it('defaults to ephemeral with a warning on an unknown value', () => {
    const result = resolveMode({ EMULATOR_STATE_MODE: 'weird-mode' });
    expect(result.mode).toBe('ephemeral');
    expect(result.warning).toBeDefined();
    expect(result.warning).toMatch(/weird-mode/);
    expect(result.warning).toMatch(/ephemeral/i);
  });
});

describe('ephemeral default is applied end-to-end (Req 9.6)', () => {
  it('applies ephemeral when EMULATOR_STATE_MODE is unset and collects a warning', async () => {
    const warnings: string[] = [];
    const { resolved, db } = await bootstrap(
      {},
      { onWarning: (m) => warnings.push(m) },
    );
    try {
      expect(resolved.mode).toBe('ephemeral');
      expect(resolved.warnings.length).toBeGreaterThan(0);
      expect(warnings.length).toBeGreaterThan(0);
    } finally {
      db.$client.close();
    }
  });
});

describe('ensureVolumeWritable / persistent volume handling (Req 9.5, 10.4)', () => {
  it('rejects when the parent volume directory does not exist', async () => {
    await expect(
      ensureVolumeWritable('/nonexistent-vol-xyz/emulator.sqlite'),
    ).rejects.toBeInstanceOf(BootstrapError);
  });

  it('resolves when the parent directory exists and is writable', async () => {
    const dir = makeTempDir();
    await expect(
      ensureVolumeWritable(join(dir, 'emulator.sqlite')),
    ).resolves.toBeUndefined();
  });

  it('openStore rejects and returns no store for a missing persistent volume', async () => {
    const resolved: ResolvedConfig = {
      mode: 'persistent',
      dbPath: '/nonexistent-vol-xyz/emulator.sqlite',
      port: 8080,
      deviceId: 123456,
      login: 'admin',
      password: 'admin',
      warnings: [],
    };
    let store: unknown;
    await expect(
      (async () => {
        store = await openStore(resolved);
      })(),
    ).rejects.toBeInstanceOf(BootstrapError);
    expect(store).toBeUndefined();
  });

  it('bootstrap rejects with a clear error for a missing persistent volume and does not proceed', async () => {
    let result: unknown;
    await expect(
      (async () => {
        result = await bootstrap({
          EMULATOR_STATE_MODE: 'persistent',
          EMULATOR_DB_PATH: '/nonexistent-vol-xyz/emulator.sqlite',
        });
      })(),
    ).rejects.toThrow(/volume|writable/i);
    expect(result).toBeUndefined();
  });

  it('bootstrap succeeds in persistent mode when the volume is writable', async () => {
    const dir = makeTempDir();
    const dbPath = join(dir, 'emulator.sqlite');
    const { resolved, db } = await bootstrap({
      EMULATOR_STATE_MODE: 'persistent',
      EMULATOR_DB_PATH: dbPath,
    });
    try {
      expect(resolved.mode).toBe('persistent');
      expect(resolved.dbPath).toBe(dbPath);
    } finally {
      db.$client.close();
    }
  });
});

describe('initDefaultsIfEmpty via bootstrap (Req 9.3)', () => {
  it('seeds the documented monitor defaults on a fresh ephemeral store', async () => {
    const { db } = await bootstrap({});
    try {
      const config = new ConfigService(db);
      const monitor = await config.get('monitor');
      expect(monitor).toEqual(CONFIG_DEFAULTS.monitor);
    } finally {
      db.$client.close();
    }
  });

  it('preserves previously written values on a persistent restart', async () => {
    const dir = makeTempDir();
    const dbPath = join(dir, 'emulator.sqlite');

    // First boot: write a non-default monitor target.
    const first = await bootstrap({
      EMULATOR_STATE_MODE: 'persistent',
      EMULATOR_DB_PATH: dbPath,
    });
    await new ConfigService(first.db).set({
      monitor: { hostname: '10.0.0.5', port: '9000', path: 'hooks' },
    });
    first.db.$client.close();

    // Second boot: bootstrap must not clobber the previously stored values.
    const second = await bootstrap({
      EMULATOR_STATE_MODE: 'persistent',
      EMULATOR_DB_PATH: dbPath,
    });
    try {
      const monitor = await new ConfigService(second.db).get('monitor');
      expect(monitor.hostname).toBe('10.0.0.5');
      expect(monitor.port).toBe('9000');
      expect(monitor.path).toBe('hooks');
    } finally {
      second.db.$client.close();
    }
  });
});

describe('EMULATOR_PORT validation (Req 10.4)', () => {
  it('throws a specific error mentioning the port for an out-of-range value', async () => {
    await expect(
      bootstrap({ EMULATOR_PORT: '70000' }),
    ).rejects.toThrow(/EMULATOR_PORT/);
  });

  it('throws a specific error mentioning the port for a non-numeric value', async () => {
    await expect(bootstrap({ EMULATOR_PORT: 'abc' })).rejects.toThrow(
      /EMULATOR_PORT/,
    );
  });

  it('accepts a valid port and defaults to 8080 when unset', () => {
    expect(resolveConfig({ EMULATOR_PORT: '3000' }).port).toBe(3000);
    expect(resolveConfig({}).port).toBe(8080);
  });

  it('rejects port 0 and rejects the whole bootstrap without a store', async () => {
    let result: unknown;
    await expect(
      (async () => {
        result = await bootstrap({ EMULATOR_PORT: '0' });
      })(),
    ).rejects.toThrow(/EMULATOR_PORT/);
    expect(result).toBeUndefined();
  });
});

describe('resolveConfig additional env validation (Req 10.4)', () => {
  it('generates a synthetic device id when EMULATOR_DEVICE_ID is unset', () => {
    const resolved = resolveConfig({});
    expect(Number.isInteger(resolved.deviceId)).toBe(true);
    expect(resolved.deviceId).toBeGreaterThan(0);
  });

  it('honors a valid integer EMULATOR_DEVICE_ID and rejects a non-integer one', () => {
    expect(resolveConfig({ EMULATOR_DEVICE_ID: '478435' }).deviceId).toBe(478435);
    expect(() => resolveConfig({ EMULATOR_DEVICE_ID: '12.5' })).toThrow(
      /EMULATOR_DEVICE_ID/,
    );
  });

  it('defaults credentials to admin and rejects over-length values', () => {
    const resolved = resolveConfig({});
    expect(resolved.login).toBe('admin');
    expect(resolved.password).toBe('admin');
    expect(() =>
      resolveConfig({ EMULATOR_LOGIN: 'x'.repeat(65) }),
    ).toThrow(/EMULATOR_LOGIN/);
    expect(() =>
      resolveConfig({ EMULATOR_PASSWORD: 'y'.repeat(65) }),
    ).toThrow(/EMULATOR_PASSWORD/);
  });
});
