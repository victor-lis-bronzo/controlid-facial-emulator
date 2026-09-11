/**
 * Unit tests for the Admin Management Panel repositories (task 4.7).
 *
 * Exercised over an ephemeral (`:memory:`) DB with real Drizzle/SQLite:
 *   - UserRepository/GroupRepository membership replacement (Req 2.7, 4.6).
 *   - Cascade-on-delete of owned children (`users_groups`, `time_ranges`) and
 *     Access Rule association rows (Req 2.8, 4.8, 5.8, 7.8).
 *   - `referencingAccessRules` returns the ids that block a delete (Req 7.7).
 *   - Time-range 7-bit mask encode/decode round-trip (Req 5.x).
 *   - Access-log filter (user/event/date, AND-combined) and newest-first
 *     ordering (Req 8.1–8.5, 9.2).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type DrizzleDb } from '../db/connection.js';
import { UserRepository } from './user-repository.js';
import { GroupRepository } from './group-repository.js';
import { PortalRepository } from './portal-repository.js';
import { TimeZoneRepository } from './time-zone-repository.js';
import { AccessRuleRepository } from './access-rule-repository.js';
import { AccessLogRepository } from './access-log-repository.js';
import { InMemoryPhotoStorage } from './photo-storage-memory.js';

describe('Admin repositories', () => {
  let db: DrizzleDb;
  let users: UserRepository;
  let groups: GroupRepository;
  let portals: PortalRepository;
  let timeZones: TimeZoneRepository;
  let accessRules: AccessRuleRepository;
  let accessLogs: AccessLogRepository;

  beforeEach(() => {
    db = createDb({ mode: 'ephemeral' });
    users = new UserRepository(db, new InMemoryPhotoStorage());
    groups = new GroupRepository(db);
    portals = new PortalRepository(db);
    timeZones = new TimeZoneRepository(db);
    accessRules = new AccessRuleRepository(db);
    accessLogs = new AccessLogRepository(db);
  });

  afterEach(() => {
    db.$client.close();
  });

  describe('UserRepository membership + delete (Req 2.7, 2.8)', () => {
    it('replaces membership on update and reflects it in the view', async () => {
      const g1 = await groups.create('G1');
      const g2 = await groups.create('G2');
      const g3 = await groups.create('G3');
      const user = await users.create({
        registration: 'R1',
        name: 'User One',
        groupIds: [g1.id, g2.id],
      });
      expect(new Set(user.groupIds)).toEqual(new Set([g1.id, g2.id]));

      const updated = await users.update(user.id, {
        registration: 'R1',
        name: 'User One',
        groupIds: [g2.id, g3.id],
      });
      expect(new Set(updated.groupIds)).toEqual(new Set([g2.id, g3.id]));
    });

    it('stores the PIN in the password column and clears it when omitted', async () => {
      const user = await users.create({ registration: 'R1', name: 'N', pin: '1234', groupIds: [] });
      const list = await users.list();
      expect(list.find((u) => u.id === user.id)?.password).toBe('1234');

      await users.update(user.id, { registration: 'R1', name: 'N', groupIds: [] });
      const after = await users.list();
      expect(after.find((u) => u.id === user.id)?.password).toBeUndefined();
    });

    it('deleting a user removes its membership rows (Req 2.8)', async () => {
      const g1 = await groups.create('G1');
      const user = await users.create({ registration: 'R', name: 'N', groupIds: [g1.id] });
      expect((await groups.get(g1.id))?.members).toHaveLength(1);

      await users.delete(user.id);
      expect(await users.getAdmin(user.id)).toBeNull();
      expect((await groups.get(g1.id))?.members).toHaveLength(0);
    });

    it('existingIds returns only ids that exist (Req 4.7)', async () => {
      const u1 = await users.create({ registration: 'R1', name: 'N1', groupIds: [] });
      const u2 = await users.create({ registration: 'R2', name: 'N2', groupIds: [] });
      const found = await users.existingIds([u1.id, u2.id, 99999]);
      expect(found).toEqual(new Set([u1.id, u2.id]));
      expect(await users.existingIds([])).toEqual(new Set());
    });
  });

  describe('GroupRepository membership + delete (Req 4.3, 4.6, 4.8)', () => {
    it('reports member count and replaces membership', async () => {
      const u1 = await users.create({ registration: 'R1', name: 'N1', groupIds: [] });
      const u2 = await users.create({ registration: 'R2', name: 'N2', groupIds: [] });
      const group = await groups.create('G');
      await groups.update(group.id, 'G', [u1.id, u2.id]);
      expect((await groups.list()).find((g) => g.id === group.id)?.memberCount).toBe(2);

      await groups.update(group.id, 'G-renamed', [u1.id]);
      const detail = await groups.get(group.id);
      expect(detail?.name).toBe('G-renamed');
      expect(detail?.members.map((m) => m.id)).toEqual([u1.id]);
    });

    it('deleting a group leaves member users intact (Req 4.8)', async () => {
      const u1 = await users.create({ registration: 'R1', name: 'N1', groupIds: [] });
      const group = await groups.create('G');
      await groups.update(group.id, 'G', [u1.id]);
      await groups.delete(group.id);
      expect(await groups.get(group.id)).toBeNull();
      expect(await users.getAdmin(u1.id)).not.toBeNull();
    });
  });

  describe('referencingAccessRules (Req 7.7)', () => {
    it('returns the ids of rules referencing a group/timezone/portal', async () => {
      const group = await groups.create('G');
      const tz = await timeZones.create('TZ', []);
      const portal = await portals.create('P');
      const rule = await accessRules.create({
        name: 'AR',
        groupIds: [group.id],
        timeZoneIds: [tz.id],
        portalIds: [portal.id],
      });
      expect(await groups.referencingAccessRules(group.id)).toEqual([rule.id]);
      expect(await timeZones.referencingAccessRules(tz.id)).toEqual([rule.id]);
      expect(await portals.referencingAccessRules(portal.id)).toEqual([rule.id]);

      // An unreferenced entity has no referencing rules.
      const other = await portals.create('P2');
      expect(await portals.referencingAccessRules(other.id)).toEqual([]);
    });

    it('deleting an access rule leaves referenced entities intact and drops associations (Req 7.8)', async () => {
      const group = await groups.create('G');
      const tz = await timeZones.create('TZ', []);
      const portal = await portals.create('P');
      const rule = await accessRules.create({
        name: 'AR',
        groupIds: [group.id],
        timeZoneIds: [tz.id],
        portalIds: [portal.id],
      });
      await accessRules.delete(rule.id);
      expect(await accessRules.get(rule.id)).toBeNull();
      expect(await groups.get(group.id)).not.toBeNull();
      expect(await timeZones.get(tz.id)).not.toBeNull();
      expect(await portals.get(portal.id)).not.toBeNull();
      expect(await groups.referencingAccessRules(group.id)).toEqual([]);
    });
  });

  describe('TimeZoneRepository mask encode/decode (Req 5.x)', () => {
    it('persists days as a mask and decodes them back on read', async () => {
      const tz = await timeZones.create('Weekdays', [
        { days: ['mon', 'wed', 'fri'], startTime: '08:00', endTime: '17:00' },
      ]);
      const read = await timeZones.get(tz.id);
      expect(read?.timeRanges).toHaveLength(1);
      expect(read?.timeRanges[0]?.days).toEqual(['mon', 'wed', 'fri']);
      expect(read?.timeRanges[0]?.startTime).toBe('08:00');
      expect(read?.timeRanges[0]?.endTime).toBe('17:00');
    });

    it('replaces ranges on update and cascades them on delete (Req 5.7, 5.8)', async () => {
      const tz = await timeZones.create('TZ', [
        { days: ['sun'], startTime: '00:00', endTime: '01:00' },
      ]);
      await timeZones.update(tz.id, 'TZ', [
        { days: ['sat'], startTime: '10:00', endTime: '11:00' },
      ]);
      const read = await timeZones.get(tz.id);
      expect(read?.timeRanges).toHaveLength(1);
      expect(read?.timeRanges[0]?.days).toEqual(['sat']);

      await timeZones.delete(tz.id);
      expect(await timeZones.get(tz.id)).toBeNull();
    });
  });

  describe('AccessLogRepository filter + order (Req 8.1–8.5, 9.2)', () => {
    beforeEach(async () => {
      // Insert logs at increasing times so ordering is unambiguous.
      await users.appendAccessLog({ time: '100', event: '7', device_id: '1', user_id: '5' });
      await users.appendAccessLog({ time: '200', event: '6', device_id: '1', user_id: '0' });
      await users.appendAccessLog({ time: '300', event: '7', device_id: '1', user_id: '8' });
      await users.appendAccessLog({ time: '400', event: '7', device_id: '1', user_id: '5' });
    });

    it('orders results newest-first (Req 8.1)', async () => {
      const rows = await accessLogs.query({});
      expect(rows.map((r) => r.time)).toEqual(['400', '300', '200', '100']);
    });

    it('filters by user id (Req 8.2)', async () => {
      const rows = await accessLogs.query({ userId: '5' });
      expect(rows.map((r) => r.time)).toEqual(['400', '100']);
    });

    it('filters by event (Req 8.3)', async () => {
      const rows = await accessLogs.query({ event: '6' });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.time).toBe('200');
    });

    it('filters by inclusive date range (Req 8.4)', async () => {
      const rows = await accessLogs.query({ from: 200, to: 300 });
      expect(rows.map((r) => r.time)).toEqual(['300', '200']);
    });

    it('AND-combines multiple filters (Req 8.5) and yields [] on no match (Req 8.7)', async () => {
      const rows = await accessLogs.query({ userId: '5', event: '7', from: 300 });
      expect(rows.map((r) => r.time)).toEqual(['400']);
      expect(await accessLogs.query({ userId: 'nobody' })).toEqual([]);
    });

    it('recent(limit) returns the newest N (Req 9.2)', async () => {
      const rows = await accessLogs.recent(2);
      expect(rows.map((r) => r.time)).toEqual(['400', '300']);
      expect(await accessLogs.recent(0)).toEqual([]);
    });
  });
});
