# Spec: WebGUI Time Zones Section

## Problem Statement

Administrators using the WebGUI today can manage Users and Groups, but have
no way to define Time Zones — the device-native scheduling mechanism (a name
plus one or more weekly intervals) that Access Rules, Alarm Zones, and other
device objects already reference via `access_rule_time_zones` and
`alarm_zone_time_zones`. The "Horários" nav item already exists in
WebGuiLayout but is a disabled placeholder, so there is no `.fcgi`-faithful
equivalent to the (now-removed) admin panel's Time Zones screen.

## Solution

Add a new WebGUI section, Time Zones, reachable at `/admin/time-zones`,
backed exclusively by `.fcgi` object endpoints. It lets administrators
create, rename, and delete time zones, and manage each time zone's weekly
intervals via the `time_spans` object already implemented as a Route Gap
(spec #41, PR #53). The `time_zones` object itself is added to the `.fcgi`
ObjectStore for the first time, reusing the existing `timeZones` table
(currently only backing the orphaned `/api/admin/time-zones*` REST surface),
mirroring the fidelity constraint already enforced for Users and Groups.

## User Stories

1. As an administrator, I want to see "Horários" enabled in the WebGUI
   navigation, so that I can reach the new section instead of a placeholder.
2. As an administrator, I want to see a list of all existing time zones when
   I open `/admin/time-zones`, so that I know what's already configured.
3. As an administrator, I want an explicit empty state when no time zones
   exist yet, so that I understand the list isn't broken.
4. As an administrator, I want to see how many intervals each time zone has
   in the list, so that I get a sense of its configuration at a glance.
5. As an administrator, I want to create a new time zone by providing just a
   name, so that I can start scheduling quickly.
6. As an administrator, I want time zone creation to call
   `POST create_objects.fcgi?object=time_zones`, so that the WebGUI stays
   faithful to the device's `.fcgi` protocol.
7. As an administrator, I want to edit an existing time zone's name, so that
   I can correct typos or rename it as its purpose evolves.
8. As an administrator, I want time zone edits to be submitted via
   `POST modify_objects.fcgi?object=time_zones`, consistent with creation.
9. As an administrator, I want to delete a time zone I no longer need, so
   that the list stays relevant.
10. As an administrator, I want time zone deletion to be submitted via
    `POST destroy_objects.fcgi?object=time_zones`, consistent with the rest
    of the WebGUI.
11. As an administrator, I want deleting a time zone that's still referenced
    by an Access Rule or Alarm Zone to succeed without a blocking error,
    matching the emulator's current fidelity stance (no `.fcgi` object has a
    referential guard today); I understand this may leave a dangling
    reference until an Access Rules/Alarm Zones screen exists to manage it.
12. As an administrator, I want deleting a time zone to leave its intervals
    (`time_spans` rows) in place rather than erroring, since `time_spans`
    has no enforced foreign key back to `time_zones` today; I understand
    this may leave orphaned interval rows, matching the same no-guard
    fidelity stance.
13. As an administrator, I want to open a time zone's edit view and see the
    list of its weekly intervals, so that I can review its schedule.
14. As an administrator, I want to add a new interval to a time zone by
    picking which days of the week it applies to and a start/end time
    (`HH:MM`), so that I can build up a weekly schedule without knowing the
    device's internal seconds-since-midnight representation.
15. As an administrator, I want to remove an existing interval from a time
    zone, so that I can correct or simplify its schedule.
16. As an administrator, I want interval changes to be a single Save action
    from my perspective, even though they're implemented as one
    `create_objects.fcgi`/`destroy_objects.fcgi` call per added/removed
    interval against `object=time_spans`, so the UI doesn't feel more
    complicated than the device's own admin experience.
17. As an administrator, I want a clear error if the time zone name is left
    blank, so that I don't accidentally submit an unnamed time zone
    (client-side only, since `.fcgi` performs no server-side validation
    here, matching Users/Groups).
18. As an administrator, I want a clear error if I try to save an interval
    with no day selected or with an end time not after the start time, so
    that I don't submit a schedule that can never match (client-side only).
19. As an administrator, I want an error message if a `.fcgi` call fails
    (network error, 401, 500), so I know the action didn't complete.
20. As a developer maintaining the emulator, I want `time_zones` added as a
    first-class `.fcgi` object (`id`/`name`), so Time Zones is reachable
    without any `/api/admin/*` dependency, keeping the WebGUI's fidelity
    invariant intact.
21. As a QA/reviewer, I want the Time Zones section tested with the same
    fetch-mocking seam as Groups (`timeZones.test.tsx`), so behavior is
    verified without hitting a real server.

## Implementation Decisions

**Backend Protocol Additions (`.fcgi`)**
- Add `time_zones` to `ObjectStore.OBJECT_REGISTRY`: columns `id`
  (autoincrement PK) and `name` (text, required), reusing the existing
  `timeZones` Drizzle table verbatim — mirroring exactly how `groups` was
  added on top of its existing table. No new REST routes; the existing
  `/api/admin/time-zones*` REST surface (backed by `timeZones`/`timeRanges`
  and `time-zone-repository.ts`) is left untouched, deliberately out of
  scope, exactly as `/api/admin/groups*` was left orphaned by the Groups
  spec.
- No additional server-side validation for `time_zones.name` (no length
  cap, no uniqueness check) — matches current `.fcgi` behavior for
  `users`/`groups`. The WebGUI enforces "non-empty" client-side only.
- `destroy_objects.fcgi?object=time_zones` performs a plain delete with no
  referential-integrity guard (no `409`), consistent with every other
  `.fcgi` object today. No cascade exists for `time_spans` rows referencing
  a deleted `time_zones` row (`timeSpans.timeZoneId` is a plain text
  column, not a Drizzle foreign key) — deleting a time zone silently
  orphans its intervals; no new application-level cleanup is added, mirroring
  the no-referential-guard stance already accepted for Groups.
- Intervals reuse the `time_spans` object exactly as already registered by
  spec #41/PR #53 — no schema or registry change needed for it. Its wire
  fields are `id`, `time_zone_id`, `start`, `end` (numeric strings, seconds
  since 00:00), and `sun`/`mon`/`tue`/`wed`/`thu`/`fri`/`sat`/`hol1`/`hol2`/
  `hol3` (each `'1'`/`'0'`), all required by the registry.

**Navigation Architecture (WebGuiLayout)**
- Flip the `Horários` entry in `NAV_MODULES`
  (`web/src/components/WebGuiLayout.tsx`) to
  `{ name: 'Horários', path: '/admin/time-zones', enabled: true }`.
- Add a `<Route path="time-zones" element={<TimeZonesPage />} />` under the
  existing `ProtectedRoute`-guarded route tree in `AppRouter.tsx`, next to
  `users`/`groups`.

**Frontend: `web/src/pages/TimeZonesPage.tsx`**
- Structure mirrors `GroupsPage.tsx`: a hand-rolled `<table>` listing time
  zones (name, interval count, actions), a "New time zone" button opening a
  create modal (name field only), row-level Edit and Delete actions each
  opening their own conditionally-rendered modal (not CSS-hidden), matching
  the Groups/Users precedent.
- The Edit modal has the name field plus the time zone's list of intervals
  (loaded via `load_objects.fcgi?object=time_spans&where.time_zone_id=<id>`),
  each rendered as a row with seven day checkboxes (Sun–Sat) and two
  `HH:MM` inputs (start/end). An "Add interval" control appends a new,
  unsaved interval row to the list; each existing row has a "Remove"
  action. `hol1`/`hol2`/`hol3` have no dedicated UI in this section and are
  always submitted as `'0'` on interval creation, since the `time_spans`
  registry requires them.
- On Save: update the time zone's name via `modify_objects.fcgi?object=
  time_zones` if changed, then diff the current interval rows against the
  loaded ones and issue one `create_objects.fcgi?object=time_spans` per
  newly-added interval and one `destroy_objects.fcgi?object=time_spans` per
  removed interval. Existing intervals are not modified in place (an edited
  row is treated as remove-old + add-new), keeping the diff logic identical
  in shape to Groups' membership diff.
- `HH:MM` fields are converted to/from seconds-since-midnight strings only
  at the form boundary (on submit: `HH:MM` → seconds string; on load:
  seconds string → `HH:MM`) — the wire payload itself always uses the
  seconds-since-midnight convention already established by `time_spans`'
  existing tests, never raw `HH:MM`.
- No pagination for the time zone list or the interval list — matches the
  codebase-wide absence of pagination; revisit only if real-world list
  sizes make this unusable.
- Uses the existing `useFcgi()` hook unchanged for every request (session
  injection, 401 handling, error-body parsing already generic).
- Styling matches the existing Tailwind/dark-slate vocabulary used by
  `GroupsPage`/`UsersPage`/`WebGuiLayout` — no new design system
  introduced.

**Client Interaction & Authentication Invariance**
- Every mutation goes through the official `.fcgi` object endpoints with
  `?session=<token>` — no `/api/admin/*` calls anywhere in this section,
  preserving the invariant established by the Users/Groups specs.

## Testing Decisions

**Testing Principles**: test external behavior (rendered DOM state and
outgoing `.fcgi` requests), not internal component structure — same
principle as `groups.test.tsx`.

**Frontend Seam** (`web/src/timeZones.test.tsx`): Vitest + React Testing
Library + `@testing-library/user-event`, mocking `globalThis.fetch` by
branching on the URL (`load_objects.fcgi`, `create_objects.fcgi`,
`modify_objects.fcgi`, `destroy_objects.fcgi`, each with `object=time_zones`
or `object=time_spans`), asserting both DOM state and exact outgoing
request bodies (including the `HH:MM` ↔ seconds-since-midnight conversion
at the boundary). Session seeded via `localStorage`, rendered inside
`<AuthProvider><MemoryRouter>`, exactly as `groups.test.tsx` already does.

**Backend Seam**: extend the existing Fastify HTTP integration suite
(`api/src/routes/fcgi/fcgi.integration.test.ts`) with the new `time_zones`
object's create/load/modify/destroy round-trip, mirroring the coverage
already given to `groups`/`users`. No new test coverage is needed for
`time_spans` itself (already covered by spec #41/PR #53); a single
integration test confirming a `time_zones` delete leaves an existing
`time_spans` row in place (no cascade, no error) is added to document the
orphaning behavior from Implementation Decisions.

**Prior art**: `web/src/groups.test.tsx` (frontend seam), the existing
`.fcgi` object-route integration suite under `api/src/routes/fcgi/`
(backend seam), and `api/src/repositories/object-store.test.ts` (unit-level
CRUD/edge-case precedent for a new registry entry).

## Out of Scope

- Any `/api/admin/time-zones*` REST route changes — left exactly as-is
  (unused by the WebGUI, not deleted).
- `hol1`/`hol2`/`hol3` (holiday-group flags) UI — no dedicated controls;
  always sent as `'0'` on interval creation. A holiday-groups concept, if
  ever needed, belongs to a future spec.
- Referential-integrity guard preventing deletion of a time zone referenced
  by an Access Rule/Alarm Zone, or cleanup of its orphaned `time_spans`
  rows — left as a silent/orphaning delete; revisit only if a future spec
  decides otherwise end-to-end.
- Associating Time Zones with Access Rules, Alarm Zones, or Portals from
  this section — those associations (`access_rule_time_zones`,
  `alarm_zone_time_zones`, `portal_access_rules`) are already implemented
  at the `.fcgi` level and belong to their own future WebGUI specs (Access
  Rules, Alarm Zones), not this one.
- Pagination for the time zone list or the interval list.
- Implementation itself (opening build issues, writing code) — happens
  after this spec is reviewed/approved, same as Groups.

## Further Notes

- Assumes `time_zones` field shape exactly as it exists in
  `api/src/db/schema.ts` today (`timeZones`: `id`, `name`) — no schema
  migration needed beyond registering `time_zones` in `ObjectStore`.
  `time_spans` also needs no schema change; it is reused exactly as
  implemented by spec #41/PR #53.
- Decisions behind this spec were settled via grilling on wayfinder ticket
  "Spec da seção Time Zones na WebGUI" (#80), child of the WebGUI specs map
  (#77), blocked by #78 (Admin Management Panel removal, closed) and
  blocking #82 (Access Rules).
