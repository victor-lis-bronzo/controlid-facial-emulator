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

  describe('load — cards empty and no-match (Req 4.2)', () => {
    it('returns an empty array when the store is empty', async () => {
      const rows = await store.load('cards');
      expect(rows).toEqual([]);
    });

    it('returns an empty array when no record matches the filters', async () => {
      await store.create('cards', [{ value: '123456', user_id: '1' }]);
      const rows = await store.load('cards', { user_id: '999' });
      expect(rows).toEqual([]);
    });
  });

  describe('load — cards filter validation (Req 4.5)', () => {
    it('throws ValidationError naming an unrecognized filter parameter', async () => {
      await store.create('cards', [{ value: '123456', user_id: '1' }]);
      await expect(
        store.load('cards', { not_a_column: 'x' }),
      ).rejects.toThrowError(ValidationError);
      await expect(
        store.load('cards', { not_a_column: 'x' }),
      ).rejects.toThrowError(/not_a_column/);
    });
  });

  describe('cards CRUD happy path', () => {
    it('creates, loads, modifies, and destroys cards', async () => {
      // create
      const created = await store.create('cards', [
        { value: '111111', user_id: '1' },
        { value: '222222', user_id: '2' },
      ]);
      expect(created.ids).toHaveLength(2);
      expect(created.ids[0]).toBeGreaterThan(0);
      expect(created.ids[1]).toBe(created.ids[0] + 1);

      // load all
      const all = await store.load('cards');
      expect(all).toHaveLength(2);
      const first = all.find((r) => r.user_id === '1');
      expect(first).toMatchObject({ value: '111111', user_id: '1' });
      // id is returned as a string (device wire shape)
      expect(typeof first?.id).toBe('string');

      // load filtered (AND semantics)
      const filtered = await store.load('cards', { user_id: '2', value: '222222' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]).toMatchObject({ user_id: '2' });

      // modify
      const modified = await store.modify('cards', { value: '333333' }, { user_id: '2' });
      expect(modified.changes).toBe(1);
      const afterModify = await store.load('cards', { user_id: '2' });
      expect(afterModify[0]).toMatchObject({ value: '333333' });

      // destroy
      const destroyed = await store.destroy('cards', { user_id: '1' });
      expect(destroyed.changes).toBe(1);
      const remaining = await store.load('cards');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toMatchObject({ user_id: '2' });
    });

    it('throws ValidationError when creating with an unknown column', async () => {
      await expect(
        store.create('cards', [{ value: '1', user_id: '1', nope: 'x' }]),
      ).rejects.toThrowError(/nope/);
    });
  });

  describe('load — qrcodes empty and no-match (Req 4.2)', () => {
    it('returns an empty array when the store is empty', async () => {
      const rows = await store.load('qrcodes');
      expect(rows).toEqual([]);
    });

    it('returns an empty array when no record matches the filters', async () => {
      await store.create('qrcodes', [{ value: 'qr-abc', user_id: '1' }]);
      const rows = await store.load('qrcodes', { user_id: '999' });
      expect(rows).toEqual([]);
    });
  });

  describe('load — qrcodes filter validation (Req 4.5)', () => {
    it('throws ValidationError naming an unrecognized filter parameter', async () => {
      await store.create('qrcodes', [{ value: 'qr-abc', user_id: '1' }]);
      await expect(
        store.load('qrcodes', { not_a_column: 'x' }),
      ).rejects.toThrowError(ValidationError);
      await expect(
        store.load('qrcodes', { not_a_column: 'x' }),
      ).rejects.toThrowError(/not_a_column/);
    });
  });

  describe('qrcodes CRUD happy path', () => {
    it('creates, loads, modifies, and destroys qrcodes', async () => {
      // create
      const created = await store.create('qrcodes', [
        { value: 'qr-one', user_id: '1' },
        { value: 'qr-two', user_id: '2' },
      ]);
      expect(created.ids).toHaveLength(2);
      expect(created.ids[0]).toBeGreaterThan(0);
      expect(created.ids[1]).toBe(created.ids[0] + 1);

      // load all
      const all = await store.load('qrcodes');
      expect(all).toHaveLength(2);
      const first = all.find((r) => r.user_id === '1');
      expect(first).toMatchObject({ value: 'qr-one', user_id: '1' });
      // id is returned as a string (device wire shape)
      expect(typeof first?.id).toBe('string');

      // load filtered (AND semantics)
      const filtered = await store.load('qrcodes', { user_id: '2', value: 'qr-two' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]).toMatchObject({ user_id: '2' });

      // modify
      const modified = await store.modify('qrcodes', { value: 'qr-changed' }, { user_id: '2' });
      expect(modified.changes).toBe(1);
      const afterModify = await store.load('qrcodes', { user_id: '2' });
      expect(afterModify[0]).toMatchObject({ value: 'qr-changed' });

      // destroy
      const destroyed = await store.destroy('qrcodes', { user_id: '1' });
      expect(destroyed.changes).toBe(1);
      const remaining = await store.load('qrcodes');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toMatchObject({ user_id: '2' });
    });

    it('throws ValidationError when creating with an unknown column', async () => {
      await expect(
        store.create('qrcodes', [{ value: '1', user_id: '1', nope: 'x' }]),
      ).rejects.toThrowError(/nope/);
    });
  });

  describe('load — uhf_tags empty and no-match (Req 4.2)', () => {
    it('returns an empty array when the store is empty', async () => {
      const rows = await store.load('uhf_tags');
      expect(rows).toEqual([]);
    });

    it('returns an empty array when no record matches the filters', async () => {
      await store.create('uhf_tags', [{ value: 'tag-abc', user_id: '1' }]);
      const rows = await store.load('uhf_tags', { user_id: '999' });
      expect(rows).toEqual([]);
    });
  });

  describe('load — uhf_tags filter validation (Req 4.5)', () => {
    it('throws ValidationError naming an unrecognized filter parameter', async () => {
      await store.create('uhf_tags', [{ value: 'tag-abc', user_id: '1' }]);
      await expect(
        store.load('uhf_tags', { not_a_column: 'x' }),
      ).rejects.toThrowError(ValidationError);
      await expect(
        store.load('uhf_tags', { not_a_column: 'x' }),
      ).rejects.toThrowError(/not_a_column/);
    });
  });

  describe('uhf_tags CRUD happy path', () => {
    it('creates, loads, modifies, and destroys uhf_tags', async () => {
      // create
      const created = await store.create('uhf_tags', [
        { value: 'tag-one', user_id: '1' },
        { value: 'tag-two', user_id: '2' },
      ]);
      expect(created.ids).toHaveLength(2);
      expect(created.ids[0]).toBeGreaterThan(0);
      expect(created.ids[1]).toBe(created.ids[0] + 1);

      // load all
      const all = await store.load('uhf_tags');
      expect(all).toHaveLength(2);
      const first = all.find((r) => r.user_id === '1');
      expect(first).toMatchObject({ value: 'tag-one', user_id: '1' });
      // id is returned as a string (device wire shape)
      expect(typeof first?.id).toBe('string');

      // load filtered (AND semantics)
      const filtered = await store.load('uhf_tags', { user_id: '2', value: 'tag-two' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]).toMatchObject({ user_id: '2' });

      // modify
      const modified = await store.modify('uhf_tags', { value: 'tag-changed' }, { user_id: '2' });
      expect(modified.changes).toBe(1);
      const afterModify = await store.load('uhf_tags', { user_id: '2' });
      expect(afterModify[0]).toMatchObject({ value: 'tag-changed' });

      // destroy
      const destroyed = await store.destroy('uhf_tags', { user_id: '1' });
      expect(destroyed.changes).toBe(1);
      const remaining = await store.load('uhf_tags');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toMatchObject({ user_id: '2' });
    });

    it('throws ValidationError when creating with an unknown column', async () => {
      await expect(
        store.create('uhf_tags', [{ value: '1', user_id: '1', nope: 'x' }]),
      ).rejects.toThrowError(/nope/);
    });
  });

  describe('load — pins empty and no-match (Req 4.2)', () => {
    it('returns an empty array when the store is empty', async () => {
      const rows = await store.load('pins');
      expect(rows).toEqual([]);
    });

    it('returns an empty array when no record matches the filters', async () => {
      await store.create('pins', [{ value: '1234', user_id: '1' }]);
      const rows = await store.load('pins', { user_id: '999' });
      expect(rows).toEqual([]);
    });
  });

  describe('load — pins filter validation (Req 4.5)', () => {
    it('throws ValidationError naming an unrecognized filter parameter', async () => {
      await store.create('pins', [{ value: '1234', user_id: '1' }]);
      await expect(
        store.load('pins', { not_a_column: 'x' }),
      ).rejects.toThrowError(ValidationError);
      await expect(
        store.load('pins', { not_a_column: 'x' }),
      ).rejects.toThrowError(/not_a_column/);
    });
  });

  describe('pins CRUD happy path', () => {
    it('creates, loads, modifies, and destroys pins', async () => {
      // create
      const created = await store.create('pins', [
        { value: '1111', user_id: '1' },
        { value: '2222', user_id: '2' },
      ]);
      expect(created.ids).toHaveLength(2);
      expect(created.ids[0]).toBeGreaterThan(0);
      expect(created.ids[1]).toBe(created.ids[0] + 1);

      // load all
      const all = await store.load('pins');
      expect(all).toHaveLength(2);
      const first = all.find((r) => r.user_id === '1');
      expect(first).toMatchObject({ value: '1111', user_id: '1' });
      // id is returned as a string (device wire shape)
      expect(typeof first?.id).toBe('string');

      // load filtered (AND semantics)
      const filtered = await store.load('pins', { user_id: '2', value: '2222' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]).toMatchObject({ user_id: '2' });

      // modify
      const modified = await store.modify('pins', { value: '3333' }, { user_id: '2' });
      expect(modified.changes).toBe(1);
      const afterModify = await store.load('pins', { user_id: '2' });
      expect(afterModify[0]).toMatchObject({ value: '3333' });

      // destroy
      const destroyed = await store.destroy('pins', { user_id: '1' });
      expect(destroyed.changes).toBe(1);
      const remaining = await store.load('pins');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toMatchObject({ user_id: '2' });
    });

    it('throws ValidationError when creating with an unknown column', async () => {
      await expect(
        store.create('pins', [{ value: '1', user_id: '1', nope: 'x' }]),
      ).rejects.toThrowError(/nope/);
    });
  });

  describe('load — alarm_zones empty and no-match (Req 4.2)', () => {
    it('returns an empty array when the store is empty', async () => {
      const rows = await store.load('alarm_zones');
      expect(rows).toEqual([]);
    });

    it('returns an empty array when no record matches the filters', async () => {
      await store.create('alarm_zones', [
        { zone: '1', enabled: '1', active_level: '1', alarm_delay: '0' },
      ]);
      const rows = await store.load('alarm_zones', { zone: '999' });
      expect(rows).toEqual([]);
    });
  });

  describe('load — alarm_zones filter validation (Req 4.5)', () => {
    it('throws ValidationError naming an unrecognized filter parameter', async () => {
      await store.create('alarm_zones', [
        { zone: '1', enabled: '1', active_level: '1', alarm_delay: '0' },
      ]);
      await expect(
        store.load('alarm_zones', { not_a_column: 'x' }),
      ).rejects.toThrowError(ValidationError);
      await expect(
        store.load('alarm_zones', { not_a_column: 'x' }),
      ).rejects.toThrowError(/not_a_column/);
    });
  });

  describe('alarm_zones CRUD happy path', () => {
    it('creates, loads, modifies, and destroys alarm_zones', async () => {
      // create — `zone` is the device-assigned identifier, not store-generated
      const created = await store.create('alarm_zones', [
        { zone: '1', enabled: '1', active_level: '1', alarm_delay: '0' },
        { zone: '2', enabled: '0', active_level: '0', alarm_delay: '5' },
      ]);
      expect(created.ids).toEqual([1, 2]);

      // load all
      const all = await store.load('alarm_zones');
      expect(all).toHaveLength(2);
      const first = all.find((r) => r.zone === '1');
      expect(first).toMatchObject({ zone: '1', enabled: '1', active_level: '1', alarm_delay: '0' });

      // load filtered (AND semantics)
      const filtered = await store.load('alarm_zones', { zone: '2', enabled: '0' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]).toMatchObject({ zone: '2' });

      // modify
      const modified = await store.modify('alarm_zones', { enabled: '1' }, { zone: '2' });
      expect(modified.changes).toBe(1);
      const afterModify = await store.load('alarm_zones', { zone: '2' });
      expect(afterModify[0]).toMatchObject({ enabled: '1' });

      // destroy
      const destroyed = await store.destroy('alarm_zones', { zone: '1' });
      expect(destroyed.changes).toBe(1);
      const remaining = await store.load('alarm_zones');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toMatchObject({ zone: '2' });
    });

    it('throws ValidationError when creating with an unknown column', async () => {
      await expect(
        store.create('alarm_zones', [
          { zone: '1', enabled: '1', active_level: '1', alarm_delay: '0', nope: 'x' },
        ]),
      ).rejects.toThrowError(/nope/);
    });
  });

  describe('load — user_roles empty and no-match (Req 4.2)', () => {
    it('returns an empty array when the store is empty', async () => {
      const rows = await store.load('user_roles');
      expect(rows).toEqual([]);
    });

    it('returns an empty array when no record matches the filters', async () => {
      await store.create('user_roles', [{ user_id: '1', role: '1' }]);
      const rows = await store.load('user_roles', { user_id: '999' });
      expect(rows).toEqual([]);
    });
  });

  describe('load — user_roles filter validation (Req 4.5)', () => {
    it('throws ValidationError naming an unrecognized filter parameter', async () => {
      await store.create('user_roles', [{ user_id: '1', role: '1' }]);
      await expect(
        store.load('user_roles', { not_a_column: 'x' }),
      ).rejects.toThrowError(ValidationError);
      await expect(
        store.load('user_roles', { not_a_column: 'x' }),
      ).rejects.toThrowError(/not_a_column/);
    });
  });

  describe('user_roles CRUD happy path', () => {
    it('creates, loads, modifies, and destroys user_roles', async () => {
      // create — `user_id` is the device-assigned identifier, not store-generated
      const created = await store.create('user_roles', [
        { user_id: '1', role: '1' },
        { user_id: '2', role: '0' },
      ]);
      expect(created.ids).toEqual([1, 2]);

      // load all
      const all = await store.load('user_roles');
      expect(all).toHaveLength(2);
      const first = all.find((r) => r.user_id === '1');
      expect(first).toMatchObject({ user_id: '1', role: '1' });

      // load filtered (AND semantics)
      const filtered = await store.load('user_roles', { user_id: '2', role: '0' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]).toMatchObject({ user_id: '2' });

      // modify
      const modified = await store.modify('user_roles', { role: '1' }, { user_id: '2' });
      expect(modified.changes).toBe(1);
      const afterModify = await store.load('user_roles', { user_id: '2' });
      expect(afterModify[0]).toMatchObject({ role: '1' });

      // destroy
      const destroyed = await store.destroy('user_roles', { user_id: '1' });
      expect(destroyed.changes).toBe(1);
      const remaining = await store.load('user_roles');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toMatchObject({ user_id: '2' });
    });

    it('throws ValidationError when creating with an unknown column', async () => {
      await expect(
        store.create('user_roles', [{ user_id: '1', role: '1', nope: 'x' }]),
      ).rejects.toThrowError(/nope/);
    });
  });

  describe('load — scheduled_unlocks empty and no-match (Req 4.2)', () => {
    it('returns an empty array when the store is empty', async () => {
      const rows = await store.load('scheduled_unlocks');
      expect(rows).toEqual([]);
    });

    it('returns an empty array when no record matches the filters', async () => {
      await store.create('scheduled_unlocks', [{ name: 'Lunch break' }]);
      const rows = await store.load('scheduled_unlocks', { name: 'nonexistent' });
      expect(rows).toEqual([]);
    });
  });

  describe('load — scheduled_unlocks filter validation (Req 4.5)', () => {
    it('throws ValidationError naming an unrecognized filter parameter', async () => {
      await store.create('scheduled_unlocks', [{ name: 'Lunch break' }]);
      await expect(
        store.load('scheduled_unlocks', { not_a_column: 'x' }),
      ).rejects.toThrowError(ValidationError);
      await expect(
        store.load('scheduled_unlocks', { not_a_column: 'x' }),
      ).rejects.toThrowError(/not_a_column/);
    });
  });

  describe('scheduled_unlocks CRUD happy path', () => {
    it('creates, loads, modifies, and destroys scheduled_unlocks', async () => {
      // create
      const created = await store.create('scheduled_unlocks', [
        { name: 'Lunch break', message: 'Door open for lunch' },
        { name: 'Holiday' },
      ]);
      expect(created.ids).toHaveLength(2);
      expect(created.ids[0]).toBeGreaterThan(0);
      expect(created.ids[1]).toBe(created.ids[0] + 1);

      // load all
      const all = await store.load('scheduled_unlocks');
      expect(all).toHaveLength(2);
      const first = all.find((r) => r.name === 'Lunch break');
      expect(first).toMatchObject({ name: 'Lunch break', message: 'Door open for lunch' });
      expect(typeof first?.id).toBe('string');
      const second = all.find((r) => r.name === 'Holiday');
      expect(second?.message ?? null).toBeNull();

      // load filtered (AND semantics)
      const filtered = await store.load('scheduled_unlocks', { name: 'Holiday' });
      expect(filtered).toHaveLength(1);

      // modify
      const modified = await store.modify(
        'scheduled_unlocks',
        { message: 'Now with a message' },
        { name: 'Holiday' },
      );
      expect(modified.changes).toBe(1);
      const afterModify = await store.load('scheduled_unlocks', { name: 'Holiday' });
      expect(afterModify[0]).toMatchObject({ message: 'Now with a message' });

      // destroy
      const destroyed = await store.destroy('scheduled_unlocks', { name: 'Lunch break' });
      expect(destroyed.changes).toBe(1);
      const remaining = await store.load('scheduled_unlocks');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toMatchObject({ name: 'Holiday' });
    });

    it('throws ValidationError when creating with an unknown column', async () => {
      await expect(
        store.create('scheduled_unlocks', [{ name: 'x', nope: 'x' }]),
      ).rejects.toThrowError(/nope/);
    });
  });

  describe('load — actions empty and no-match (Req 4.2)', () => {
    it('returns an empty array when the store is empty', async () => {
      const rows = await store.load('actions');
      expect(rows).toEqual([]);
    });

    it('returns an empty array when no record matches the filters', async () => {
      await store.create('actions', [
        { group_id: '1', name: 'Open door', action: 'open.sh', parameters: '', run_at: '0' },
      ]);
      const rows = await store.load('actions', { group_id: '999' });
      expect(rows).toEqual([]);
    });
  });

  describe('load — actions filter validation (Req 4.5)', () => {
    it('throws ValidationError naming an unrecognized filter parameter', async () => {
      await store.create('actions', [
        { group_id: '1', name: 'Open door', action: 'open.sh', parameters: '', run_at: '0' },
      ]);
      await expect(
        store.load('actions', { not_a_column: 'x' }),
      ).rejects.toThrowError(ValidationError);
      await expect(
        store.load('actions', { not_a_column: 'x' }),
      ).rejects.toThrowError(/not_a_column/);
    });
  });

  describe('actions CRUD happy path', () => {
    it('creates, loads, modifies, and destroys actions', async () => {
      // create — `group_id` is the device-assigned identifier, not store-generated
      const created = await store.create('actions', [
        { group_id: '1', name: 'Open door', action: 'open.sh', parameters: '', run_at: '0' },
        { group_id: '2', name: 'Close door', action: 'close.sh', parameters: '', run_at: '1' },
      ]);
      expect(created.ids).toEqual([1, 2]);

      // load all
      const all = await store.load('actions');
      expect(all).toHaveLength(2);
      const first = all.find((r) => r.group_id === '1');
      expect(first).toMatchObject({ group_id: '1', name: 'Open door', action: 'open.sh' });

      // load filtered (AND semantics)
      const filtered = await store.load('actions', { group_id: '2', run_at: '1' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]).toMatchObject({ group_id: '2' });

      // modify
      const modified = await store.modify('actions', { run_at: '2' }, { group_id: '2' });
      expect(modified.changes).toBe(1);
      const afterModify = await store.load('actions', { group_id: '2' });
      expect(afterModify[0]).toMatchObject({ run_at: '2' });

      // destroy
      const destroyed = await store.destroy('actions', { group_id: '1' });
      expect(destroyed.changes).toBe(1);
      const remaining = await store.load('actions');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toMatchObject({ group_id: '2' });
    });

    it('throws ValidationError when creating with an unknown column', async () => {
      await expect(
        store.create('actions', [
          { group_id: '1', name: 'x', action: 'x', parameters: '', run_at: '0', nope: 'x' },
        ]),
      ).rejects.toThrowError(/nope/);
    });
  });

  describe('load — areas empty and no-match (Req 4.2)', () => {
    it('returns an empty array when the store is empty', async () => {
      const rows = await store.load('areas');
      expect(rows).toEqual([]);
    });

    it('returns an empty array when no record matches the filters', async () => {
      await store.create('areas', [{ name: 'Warehouse' }]);
      const rows = await store.load('areas', { name: 'nonexistent' });
      expect(rows).toEqual([]);
    });
  });

  describe('load — areas filter validation (Req 4.5)', () => {
    it('throws ValidationError naming an unrecognized filter parameter', async () => {
      await store.create('areas', [{ name: 'Warehouse' }]);
      await expect(
        store.load('areas', { not_a_column: 'x' }),
      ).rejects.toThrowError(ValidationError);
      await expect(
        store.load('areas', { not_a_column: 'x' }),
      ).rejects.toThrowError(/not_a_column/);
    });
  });

  describe('areas CRUD happy path', () => {
    it('creates, loads, modifies, and destroys areas', async () => {
      // create
      const created = await store.create('areas', [{ name: 'Warehouse' }, { name: 'Office' }]);
      expect(created.ids).toHaveLength(2);
      expect(created.ids[0]).toBeGreaterThan(0);
      expect(created.ids[1]).toBe(created.ids[0] + 1);

      // load all
      const all = await store.load('areas');
      expect(all).toHaveLength(2);
      const first = all.find((r) => r.name === 'Warehouse');
      expect(typeof first?.id).toBe('string');

      // load filtered (AND semantics)
      const filtered = await store.load('areas', { name: 'Office' });
      expect(filtered).toHaveLength(1);

      // modify
      const modified = await store.modify('areas', { name: 'HQ' }, { name: 'Office' });
      expect(modified.changes).toBe(1);
      const afterModify = await store.load('areas', { name: 'HQ' });
      expect(afterModify).toHaveLength(1);

      // destroy
      const destroyed = await store.destroy('areas', { name: 'Warehouse' });
      expect(destroyed.changes).toBe(1);
      const remaining = await store.load('areas');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toMatchObject({ name: 'HQ' });
    });

    it('throws ValidationError when creating with an unknown column', async () => {
      await expect(
        store.create('areas', [{ name: 'x', nope: 'x' }]),
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
