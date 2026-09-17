/**
 * ObjectStore — CRUD over the Control-iD object model (`users`, `access_logs`)
 * via Drizzle/SQLite.
 *
 * The store exposes the four device object operations mirrored by the
 * `.fcgi` object endpoints:
 *
 *   - `create(object, values[])`     → `create_objects.fcgi`  → `{ ids: [...] }`
 *   - `load(object, filters?)`       → `load_objects.fcgi`    → matching records
 *   - `modify(object, values, where)`→ `modify_objects.fcgi`  → `{ changes }`
 *   - `destroy(object, where)`       → `destroy_objects.fcgi` → `{ changes }`
 *
 * The set of supported objects, their known columns, and the mapping between
 * the device wire column names (snake_case, e.g. `user_id`) and the Drizzle
 * schema columns is described by a single data-driven registry
 * ({@link OBJECT_REGISTRY}). This keeps filter validation and record shaping
 * uniform and clean:
 *
 *   - `load` returns records where EVERY supplied filter matches (AND
 *     semantics, Req 4.4); an empty store or a no-match filter yields `[]`
 *     (Req 4.2).
 *   - Any filter/where/value key that is not a known column for the object is
 *     rejected with a {@link ValidationError} naming the offending parameter
 *     (Req 4.5).
 *
 * Records are returned keyed by the device wire column names (snake_case) and
 * stringified so the returned shape matches the device wire format (see the
 * `access_logs` shape in the API catalog).
 *
 * See design.md → "ObjectStore / UserRepository", "Data Models", Requirement 4.
 */
import { and, eq } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import type { DrizzleDb } from '../db/connection.js';
import {
  users,
  accessLogs,
  changeLogs,
  templates,
  cards,
  qrcodes,
  uhfTags,
  pins,
  alarmZones,
  userRoles,
  scheduledUnlocks,
  actions,
  areas,
  timeSpans,
  contingencyCards,
  holidays,
  alarmLogs,
  devices,
  catraInfos,
  logTypes,
  secBoxs,
  contacts,
  timedAlarms,
  accessEvents,
  customThresholds,
  usersGroups,
  accessRulePortals,
  accessRuleGroups,
  accessRuleTimeZones,
  userAccessRules,
  accessLogAccessRules,
  portalActions,
} from '../db/schema.js';
import { ValidationError } from './errors.js';

/**
 * Describes one wire column: its Drizzle column object, the JS/schema property
 * name Drizzle uses on selected rows and in insert/update objects (camelCase),
 * and whether it is a numeric column (only `users.id`).
 */
interface ColumnDefinition {
  column: SQLiteColumn;
  /** JS/schema property key (e.g. `deviceId`) used by Drizzle rows/inserts. */
  schemaKey: string;
  /** True for INTEGER columns whose filter values must be coerced to number. */
  numeric: boolean;
}

/**
 * Describes one supported object: its Drizzle table and the map of recognized
 * wire column names → {@link ColumnDefinition}. The keys of `columns` are the
 * ONLY recognized filter/where/value parameters for the object (Req 4.5).
 */
interface ObjectDefinition {
  table: SQLiteTable;
  columns: Record<string, ColumnDefinition>;
}

/**
 * The registry of supported object types. Adding a new object (e.g. `cards`)
 * is a matter of adding an entry here — validation, filtering, insert/update
 * key translation, and record shaping all derive from this single source of
 * truth.
 */
const OBJECT_REGISTRY: Record<string, ObjectDefinition> = {
  users: {
    table: users,
    columns: {
      id: { column: users.id, schemaKey: 'id', numeric: true },
      registration: { column: users.registration, schemaKey: 'registration', numeric: false },
      name: { column: users.name, schemaKey: 'name', numeric: false },
      password: { column: users.password, schemaKey: 'password', numeric: false },
      image_path: { column: users.imagePath, schemaKey: 'imagePath', numeric: false },
    },
  },
  access_logs: {
    table: accessLogs,
    columns: {
      id: { column: accessLogs.id, schemaKey: 'id', numeric: true },
      time: { column: accessLogs.time, schemaKey: 'time', numeric: false },
      event: { column: accessLogs.event, schemaKey: 'event', numeric: false },
      device_id: { column: accessLogs.deviceId, schemaKey: 'deviceId', numeric: false },
      identifier_id: { column: accessLogs.identifierId, schemaKey: 'identifierId', numeric: false },
      user_id: { column: accessLogs.userId, schemaKey: 'userId', numeric: false },
      portal_id: { column: accessLogs.portalId, schemaKey: 'portalId', numeric: false },
      identification_rule_id: {
        column: accessLogs.identificationRuleId,
        schemaKey: 'identificationRuleId',
        numeric: false,
      },
      card_value: { column: accessLogs.cardValue, schemaKey: 'cardValue', numeric: false },
      log_type_id: { column: accessLogs.logTypeId, schemaKey: 'logTypeId', numeric: false },
    },
  },
  change_logs: {
    table: changeLogs,
    columns: {
      id: { column: changeLogs.id, schemaKey: 'id', numeric: true },
      operation_type: { column: changeLogs.operationType, schemaKey: 'operationType', numeric: false },
      table_name: { column: changeLogs.tableName, schemaKey: 'tableName', numeric: false },
      table_id: { column: changeLogs.tableId, schemaKey: 'tableId', numeric: false },
      timestamp: { column: changeLogs.timestamp, schemaKey: 'timestamp', numeric: false },
    },
  },
  templates: {
    table: templates,
    columns: {
      id: { column: templates.id, schemaKey: 'id', numeric: true },
      finger_position: { column: templates.fingerPosition, schemaKey: 'fingerPosition', numeric: false },
      finger_type: { column: templates.fingerType, schemaKey: 'fingerType', numeric: false },
      template: { column: templates.template, schemaKey: 'template', numeric: false },
      user_id: { column: templates.userId, schemaKey: 'userId', numeric: false },
    },
  },
  cards: {
    table: cards,
    columns: {
      id: { column: cards.id, schemaKey: 'id', numeric: true },
      value: { column: cards.value, schemaKey: 'value', numeric: false },
      user_id: { column: cards.userId, schemaKey: 'userId', numeric: false },
    },
  },
  qrcodes: {
    table: qrcodes,
    columns: {
      id: { column: qrcodes.id, schemaKey: 'id', numeric: true },
      value: { column: qrcodes.value, schemaKey: 'value', numeric: false },
      user_id: { column: qrcodes.userId, schemaKey: 'userId', numeric: false },
    },
  },
  uhf_tags: {
    table: uhfTags,
    columns: {
      id: { column: uhfTags.id, schemaKey: 'id', numeric: true },
      value: { column: uhfTags.value, schemaKey: 'value', numeric: false },
      user_id: { column: uhfTags.userId, schemaKey: 'userId', numeric: false },
    },
  },
  pins: {
    table: pins,
    columns: {
      id: { column: pins.id, schemaKey: 'id', numeric: true },
      value: { column: pins.value, schemaKey: 'value', numeric: false },
      user_id: { column: pins.userId, schemaKey: 'userId', numeric: false },
    },
  },
  alarm_zones: {
    table: alarmZones,
    columns: {
      zone: { column: alarmZones.zone, schemaKey: 'zone', numeric: true },
      enabled: { column: alarmZones.enabled, schemaKey: 'enabled', numeric: false },
      active_level: { column: alarmZones.activeLevel, schemaKey: 'activeLevel', numeric: false },
      alarm_delay: { column: alarmZones.alarmDelay, schemaKey: 'alarmDelay', numeric: false },
    },
  },
  user_roles: {
    table: userRoles,
    columns: {
      user_id: { column: userRoles.userId, schemaKey: 'userId', numeric: true },
      role: { column: userRoles.role, schemaKey: 'role', numeric: false },
    },
  },
  scheduled_unlocks: {
    table: scheduledUnlocks,
    columns: {
      id: { column: scheduledUnlocks.id, schemaKey: 'id', numeric: true },
      name: { column: scheduledUnlocks.name, schemaKey: 'name', numeric: false },
      message: { column: scheduledUnlocks.message, schemaKey: 'message', numeric: false },
    },
  },
  actions: {
    table: actions,
    columns: {
      group_id: { column: actions.groupId, schemaKey: 'groupId', numeric: true },
      name: { column: actions.name, schemaKey: 'name', numeric: false },
      action: { column: actions.action, schemaKey: 'action', numeric: false },
      parameters: { column: actions.parameters, schemaKey: 'parameters', numeric: false },
      run_at: { column: actions.runAt, schemaKey: 'runAt', numeric: false },
    },
  },
  areas: {
    table: areas,
    columns: {
      id: { column: areas.id, schemaKey: 'id', numeric: true },
      name: { column: areas.name, schemaKey: 'name', numeric: false },
    },
  },
  time_spans: {
    table: timeSpans,
    columns: {
      id: { column: timeSpans.id, schemaKey: 'id', numeric: true },
      time_zone_id: { column: timeSpans.timeZoneId, schemaKey: 'timeZoneId', numeric: false },
      start: { column: timeSpans.start, schemaKey: 'start', numeric: false },
      end: { column: timeSpans.end, schemaKey: 'end', numeric: false },
      sun: { column: timeSpans.sun, schemaKey: 'sun', numeric: false },
      mon: { column: timeSpans.mon, schemaKey: 'mon', numeric: false },
      tue: { column: timeSpans.tue, schemaKey: 'tue', numeric: false },
      wed: { column: timeSpans.wed, schemaKey: 'wed', numeric: false },
      thu: { column: timeSpans.thu, schemaKey: 'thu', numeric: false },
      fri: { column: timeSpans.fri, schemaKey: 'fri', numeric: false },
      sat: { column: timeSpans.sat, schemaKey: 'sat', numeric: false },
      hol1: { column: timeSpans.hol1, schemaKey: 'hol1', numeric: false },
      hol2: { column: timeSpans.hol2, schemaKey: 'hol2', numeric: false },
      hol3: { column: timeSpans.hol3, schemaKey: 'hol3', numeric: false },
    },
  },
  contingency_cards: {
    table: contingencyCards,
    columns: {
      id: { column: contingencyCards.id, schemaKey: 'id', numeric: true },
      value: { column: contingencyCards.value, schemaKey: 'value', numeric: false },
    },
  },
  holidays: {
    table: holidays,
    columns: {
      id: { column: holidays.id, schemaKey: 'id', numeric: true },
      name: { column: holidays.name, schemaKey: 'name', numeric: false },
      start: { column: holidays.start, schemaKey: 'start', numeric: false },
      end: { column: holidays.end, schemaKey: 'end', numeric: false },
      hol1: { column: holidays.hol1, schemaKey: 'hol1', numeric: false },
      hol2: { column: holidays.hol2, schemaKey: 'hol2', numeric: false },
      hol3: { column: holidays.hol3, schemaKey: 'hol3', numeric: false },
      repeats: { column: holidays.repeats, schemaKey: 'repeats', numeric: false },
    },
  },
  alarm_logs: {
    table: alarmLogs,
    columns: {
      id: { column: alarmLogs.id, schemaKey: 'id', numeric: true },
      event: { column: alarmLogs.event, schemaKey: 'event', numeric: false },
      cause: { column: alarmLogs.cause, schemaKey: 'cause', numeric: false },
      user_id: { column: alarmLogs.userId, schemaKey: 'userId', numeric: false },
      time: { column: alarmLogs.time, schemaKey: 'time', numeric: false },
      access_log_id: { column: alarmLogs.accessLogId, schemaKey: 'accessLogId', numeric: false },
      door_id: { column: alarmLogs.doorId, schemaKey: 'doorId', numeric: false },
    },
  },
  devices: {
    table: devices,
    columns: {
      id: { column: devices.id, schemaKey: 'id', numeric: true },
      name: { column: devices.name, schemaKey: 'name', numeric: false },
      ip: { column: devices.ip, schemaKey: 'ip', numeric: false },
    },
  },
  catra_infos: {
    table: catraInfos,
    columns: {
      id: { column: catraInfos.id, schemaKey: 'id', numeric: true },
      left_turns: { column: catraInfos.leftTurns, schemaKey: 'leftTurns', numeric: false },
      right_turns: { column: catraInfos.rightTurns, schemaKey: 'rightTurns', numeric: false },
      entrance_turns: { column: catraInfos.entranceTurns, schemaKey: 'entranceTurns', numeric: false },
      exit_turns: { column: catraInfos.exitTurns, schemaKey: 'exitTurns', numeric: false },
    },
  },
  log_types: {
    table: logTypes,
    columns: {
      id: { column: logTypes.id, schemaKey: 'id', numeric: true },
      name: { column: logTypes.name, schemaKey: 'name', numeric: false },
    },
  },
  sec_boxs: {
    table: secBoxs,
    columns: {
      id: { column: secBoxs.id, schemaKey: 'id', numeric: true },
      version: { column: secBoxs.version, schemaKey: 'version', numeric: false },
      name: { column: secBoxs.name, schemaKey: 'name', numeric: false },
      enabled: { column: secBoxs.enabled, schemaKey: 'enabled', numeric: false },
      relay_timeout: { column: secBoxs.relayTimeout, schemaKey: 'relayTimeout', numeric: false },
      door_sensor_enabled: {
        column: secBoxs.doorSensorEnabled,
        schemaKey: 'doorSensorEnabled',
        numeric: false,
      },
      door_sensor_idle: { column: secBoxs.doorSensorIdle, schemaKey: 'doorSensorIdle', numeric: false },
      auto_close_enabled: {
        column: secBoxs.autoCloseEnabled,
        schemaKey: 'autoCloseEnabled',
        numeric: false,
      },
    },
  },
  contacts: {
    table: contacts,
    columns: {
      id: { column: contacts.id, schemaKey: 'id', numeric: true },
      name: { column: contacts.name, schemaKey: 'name', numeric: false },
      number: { column: contacts.number, schemaKey: 'number', numeric: false },
    },
  },
  timed_alarms: {
    table: timedAlarms,
    columns: {
      id: { column: timedAlarms.id, schemaKey: 'id', numeric: true },
      name: { column: timedAlarms.name, schemaKey: 'name', numeric: false },
      start: { column: timedAlarms.start, schemaKey: 'start', numeric: false },
      sun: { column: timedAlarms.sun, schemaKey: 'sun', numeric: false },
      mon: { column: timedAlarms.mon, schemaKey: 'mon', numeric: false },
      tue: { column: timedAlarms.tue, schemaKey: 'tue', numeric: false },
      wed: { column: timedAlarms.wed, schemaKey: 'wed', numeric: false },
      thu: { column: timedAlarms.thu, schemaKey: 'thu', numeric: false },
      fri: { column: timedAlarms.fri, schemaKey: 'fri', numeric: false },
      sat: { column: timedAlarms.sat, schemaKey: 'sat', numeric: false },
    },
  },
  access_events: {
    table: accessEvents,
    columns: {
      id: { column: accessEvents.id, schemaKey: 'id', numeric: true },
      event: { column: accessEvents.event, schemaKey: 'event', numeric: false },
      type: { column: accessEvents.type, schemaKey: 'type', numeric: false },
      identification: { column: accessEvents.identification, schemaKey: 'identification', numeric: false },
      device_id: { column: accessEvents.deviceId, schemaKey: 'deviceId', numeric: false },
      timestamp: { column: accessEvents.timestamp, schemaKey: 'timestamp', numeric: false },
    },
  },
  custom_thresholds: {
    table: customThresholds,
    columns: {
      id: { column: customThresholds.id, schemaKey: 'id', numeric: true },
      user_id: { column: customThresholds.userId, schemaKey: 'userId', numeric: false },
      threshold: { column: customThresholds.threshold, schemaKey: 'threshold', numeric: false },
    },
  },
  // Reuses the admin-panel's `users_groups` table (Padrão B) — same
  // real-world association, exposed here through the device wire protocol
  // for fidelity: editing it via either interface affects the same rows.
  user_groups: {
    table: usersGroups,
    columns: {
      user_id: { column: usersGroups.userId, schemaKey: 'userId', numeric: true },
      group_id: { column: usersGroups.groupId, schemaKey: 'groupId', numeric: true },
    },
  },
  // Reuses the admin-panel's `access_rule_portals` table (Padrão B) — same
  // real-world association, exposed here through the device wire protocol.
  portal_access_rules: {
    table: accessRulePortals,
    columns: {
      portal_id: { column: accessRulePortals.portalId, schemaKey: 'portalId', numeric: true },
      access_rule_id: {
        column: accessRulePortals.accessRuleId,
        schemaKey: 'accessRuleId',
        numeric: true,
      },
    },
  },
  // Reuses the admin-panel's `access_rule_groups` table (Padrão B) — same
  // real-world association, exposed here through the device wire protocol.
  group_access_rules: {
    table: accessRuleGroups,
    columns: {
      group_id: { column: accessRuleGroups.groupId, schemaKey: 'groupId', numeric: true },
      access_rule_id: {
        column: accessRuleGroups.accessRuleId,
        schemaKey: 'accessRuleId',
        numeric: true,
      },
    },
  },
  // Reuses the admin-panel's `access_rule_time_zones` table (Padrão B) —
  // same real-world association, exposed here through the device wire
  // protocol.
  access_rule_time_zones: {
    table: accessRuleTimeZones,
    columns: {
      access_rule_id: {
        column: accessRuleTimeZones.accessRuleId,
        schemaKey: 'accessRuleId',
        numeric: true,
      },
      time_zone_id: {
        column: accessRuleTimeZones.timeZoneId,
        schemaKey: 'timeZoneId',
        numeric: true,
      },
    },
  },
  user_access_rules: {
    table: userAccessRules,
    columns: {
      user_id: { column: userAccessRules.userId, schemaKey: 'userId', numeric: true },
      access_rule_id: { column: userAccessRules.accessRuleId, schemaKey: 'accessRuleId', numeric: true },
    },
  },
  access_log_access_rules: {
    table: accessLogAccessRules,
    columns: {
      access_log_id: { column: accessLogAccessRules.accessLogId, schemaKey: 'accessLogId', numeric: true },
      access_rule_id: {
        column: accessLogAccessRules.accessRuleId,
        schemaKey: 'accessRuleId',
        numeric: true,
      },
    },
  },
  portal_actions: {
    table: portalActions,
    columns: {
      portal_id: { column: portalActions.portalId, schemaKey: 'portalId', numeric: true },
      action_id: { column: portalActions.actionId, schemaKey: 'actionId', numeric: true },
    },
  },
};

/** Result of a {@link ObjectStore.create} call. */
export interface CreateResult {
  /** The auto-incremented ids assigned to the inserted rows, in order. */
  ids: number[];
}

/** Result of a {@link ObjectStore.modify}/{@link ObjectStore.destroy} call. */
export interface ChangesResult {
  /** The number of rows affected. */
  changes: number;
}

/**
 * CRUD facade over the Control-iD object model backed by Drizzle/SQLite.
 */
export class ObjectStore {
  constructor(private readonly db: DrizzleDb) {}

  /**
   * Resolve an object definition or throw a {@link ValidationError} naming the
   * unknown object (Req 4.5).
   */
  private definition(object: string): ObjectDefinition {
    const def = OBJECT_REGISTRY[object];
    if (!def) {
      throw new ValidationError(`Unknown object type: '${object}'`, object);
    }
    return def;
  }

  /**
   * Validate that every key in `params` is a recognized column for the object.
   * Throws a {@link ValidationError} naming the first unrecognized parameter
   * (Req 4.5). Returns the resolved {@link ColumnDefinition}s keyed by wire name.
   */
  private resolveColumns(
    def: ObjectDefinition,
    params: Record<string, unknown>,
    kind: 'filter' | 'where' | 'value',
  ): Record<string, ColumnDefinition> {
    const resolved: Record<string, ColumnDefinition> = {};
    for (const key of Object.keys(params)) {
      const col = def.columns[key];
      if (col === undefined) {
        throw new ValidationError(`Unrecognized ${kind} parameter: '${key}'`, key);
      }
      resolved[key] = col;
    }
    return resolved;
  }

  /** Build the equality conditions for a validated where/filter map. */
  private buildConditions(
    resolved: Record<string, ColumnDefinition>,
    params: Record<string, unknown>,
  ): SQL[] {
    return Object.entries(params).map(([key, value]) => {
      const def = resolved[key];
      return eq(def.column, this.toColumnValue(def, value));
    });
  }

  /**
   * Translate a validated wire record (snake_case keys) into a Drizzle
   * insert/update object keyed by the schema JS property (camelCase).
   */
  private toSchemaValues(
    resolved: Record<string, ColumnDefinition>,
    values: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      const def = resolved[key];
      out[def.schemaKey] = this.toColumnValue(def, value);
    }
    return out;
  }

  /**
   * Convert a raw Drizzle row (keyed by camelCase schema keys) into a wire
   * record keyed by the object's snake_case wire column names, stringifying
   * non-null values so the returned shape matches the device wire format.
   */
  private toWireRecord(
    def: ObjectDefinition,
    row: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [wireKey, colDef] of Object.entries(def.columns)) {
      const value = row[colDef.schemaKey];
      out[wireKey] = value === null || value === undefined ? value : String(value);
    }
    return out;
  }

  /**
   * Coerce a filter/where/value into the column's storage type. Numeric columns
   * (only `id`) coerce to a number so equality matches the INTEGER column;
   * everything else is stringified to match the TEXT columns.
   */
  private toColumnValue(def: ColumnDefinition, value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }
    if (def.numeric) {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isNaN(n) ? value : n;
    }
    return typeof value === 'string' ? value : String(value);
  }

  /**
   * Insert one or more rows for `object`, returning the assigned ids in order
   * (Req 4.1). Value keys are validated against the object's known columns; an
   * unrecognized key throws a {@link ValidationError} (Req 4.5).
   */
  async create(
    object: string,
    values: Record<string, unknown>[],
  ): Promise<CreateResult> {
    const def = this.definition(object);
    const ids: number[] = [];

    for (const value of values) {
      const resolved = this.resolveColumns(def, value, 'value');
      const insertValues = this.toSchemaValues(resolved, value);
      const result = this.db
        // Drizzle's generic insert type cannot be expressed over the dynamic
        // registry; the values are validated/translated above.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert(def.table as any)
        .values(insertValues)
        .run();
      ids.push(Number(result.lastInsertRowid));
    }

    return { ids };
  }

  /**
   * Return records matching EVERY supplied filter (AND semantics, Req 4.4).
   * With no filters, all records for the object are returned. An empty store or
   * a filter set that matches nothing yields `[]` (Req 4.2). Unrecognized
   * filter keys throw a {@link ValidationError} naming the parameter (Req 4.5).
   */
  async load(
    object: string,
    filters?: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    const def = this.definition(object);
    const filterMap = filters ?? {};
    const resolved = this.resolveColumns(def, filterMap, 'filter');
    const conditions = this.buildConditions(resolved, filterMap);
    const where = conditions.length === 0 ? undefined : and(...conditions);

    const rows = this.db
      .select()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from(def.table as any)
      .where(where)
      .all() as Record<string, unknown>[];

    return rows.map((row) => this.toWireRecord(def, row));
  }

  /**
   * Update rows matching `where` with `values`, returning the number of rows
   * changed. Both `values` and `where` keys are validated against the object's
   * known columns (Req 4.5).
   */
  async modify(
    object: string,
    values: Record<string, unknown>,
    where: Record<string, unknown>,
  ): Promise<ChangesResult> {
    const def = this.definition(object);
    const valueCols = this.resolveColumns(def, values, 'value');
    const whereCols = this.resolveColumns(def, where, 'where');
    const conditions = this.buildConditions(whereCols, where);
    const whereClause = conditions.length === 0 ? undefined : and(...conditions);

    const result = this.db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update(def.table as any)
      .set(this.toSchemaValues(valueCols, values))
      .where(whereClause)
      .run();

    return { changes: result.changes };
  }

  /**
   * Delete rows matching `where`, returning the number of rows removed. `where`
   * keys are validated against the object's known columns (Req 4.5).
   */
  async destroy(
    object: string,
    where: Record<string, unknown>,
  ): Promise<ChangesResult> {
    const def = this.definition(object);
    const whereCols = this.resolveColumns(def, where, 'where');
    const conditions = this.buildConditions(whereCols, where);
    const whereClause = conditions.length === 0 ? undefined : and(...conditions);

    const result = this.db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .delete(def.table as any)
      .where(whereClause)
      .run();

    return { changes: result.changes };
  }
}
