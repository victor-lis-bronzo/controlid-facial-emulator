# Route Gap objects — official field reference

Field-level reference for the 34 Route Gap objects listed in
[route-gaps.md](route-gaps.md) / [spec #41](https://github.com/victor-lis-bronzo/controlid-facial-emulator/issues/41),
produced for [ticket #42](https://github.com/victor-lis-bronzo/controlid-facial-emulator/issues/42).

**Source**: [Control-iD Access API — List of Objects](https://www.controlid.com.br/docs/access-api-en/objects/list-of-objects/)
(English mirror of `access-api-pt`; same content, same object model). All
field names below are the device wire names (snake_case), matching what
`ObjectStore.OBJECT_REGISTRY` keys should use.

Legend: **Type** is the official doc's type; map `int`/`int 64`/`unsigned int 64`
→ Drizzle `integer` (`numeric: true` in the registry) and
`string`/`base 64 string`/`bool` → Drizzle `text` (`numeric: false`), following
the existing convention in `object-store.ts` (only `id`-like/FK integer
columns are `numeric: true`; everything else — including booleans — is
stored/wire-shaped as text, matching the device's stringified wire format).

## change_logs

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| id | int64 | yes | — | PK |
| operation_type | string | yes | — | |
| table_name | string | yes | — | name of the changed object |
| table_id | int | yes | — | id of the modified record |
| timestamp | int | yes | — | Unix timestamp |

## templates

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| id | int64 | yes | — | PK |
| finger_position | int | no | — | reserved field |
| finger_type | int | yes | — | 0 = common finger, 1 = panic finger |
| template | base64 string | no | — | biometric template payload |
| user_id | int64 | yes | — | FK `users.id` |

## cards

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| id | int64 | yes | — | PK |
| value | unsigned int64 | yes (unique) | — | card number |
| user_id | int64 | yes | — | FK `users.id` |

## qrcodes

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| id | int64 | yes | — | PK |
| value | string | yes (unique) | — | QR content |
| user_id | int64 | yes | — | FK `users.id` |

## uhf_tags

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| id | int64 | yes | — | PK |
| value | string | yes (unique) | — | tag value |
| user_id | int64 | yes | — | FK `users.id` |

## pins

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| id | int64 | yes | — | PK |
| value | string | yes (unique) | — | PIN value |
| user_id | int64 | yes (unique) | — | FK `users.id` |

## alarm_zones

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| zone | int | yes | — | **PK — not `id`** |
| enabled | int | yes | — | 1/0 |
| active_level | int | yes | — | 1 = active-high, 0 = active-low |
| alarm_delay | int | yes | — | trigger delay |

## user_roles

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| user_id | int64 | yes | — | FK `users.id`; composite PK with no surrogate `id` |
| role | int | yes | — | 1 = administrator |

## user_groups

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| user_id | int64 | yes | — | FK `users.id`; composite PK |
| group_id | int | yes | — | FK `groups.id` |

## scheduled_unlocks

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| id | int64 | yes | — | PK |
| name | string | yes | — | |
| message | string | no | — | shown during unlock |

## actions

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| group_id | int64 | yes | — | **PK — not `id`** |
| name | string | yes | — | |
| action | string | yes | — | script filename |
| parameters | string | yes | — | script parameters |
| run_at | int | yes | — | 0 = device, 1 = all devices, 2 = server |

## areas

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| id | int64 | yes | — | PK |
| name | string | yes | — | |

## portal_actions

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| portal_id | int64 | yes | — | FK `portals.id`; composite PK |
| action_id | int64 | yes | — | FK `actions.group_id` (not `actions.id`) |

## portal_access_rules

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| portal_id | int64 | yes | — | FK `portals.id`; composite PK |
| access_rule_id | int64 | yes | — | FK `access_rules.id` |

## group_access_rules

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| group_id | int64 | yes | — | FK `groups.id`; composite PK |
| access_rule_id | int64 | yes | — | FK `access_rules.id` |

## time_spans

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| id | int64 | yes | — | PK |
| time_zone_id | int64 | yes | — | FK `time_zones.id` |
| start | int | yes | — | seconds since 00:00 |
| end | int | yes | — | seconds since 00:00 |
| sun/mon/tue/wed/thu/fri/sat | int | yes | — | 1 flag per weekday |
| hol1/hol2/hol3 | int | yes | — | 1 flag per holiday group |

## contingency_cards

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| id | int | yes | — | PK, auto-increment |
| value | int64 | yes | — | card number authorized in contingency mode |

## contingency_card_access_rules

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| access_rule_id | int64 | yes | `1` | FK `access_rules.id` |

**Ambiguity flagged**: the official doc lists **only** `access_rule_id` for
this object — there is no `contingency_card_id`/similar FK back to
`contingency_cards`. It is a single global "which access rule governs
contingency mode" setting, not a per-card association table, despite its
name. **Action taken**: [ticket #74](https://github.com/victor-lis-bronzo/controlid-facial-emulator/issues/74)'s
dependency on the `contingency_cards` ticket (#54) is not justified by the
real schema — see correction note below.

## holidays

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| id | int | yes | — | PK |
| name | string | yes | — | |
| start | int | yes | — | Unix timestamp |
| end | int | yes | — | Unix timestamp |
| hol1/hol2/hol3 | int | yes | — | 0/1 group membership |
| repeats | int | yes | — | 0/1 annual repeat |

## alarm_zone_time_zones

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| alarm_zone_id | int64 | yes | — | FK `alarm_zones.zone` (not `.id`); composite PK |
| time_zone_id | int64 | yes | — | FK `time_zones.id` |

## access_rule_time_zones

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| access_rule_id | int64 | yes | — | FK `access_rules.id`; composite PK |
| time_zone_id | int64 | yes | — | FK `time_zones.id` |

## access_log_access_rules

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| access_log_id | int64 | yes | — | FK `access_logs.id`; composite PK |
| access_rule_id | int64 | yes | — | FK `access_rules.id` |

## alarm_logs

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| id | int64 | yes | — | PK |
| event | int | yes | — | 1 = Alarm On, 2 = Alarm Off |
| cause | int | yes | — | 1–10, alarm source |
| user_id | int64 | no | — | FK `users.id` |
| time | int | yes | — | Unix timestamp |
| access_log_id | int | no | — | FK `access_logs.id` |
| door_id | int | no | — | |

## devices

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| id | int64 | yes | — | PK |
| name | string | yes | — | |
| ip | string | yes | — | IP or domain |

## user_access_rules

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| user_id | int | yes | — | FK `users.id`; composite PK |
| access_rule_id | int | yes | — | FK `access_rules.id` |

## area_access_rules

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| area_id | int | yes | — | FK `areas.id`; composite PK |
| access_rule_id | int | yes | — | FK `access_rules.id` |

## catra_infos

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| id | int | no | — | turnstile identifier |
| left_turns | int64 | no | — | |
| right_turns | int64 | no | — | |
| entrance_turns | int64 | no | — | |
| exit_turns | int64 | no | — | |

## log_types

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| id | int | yes | — | PK |
| name | string | yes | — | |

## sec_boxs

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| id | int64 | no | `65793` | fixed constant per official doc |
| version | int | no | — | |
| name | string | no | — | |
| enabled | bool | no | — | |
| relay_timeout | int | no | — | ms |
| door_sensor_enabled | bool | no | — | |
| door_sensor_idle | bool | no | — | NO=1/NC=0 |
| auto_close_enabled | int | no | — | 0/1 |

## contacts

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| id | int | no | — | PK |
| name | string | no | — | |
| number | string | no | — | |

## timed_alarms

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| id | int64 | yes | — | PK |
| name | string | yes | — | |
| start | int | yes | — | seconds since 00:00 |
| sun/mon/tue/wed/thu/fri/sat | int | yes | — | 1 flag per weekday |

## access_events

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| id | int64 | yes | — | PK |
| event | string | yes | — | `catra`\|`secbox`\|`door` |
| type | string | yes | — | TURN_LEFT/TURN_RIGHT/GIVE_UP/OPEN/CLOSE |
| identification | string | yes | — | secbox/door id or event uuid |
| device_id | int64 | yes | — | FK `devices.id` |
| timestamp | int | yes | — | Unix timestamp |

## custom_thresholds

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| id | int | no | — | PK |
| user_id | int | yes | — | FK `users.id` |
| threshold | int | yes | — | |

## network_interlocking_rules

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| id | int | no | — | PK |
| ip | string | yes | — | remote device (device B) IP |
| login | string | yes | — | remote device login |
| password | string | yes | — | remote device password |
| portal_name | string | yes | — | rule name |
| enabled | int | yes | — | 1/0 |

**Ambiguity flagged**: no field here references `areas` or `alarm_zones` —
this object configures a remote-device (device-to-device) interlock over
network credentials, not an association with any other Route Gap table.
**Action taken**: [ticket #76](https://github.com/victor-lis-bronzo/controlid-facial-emulator/issues/76)'s
dependency on `areas` (#52) and `alarm_zones` (#49) was not justified by the
real schema and has been removed — see correction note below.

## Corrections applied to the ticket map after this research

Two blocking edges set up before this research turned out to be wrong once
the real field shapes were known, and were corrected directly on the
tickets:

- **#74 (`contingency_card_access_rules`)**: removed the dependency on **#54**
  (`contingency_cards`) — the object has no FK to that table.
- **#76 (`network_interlocking_rules`)**: removed the dependency on **#52**
  (`areas`) and **#49** (`alarm_zones`) — the object has no FK to either.

Both tickets are now blocked only by this research ticket (**#42**) and can
join the frontier as soon as it closes.
