# Route Gaps — Access API object coverage

Full list of the ~40 "object" types documented by the official
[Control-iD Access API](https://www.controlid.com.br/docs/access-api-pt/)
(source: `access-api-en/objects/list-of-objects/`) usable with
`create_objects.fcgi` / `load_objects.fcgi` / `modify_objects.fcgi` /
`destroy_objects.fcgi`, against what this emulator implements today.

Per [ADR 0002](adr/0002-full-route-coverage-mocked-hardware.md), every row
below is either implemented or a Route Gap — never a permanent "out of
scope". See [CONTEXT.md](../CONTEXT.md) for the Documented Divergence /
Route Gap distinction.

## Implemented (40)

| Object | Table | Repository |
| --- | --- | --- |
| `users` | `users` | `api/src/repositories/` |
| `groups` | `groups` | `api/src/repositories/` |
| `portals` | `portals` | `api/src/repositories/` |
| `time_zones` | `timeZones` | `api/src/repositories/` |
| `access_rules` | `accessRules` | `api/src/repositories/` |
| `access_logs` | `accessLogs` | `api/src/repositories/` |
| `change_logs` | `changeLogs` | `api/src/repositories/object-store.ts` |
| `templates` | `templates` | `api/src/repositories/object-store.ts` |
| `cards` | `cards` | `api/src/repositories/object-store.ts` |
| `qrcodes` | `qrcodes` | `api/src/repositories/object-store.ts` |
| `uhf_tags` | `uhfTags` | `api/src/repositories/object-store.ts` |
| `pins` | `pins` | `api/src/repositories/object-store.ts` |
| `alarm_zones` | `alarmZones` | `api/src/repositories/object-store.ts` |
| `user_roles` | `userRoles` | `api/src/repositories/object-store.ts` |
| `scheduled_unlocks` | `scheduledUnlocks` | `api/src/repositories/object-store.ts` |
| `actions` | `actions` | `api/src/repositories/object-store.ts` |
| `areas` | `areas` | `api/src/repositories/object-store.ts` |
| `time_spans` | `timeSpans` | `api/src/repositories/object-store.ts` |
| `contingency_cards` | `contingencyCards` | `api/src/repositories/object-store.ts` |
| `holidays` | `holidays` | `api/src/repositories/object-store.ts` |
| `alarm_logs` | `alarmLogs` | `api/src/repositories/object-store.ts` |
| `devices` | `devices` | `api/src/repositories/object-store.ts` |
| `catra_infos` | `catraInfos` | `api/src/repositories/object-store.ts` |
| `log_types` | `logTypes` | `api/src/repositories/object-store.ts` |
| `sec_boxs` | `secBoxs` | `api/src/repositories/object-store.ts` |
| `contacts` | `contacts` | `api/src/repositories/object-store.ts` |
| `timed_alarms` | `timedAlarms` | `api/src/repositories/object-store.ts` |
| `access_events` | `accessEvents` | `api/src/repositories/object-store.ts` |
| `custom_thresholds` | `customThresholds` | `api/src/repositories/object-store.ts` |
| `user_groups` | `usersGroups` (reused from Padrão B) | `api/src/repositories/object-store.ts` |
| `portal_access_rules` | `accessRulePortals` (reused from Padrão B) | `api/src/repositories/object-store.ts` |
| `group_access_rules` | `accessRuleGroups` (reused from Padrão B) | `api/src/repositories/object-store.ts` |
| `access_rule_time_zones` | `accessRuleTimeZones` (reused from Padrão B) | `api/src/repositories/object-store.ts` |
| `user_access_rules` | `userAccessRules` | `api/src/repositories/object-store.ts` |
| `access_log_access_rules` | `accessLogAccessRules` | `api/src/repositories/object-store.ts` |
| `portal_actions` | `portalActions` | `api/src/repositories/object-store.ts` |
| `alarm_zone_time_zones` | `alarmZoneTimeZones` | `api/src/repositories/object-store.ts` |
| `contingency_card_access_rules` | `contingencyCardAccessRules` | `api/src/repositories/object-store.ts` |
| `area_access_rules` | `areaAccessRules` | `api/src/repositories/object-store.ts` |
| `network_interlocking_rules` | `networkInterlockingRules` | `api/src/repositories/object-store.ts` |

## Route Gaps (0)

All ~40 documented Access API object types are implemented. The object-CRUD
side of [spec #41](https://github.com/victor-lis-bronzo/controlid-facial-emulator/issues/41)
(tickets #43–#76) is complete; see git history for the individual
`feat(api): implement <object> Access API object (#N)` commits. Per
[ADR 0002](adr/0002-full-route-coverage-mocked-hardware.md), the remaining
uncovered surface is the action endpoints listed below, not object CRUD.

## Action endpoints (not object CRUD)

Also documented by the official API but not yet implemented, and out of
scope for this file's object-coverage table: `execute_actions.fcgi`
(door/sec_box/open_collector/catra), `door_state.fcgi`, `reboot.fcgi`,
`gpio_state.fcgi`, message-to-screen, network settings, report export,
remote access authorization, `logout.fcgi`.
