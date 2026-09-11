/**
 * Request/response contract types for the emulated Control-iD `.fcgi`
 * endpoints.
 *
 * Every shape is grounded in the design's "API / Endpoint Specification" table,
 * which reproduces the Official API Documentation
 * (https://www.controlid.com.br/docs/access-api-pt/). Field names are
 * case-sensitive and match the device exactly (Req 1.1, 1.2).
 *
 * Types/interfaces only — no business logic.
 */

import type { AccessEvent } from './domain-types.js';
import type { MonitorConfig } from './config-types.js';

/* -------------------------------------------------------------------------- */
/* /login.fcgi                                                                 */
/* -------------------------------------------------------------------------- */

/** `POST /login.fcgi` request: `{ "login": "admin", "password": "admin" }`. */
export interface LoginRequest {
  login: string;
  password: string;
}

/** `POST /login.fcgi` response: `{ "session": "apx7NM2CErTcvXpuvExuzaZ" }`. */
export interface LoginResponse {
  session: string;
}

/* -------------------------------------------------------------------------- */
/* /session_is_valid.fcgi                                                      */
/* -------------------------------------------------------------------------- */

/** `POST /session_is_valid.fcgi` request: `{ "session": "<token>" }`. */
export interface SessionIsValidRequest {
  session: string;
}

/** `POST /session_is_valid.fcgi` response: `{ "session_is_valid": true }`. */
export interface SessionIsValidResponse {
  session_is_valid: boolean;
}

/* -------------------------------------------------------------------------- */
/* /set_configuration.fcgi                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `POST /set_configuration.fcgi` request: a map from module name to a partial
 * patch of that module's keys, e.g. `{ "monitor": { "hostname": "...", ... } }`.
 */
export interface SetConfigurationRequest {
  monitor?: Partial<MonitorConfig>;
  /** Other recognized modules may be added; unknown keys are rejected. */
  [module: string]: Record<string, unknown> | undefined;
}

/** `POST /set_configuration.fcgi` success response: `{}`. */
export type SetConfigurationResponse = Record<string, never>;

/* -------------------------------------------------------------------------- */
/* /get_configuration.fcgi                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `POST /get_configuration.fcgi` request: a map from module name to the list of
 * keys to read, e.g. `{ "monitor": ["alive_interval"] }`.
 */
export interface GetConfigurationRequest {
  [module: string]: string[];
}

/**
 * `POST /get_configuration.fcgi` response: a map from module name to the
 * requested key/value pairs, e.g. `{ "monitor": { "alive_interval": "30000" } }`.
 * Device returns values as strings.
 */
export interface GetConfigurationResponse {
  [module: string]: Record<string, string>;
}

/* -------------------------------------------------------------------------- */
/* /create_objects.fcgi                                                        */
/* -------------------------------------------------------------------------- */

/**
 * `POST /create_objects.fcgi` request:
 * `{ "object": "users", "values": [{ "registration": "0123", ... }] }`.
 */
export interface CreateObjectsRequest {
  object: string;
  values: Record<string, unknown>[];
}

/** `POST /create_objects.fcgi` response: `{ "ids": [8] }`. */
export interface CreateObjectsResponse {
  ids: number[];
}

/* -------------------------------------------------------------------------- */
/* /load_objects.fcgi                                                          */
/* -------------------------------------------------------------------------- */

/**
 * `POST /load_objects.fcgi` request:
 * `{ "object": "access_logs", "where": { ... } }`. `where` is an optional
 * filter map.
 */
export interface LoadObjectsRequest {
  object: string;
  where?: Record<string, unknown>;
}

/**
 * `POST /load_objects.fcgi` response: the requested object collection keyed by
 * object name, e.g. `{ "access_logs": [ { ... } ] }`.
 */
export type LoadObjectsResponse = Record<string, Record<string, unknown>[]>;

/* -------------------------------------------------------------------------- */
/* /modify_objects.fcgi                                                        */
/* -------------------------------------------------------------------------- */

/**
 * `POST /modify_objects.fcgi` request:
 * `{ "object": "users", "values": {...}, "where": {...} }`.
 */
export interface ModifyObjectsRequest {
  object: string;
  values: Record<string, unknown>;
  where: Record<string, unknown>;
}

/** `POST /modify_objects.fcgi` response: `{ "changes": 1 }`. */
export interface ModifyObjectsResponse {
  changes: number;
}

/* -------------------------------------------------------------------------- */
/* /destroy_objects.fcgi                                                       */
/* -------------------------------------------------------------------------- */

/** `POST /destroy_objects.fcgi` request: `{ "object": "users", "where": {...} }`. */
export interface DestroyObjectsRequest {
  object: string;
  where: Record<string, unknown>;
}

/** `POST /destroy_objects.fcgi` response: `{ "changes": 1 }`. */
export interface DestroyObjectsResponse {
  changes: number;
}

/* -------------------------------------------------------------------------- */
/* /new_user_identified.fcgi — "Mensagem de Retorno"                           */
/* -------------------------------------------------------------------------- */

/**
 * A single action returned in the online-identification reply, e.g.
 * `{ "action": "door", "parameters": "door=1" }`.
 */
export interface NewUserIdentifiedAction {
  action: string;
  parameters: string;
}

/**
 * `POST /new_user_identified.fcgi` reply ("Mensagem de Retorno"):
 * `{ "result": { "event": 7, "user_id": 6, "user_name": "Neal Caffrey",
 *    "user_image": false, "portal_id": 1,
 *    "actions": [ { "action": "door", "parameters": "door=1" } ],
 *    "message": "..." } }`.
 */
export interface NewUserIdentifiedResponse {
  result: {
    /** Event code (numeric, e.g. `7` granted / `6` denied / `3` not identified). */
    event: AccessEvent;
    user_id: number;
    user_name: string;
    /** Whether an identification photo is included. */
    user_image: boolean;
    portal_id: number;
    actions: NewUserIdentifiedAction[];
    /** Optional human-readable message. */
    message?: string;
  };
}
