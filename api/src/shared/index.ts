/**
 * Barrel module re-exporting all shared Control-iD payload/types.
 *
 * This module contains ONLY types/interfaces and documented default constants.
 * No business logic, no service/DB imports.
 */

export type {
  MonitorConfig,
  ConfigModulePatch,
  ConfigPatch,
  ConfigDefaults,
} from './config-types.js';
export { DEFAULT_MONITOR_CONFIG, CONFIG_DEFAULTS } from './config-types.js';

export type {
  UserRecord,
  AccessLogRecord,
  SessionToken,
  AccessEvent,
  AccessEventName,
} from './domain-types.js';
export { ACCESS_EVENT } from './domain-types.js';

export type {
  PushFailureCategory,
  PushOutcome,
  DaoObjectChange,
  DaoNotification,
  DeviceIsAliveNotification,
  OperationModeNotification,
  DoorNotification,
  WebhookNotification,
} from './push-types.js';

export type {
  InterceptionDirection,
  InterceptionOutcome,
  InterceptionRecord,
} from './interception-types.js';

export type {
  LoginRequest,
  LoginResponse,
  SessionIsValidRequest,
  SessionIsValidResponse,
  SetConfigurationRequest,
  SetConfigurationResponse,
  GetConfigurationRequest,
  GetConfigurationResponse,
  CreateObjectsRequest,
  CreateObjectsResponse,
  LoadObjectsRequest,
  LoadObjectsResponse,
  ModifyObjectsRequest,
  ModifyObjectsResponse,
  DestroyObjectsRequest,
  DestroyObjectsResponse,
  NewUserIdentifiedAction,
  NewUserIdentifiedResponse,
} from './fcgi-contracts.js';
