/**
 * Unit tests for {@link DiskPhotoStorage} (task 3.2, Req 3.1, 3.5, 3.6, 14.1).
 *
 * Covers:
 *   - save → read round-trip preserves bytes + mime for JPEG and PNG.
 *   - re-upload with a different mime overwrites and leaves EXACTLY one file.
 *   - delete is idempotent (safe to call when no photo exists).
 *   - read returns null when no photo is stored.
 *
 * Each test uses a fresh temp directory under `os.tmpdir()` so runs are isolated
 * and leave no artifacts behind.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiskPhotoStorage, createPhotoStorage } from './photo-storage.js';

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), 'photo-storage-test-'));
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

/** List the files inside the storage `photos/` subfolder (empty when absent). */
async function listPhotos(): Promise<string[]> {
  try {
    return await readdir(join(rootDir, 'photos'));
  } catch {
    return [];
  }
}

describe('DiskPhotoStorage', () => {
  it('round-trips JPEG bytes and mime through save → read (Req 3.1, 3.5)', async () => {
    const storage = new DiskPhotoStorage(rootDir);
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22]);

    const stored = await storage.save(7, bytes, 'image/jpeg');
    expect(stored.mime).toBe('image/jpeg');
    expect(stored.relativePath).toBe(join('photos', '7.jpg'));

    const read = await storage.read(7);
    expect(read).not.toBeNull();
    expect(read?.mime).toBe('image/jpeg');
    expect(read?.bytes.equals(bytes)).toBe(true);
  });

  it('round-trips PNG bytes and mime through save → read (Req 3.1, 3.5)', async () => {
    const storage = createPhotoStorage(rootDir);
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const stored = await storage.save(42, bytes, 'image/png');
    expect(stored.mime).toBe('image/png');
    expect(stored.relativePath).toBe(join('photos', '42.png'));

    const read = await storage.read(42);
    expect(read).not.toBeNull();
    expect(read?.mime).toBe('image/png');
    expect(read?.bytes.equals(bytes)).toBe(true);
  });

  it('re-upload with a different mime overwrites and leaves exactly one file (Req 3.1)', async () => {
    const storage = new DiskPhotoStorage(rootDir);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x01]);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x02]);

    await storage.save(5, jpeg, 'image/jpeg');
    expect(await listPhotos()).toEqual(['5.jpg']);

    // Switch format for the same user: prior .jpg must be removed.
    await storage.save(5, png, 'image/png');
    expect(await listPhotos()).toEqual(['5.png']);

    const read = await storage.read(5);
    expect(read?.mime).toBe('image/png');
    expect(read?.bytes.equals(png)).toBe(true);
  });

  it('re-upload with the same mime overwrites the bytes (Req 3.1)', async () => {
    const storage = new DiskPhotoStorage(rootDir);
    await storage.save(9, Buffer.from([0x01, 0x02]), 'image/jpeg');
    await storage.save(9, Buffer.from([0x03, 0x04, 0x05]), 'image/jpeg');

    expect(await listPhotos()).toEqual(['9.jpg']);
    const read = await storage.read(9);
    expect(read?.bytes.equals(Buffer.from([0x03, 0x04, 0x05]))).toBe(true);
  });

  it('delete removes the stored file and is idempotent (Req 3.6)', async () => {
    const storage = new DiskPhotoStorage(rootDir);
    await storage.save(3, Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg');
    expect(await listPhotos()).toEqual(['3.jpg']);

    await storage.delete(3);
    expect(await listPhotos()).toEqual([]);
    expect(await storage.read(3)).toBeNull();

    // Idempotent: deleting again (and deleting a never-stored user) does not throw.
    await expect(storage.delete(3)).resolves.toBeUndefined();
    await expect(storage.delete(999)).resolves.toBeUndefined();
  });

  it('read returns null when no photo is stored (Req 3.5)', async () => {
    const storage = new DiskPhotoStorage(rootDir);
    expect(await storage.read(1)).toBeNull();

    // Even after another user has a photo, an absent user reads null.
    await storage.save(2, Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg');
    expect(await storage.read(1)).toBeNull();
  });
});
