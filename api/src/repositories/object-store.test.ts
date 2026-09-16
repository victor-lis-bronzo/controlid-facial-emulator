/**
 * Unit tests for {@link ObjectStore} and {@link UserRepository} edge cases.
 *
 * Covers (Req 4.2, 4.3, 4.5):
 *   - Empty store / no-match filter → empty collection (4.2).
 *   - Unrecognized/invalid filter parameter → ValidationError naming it (4.5).
 *   - Biometry returns structured synthetic data (4.3).
 *   - create + load + modify + destroy happy path for `users`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb, type DrizzleDb } from '../db/connection.js';
import { ObjectStore } from './object-store.js';
import { UserRepository } from './user-repository.js';
import { InMemoryPhotoStorage } from './photo-storage-memory.js';
import { ValidationError } from './errors.js';

describe('ObjectStore', () => {
  let db: DrizzleDb;
  let store: ObjectStore;

  beforeEach(() => {
    db = createDb({ mode: 'ephemeral' });
    store = new ObjectStore(db);
  });

  afterEach(() => {
    db.$client.close();
  });

  describe('load — empty and no-match (Req 4.2)', () => {
    it('returns an empty array when the store is empty', async () => {
      const rows = await store.load('access_logs');
      expect(rows).toEqual([]);
    });

    it('returns an empty array when no record matches the filters', async () => {
      await store.create('access_logs', [
        { time: '1000', event: '7', device_id: '1', user_id: '8' },
      ]);
      const rows = await store.load('access_logs', { user_id: '999' });
      expect(rows).toEqual([]);
    });
  });

  describe('load — filter validation (Req 4.5)', () => {
    it('throws ValidationError naming an unrecognized filter parameter', async () => {
      await store.create('access_logs', [
        { time: '1000', event: '7', device_id: '1' },
      ]);
      await expect(
        store.load('access_logs', { not_a_column: 'x' }),
      ).rejects.toThrowError(ValidationError);
      await expect(
        store.load('access_logs', { not_a_column: 'x' }),
      ).rejects.toThrowError(/not_a_column/);
    });

    it('exposes the rejected parameter name on the error', async () => {
      let caught: unknown;
      try {
        await store.load('users', { bogus_field: 1 });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ValidationError);
      expect((caught as ValidationError).parameter).toBe('bogus_field');
    });

    it('throws ValidationError for an unknown object type', async () => {
      await expect(store.load('widgets')).rejects.toThrowError(ValidationError);
      await expect(store.load('widgets')).rejects.toThrowError(/widgets/);
    });
  });

  describe('users CRUD happy path', () => {
    it('creates, loads, modifies, and destroys users', async () => {
      // create
      const created = await store.create('users', [
        { registration: '0123', name: 'Walter White', password: 'Heisenberg' },
        { registration: '0456', name: 'Jesse Pinkman' },
      ]);
      expect(created.ids).toHaveLength(2);
      expect(created.ids[0]).toBeGreaterThan(0);
      expect(created.ids[1]).toBe(created.ids[0] + 1);

      // load all
      const all = await store.load('users');
      expect(all).toHaveLength(2);
      const walter = all.find((u) => u.name === 'Walter White');
      expect(walter).toMatchObject({
        registration: '0123',
        name: 'Walter White',
        password: 'Heisenberg',
      });
      // id is returned as a string (device wire shape)
      expect(typeof walter?.id).toBe('string');

      // load filtered (AND semantics)
      const filtered = await store.load('users', {
        registration: '0123',
        name: 'Walter White',
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]).toMatchObject({ name: 'Walter White' });

      // modify
      const modified = await store.modify(
        'users',
        { name: 'Heisenberg' },
        { registration: '0123' },
      );
      expect(modified.changes).toBe(1);
      const afterModify = await store.load('users', { registration: '0123' });
      expect(afterModify[0]).toMatchObject({ name: 'Heisenberg' });

      // destroy
      const destroyed = await store.destroy('users', { registration: '0456' });
      expect(destroyed.changes).toBe(1);
      const remaining = await store.load('users');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toMatchObject({ name: 'Heisenberg' });
    });

    it('throws ValidationError when creating with an unknown column', async () => {
      await expect(
        store.create('users', [{ registration: '1', name: 'A', nope: 'x' }]),
      ).rejects.toThrowError(/nope/);
    });
  });

  describe('load — change_logs empty and no-match (Req 4.2)', () => {
    it('returns an empty array when the store is empty', async () => {
      const rows = await store.load('change_logs');
      expect(rows).toEqual([]);
    });

    it('returns an empty array when no record matches the filters', async () => {
      await store.create('change_logs', [
        { operation_type: 'insert', table_name: 'users', table_id: '1', timestamp: '1000' },
      ]);
      const rows = await store.load('change_logs', { table_name: 'nonexistent' });
      expect(rows).toEqual([]);
    });
  });

  describe('load — change_logs filter validation (Req 4.5)', () => {
    it('throws ValidationError naming an unrecognized filter parameter', async () => {
      await store.create('change_logs', [
        { operation_type: 'insert', table_name: 'users', table_id: '1', timestamp: '1000' },
      ]);
      await expect(
        store.load('change_logs', { not_a_column: 'x' }),
      ).rejects.toThrowError(ValidationError);
      await expect(
        store.load('change_logs', { not_a_column: 'x' }),
      ).rejects.toThrowError(/not_a_column/);
    });
  });

  describe('change_logs CRUD happy path', () => {
    it('creates, loads, modifies, and destroys change_logs', async () => {
      // create
      const created = await store.create('change_logs', [
        { operation_type: 'insert', table_name: 'users', table_id: '1', timestamp: '1000' },
        { operation_type: 'update', table_name: 'cards', table_id: '2', timestamp: '2000' },
      ]);
      expect(created.ids).toHaveLength(2);
      expect(created.ids[0]).toBeGreaterThan(0);
      expect(created.ids[1]).toBe(created.ids[0] + 1);

      // load all
      const all = await store.load('change_logs');
      expect(all).toHaveLength(2);
      const insert = all.find((r) => r.operation_type === 'insert');
      expect(insert).toMatchObject({
        operation_type: 'insert',
        table_name: 'users',
        table_id: '1',
        timestamp: '1000',
      });
      // id is returned as a string (device wire shape)
      expect(typeof insert?.id).toBe('string');

      // load filtered (AND semantics)
      const filtered = await store.load('change_logs', {
        table_name: 'users',
        operation_type: 'insert',
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]).toMatchObject({ table_name: 'users' });

      // modify
      const modified = await store.modify(
        'change_logs',
        { operation_type: 'delete' },
        { table_name: 'users' },
      );
      expect(modified.changes).toBe(1);
      const afterModify = await store.load('change_logs', { table_name: 'users' });
      expect(afterModify[0]).toMatchObject({ operation_type: 'delete' });

      // destroy
      const destroyed = await store.destroy('change_logs', { table_name: 'cards' });
      expect(destroyed.changes).toBe(1);
      const remaining = await store.load('change_logs');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toMatchObject({ table_name: 'users' });
    });

    it('throws ValidationError when creating with an unknown column', async () => {
      await expect(
        store.create('change_logs', [
          { operation_type: 'insert', table_name: 'users', table_id: '1', timestamp: '1000', nope: 'x' },
        ]),
      ).rejects.toThrowError(/nope/);
    });
  });

  describe('load — templates empty and no-match (Req 4.2)', () => {
    it('returns an empty array when the store is empty', async () => {
      const rows = await store.load('templates');
      expect(rows).toEqual([]);
    });

    it('returns an empty array when no record matches the filters', async () => {
      await store.create('templates', [
        { finger_type: '0', template: 'YmFzZTY0', user_id: '1' },
      ]);
      const rows = await store.load('templates', { user_id: '999' });
      expect(rows).toEqual([]);
    });
  });

  describe('load — templates filter validation (Req 4.5)', () => {
    it('throws ValidationError naming an unrecognized filter parameter', async () => {
      await store.create('templates', [
        { finger_type: '0', template: 'YmFzZTY0', user_id: '1' },
      ]);
      await expect(
        store.load('templates', { not_a_column: 'x' }),
      ).rejects.toThrowError(ValidationError);
      await expect(
        store.load('templates', { not_a_column: 'x' }),
      ).rejects.toThrowError(/not_a_column/);
    });
  });

  describe('templates CRUD happy path', () => {
    it('creates, loads, modifies, and destroys templates', async () => {
      // create
      const created = await store.create('templates', [
        { finger_type: '0', template: 'YmFzZTY0LW9uZQ==', user_id: '1' },
        { finger_type: '1', finger_position: '2', template: 'YmFzZTY0LXR3bw==', user_id: '2' },
      ]);
      expect(created.ids).toHaveLength(2);
      expect(created.ids[0]).toBeGreaterThan(0);
      expect(created.ids[1]).toBe(created.ids[0] + 1);

      // load all
      const all = await store.load('templates');
      expect(all).toHaveLength(2);
      const first = all.find((r) => r.user_id === '1');
      expect(first).toMatchObject({
        finger_type: '0',
        template: 'YmFzZTY0LW9uZQ==',
        user_id: '1',
      });
      expect(first?.finger_position ?? null).toBeNull();
      // id is returned as a string (device wire shape)
      expect(typeof first?.id).toBe('string');

      // load filtered (AND semantics)
      const filtered = await store.load('templates', {
        user_id: '2',
        finger_type: '1',
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]).toMatchObject({ user_id: '2' });

      // modify
      const modified = await store.modify(
        'templates',
        { finger_type: '0' },
        { user_id: '2' },
      );
      expect(modified.changes).toBe(1);
      const afterModify = await store.load('templates', { user_id: '2' });
      expect(afterModify[0]).toMatchObject({ finger_type: '0' });

      // destroy
      const destroyed = await store.destroy('templates', { user_id: '1' });
      expect(destroyed.changes).toBe(1);
      const remaining = await store.load('templates');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toMatchObject({ user_id: '2' });
    });

    it('throws ValidationError when creating with an unknown column', async () => {
      await expect(
        store.create('templates', [{ finger_type: '0', user_id: '1', nope: 'x' }]),
      ).rejects.toThrowError(/nope/);
    });
  });
});

describe('UserRepository', () => {
  let db: DrizzleDb;
  let repo: UserRepository;

  beforeEach(() => {
    db = createDb({ mode: 'ephemeral' });
    repo = new UserRepository(db, new InMemoryPhotoStorage());
  });

  afterEach(() => {
    db.$client.close();
  });

  it('lists users feeding the identity picker (Req 7.3)', async () => {
    const store = new ObjectStore(db);
    await store.create('users', [
      { registration: '0123', name: 'Walter White' },
      { registration: '0456', name: 'Jesse Pinkman' },
    ]);
    const list = await repo.list();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ registration: '0123', name: 'Walter White' });
    expect(typeof list[0]?.id).toBe('number');
  });

  it('returns null image when the user has no image or does not exist', async () => {
    const store = new ObjectStore(db);
    await store.create('users', [{ registration: '0123', name: 'Walter White' }]);
    const list = await repo.list();
    const id = list[0]!.id;
    await expect(repo.getImage(id)).resolves.toBeNull();
    await expect(repo.getImage(999999)).resolves.toBeNull();
  });

  it('returns structured synthetic biometry data (Req 4.3)', async () => {
    const biometry = await repo.getBiometry(42);
    expect(biometry).toMatchObject({
      user_id: '42',
      type: 'face',
      synthetic: true,
    });
    expect(typeof biometry.template).toBe('string');
    expect(biometry.template.length).toBeGreaterThan(0);
    // Deterministic for the same user id.
    const again = await repo.getBiometry(42);
    expect(again.template).toBe(biometry.template);
  });

  it('appends an access log filling device-shape defaults and returns it (Req 4.1)', async () => {
    const record = await repo.appendAccessLog({
      event: '7',
      device_id: '478435',
      user_id: '8',
    });
    expect(record).toMatchObject({
      event: '7',
      device_id: '478435',
      user_id: '8',
      identifier_id: '0',
      portal_id: '1',
      identification_rule_id: '0',
      card_value: '0',
      log_type_id: '-1',
    });
    expect(typeof record.id).toBe('string');
    expect(record.time).toMatch(/^\d+$/);

    // The appended row is queryable via load (reflects the event, Req 4.1).
    const store = new ObjectStore(db);
    const loaded = await store.load('access_logs', { user_id: '8' });
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ event: '7', user_id: '8' });
  });
});
