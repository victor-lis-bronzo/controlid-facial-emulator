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

## Implemented (12)

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

## Route Gaps (28)

`alarm_zones`, `user_roles`, `user_groups`, `scheduled_unlocks`, `actions`,
`areas`, `portal_actions`, `portal_access_rules`, `group_access_rules`,
`time_spans`, `contingency_cards`, `contingency_card_access_rules`,
`holidays`, `alarm_zone_time_zones`, `access_rule_time_zones`,
`access_log_access_rules`, `alarm_logs`, `devices`, `user_access_rules`,
`area_access_rules`, `catra_infos`, `log_types`, `sec_boxs`, `contacts`,
`timed_alarms`, `access_events`, `custom_thresholds`,
`network_interlocking_rules`

Each of these needs a dedicated Drizzle schema + `OBJECT_REGISTRY` entry per
[spec #41](https://github.com/victor-lis-bronzo/controlid-facial-emulator/issues/41)
(Padrão A, replicating `users`/`access_logs`/`change_logs`/`templates`/`cards`/
`qrcodes`/`uhf_tags`/`pins`), tracked as individual tickets on GitHub Issues
(#49–#76).

## Action endpoints (not object CRUD)

Also documented by the official API but not yet implemented, and out of
scope for this file's object-coverage table: `execute_actions.fcgi`
(door/sec_box/open_collector/catra), `door_state.fcgi`, `reboot.fcgi`,
`gpio_state.fcgi`, message-to-screen, network settings, report export,
remote access authorization, `logout.fcgi`.
