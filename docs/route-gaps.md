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

## Implemented (28)

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

## Route Gaps (12)

`user_groups`,
`portal_actions`, `portal_access_rules`, `group_access_rules`,
`contingency_card_access_rules`,
`alarm_zone_time_zones`, `access_rule_time_zones`,
`access_log_access_rules`, `user_access_rules`,
`area_access_rules`,
`custom_thresholds`,
`network_interlocking_rules`

Each of these needs a dedicated Drizzle schema + `OBJECT_REGISTRY` entry per
[spec #41](https://github.com/victor-lis-bronzo/controlid-facial-emulator/issues/41)
(Padrão A, replicating `users`/`access_logs`/`change_logs`/`templates`/`cards`/
`qrcodes`/`uhf_tags`/`pins`/`alarm_zones`/`user_roles`), tracked as individual
tickets on GitHub Issues #50–#76 (ticket numbers don't run in the same order
as this list — check each issue's title rather than assuming a range maps to
a specific object; `user_roles` is done via #65, not #50).

## Action endpoints (not object CRUD)

Also documented by the official API but not yet implemented, and out of
scope for this file's object-coverage table: `execute_actions.fcgi`
(door/sec_box/open_collector/catra), `door_state.fcgi`, `reboot.fcgi`,
`gpio_state.fcgi`, message-to-screen, network settings, report export,
remote access authorization, `logout.fcgi`.
