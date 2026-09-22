# Spec: WebGUI Portals Section

## Problem Statement

Administrators using the WebGUI today can manage Users, Groups, and Time
Zones, but have no way to register the physical doors/portals a Control-iD
reader controls. There isn't even a disabled placeholder for Portals in
WebGuiLayout today, so there is no `.fcgi`-faithful path to reach or manage
`portals` — the entity that `access_rule_portals` (already implemented at
the `.fcgi` level) and the future Access Rules section will need to
reference.

## Solution

Add a new WebGUI section, Portals, reachable at `/admin/portals`, backed
exclusively by `.fcgi` object endpoints. It lets administrators create,
rename, and delete portals. The `portals` object itself is added to the
`.fcgi` ObjectStore for the first time, reusing the existing `portals`
table (currently only backing the orphaned `/api/admin/portals*` REST
surface), mirroring the fidelity constraint already enforced for Users,
Groups, and Time Zones. Unlike those, deleting a `portals` row already hits
a real database-level `RESTRICT` foreign key when the portal is still
referenced by `access_rule_portals` — this spec also extends
`ObjectStore`'s existing SQLite-constraint-to-`400` translation (today only
applied to `create`) to `destroy`, so that restriction surfaces as a
friendly `400` instead of an unhandled `500`, for `portals` and for any
other object with a `RESTRICT` foreign key.

## User Stories

1. As an administrator, I want to see "Portais" in the WebGUI navigation,
   so that I can reach the new section (today there isn't even a disabled
   placeholder for it).
2. As an administrator, I want to see a list of all existing portals when I
   open `/admin/portals`, so that I know what's already configured.
3. As an administrator, I want an explicit empty state when no portals
   exist yet, so that I understand the list isn't broken.
4. As an administrator, I want to create a new portal by providing just a
   name, so that I can register a door quickly.
5. As an administrator, I want portal creation to call
   `POST create_objects.fcgi?object=portals`, so that the WebGUI stays
   faithful to the device's `.fcgi` protocol.
6. As an administrator, I want to edit an existing portal's name, so that I
   can correct typos or rename it as its purpose evolves.
7. As an administrator, I want portal edits to be submitted via
   `POST modify_objects.fcgi?object=portals`, consistent with creation.
8. As an administrator, I want to delete a portal I no longer need, so that
   the list stays relevant.
9. As an administrator, I want portal deletion to be submitted via
   `POST destroy_objects.fcgi?object=portals`, consistent with the rest of
   the WebGUI.
10. As an administrator, I want a clear, friendly error if I try to delete
    a portal that's still referenced by an Access Rule (`portal_access_rules`),
    instead of a generic server error, so that I understand why the delete
    didn't go through.
11. As an administrator, I want a clear error if the portal name is left
    blank, so that I don't accidentally submit an unnamed portal
    (client-side only, since `.fcgi` performs no server-side validation
    here, matching Users/Groups/Time Zones).
12. As an administrator, I want an error message if a `.fcgi` call fails
    (network error, 401, 500), so I know the action didn't complete.
13. As a developer maintaining the emulator, I want `portals` added as a
    first-class `.fcgi` object (`id`/`name`), so Portals is reachable
    without any `/api/admin/*` dependency, keeping the WebGUI's fidelity
    invariant intact.
14. As a developer maintaining the emulator, I want `ObjectStore.destroy`'s
    SQLite-constraint handling to match `ObjectStore.create`'s, so that any
    object with a `RESTRICT` foreign key (today just `portals`, referenced
    by `access_rule_portals`) fails deletion with a `400` naming the
    conflict, not an unhandled `500`.
15. As a QA/reviewer, I want the Portals section tested with the same
    fetch-mocking seam as Groups/Time Zones (`portals.test.tsx`), so
    behavior is verified without hitting a real server.
16. As a QA/reviewer, I want a backend integration test proving that
    deleting a portal referenced by `portal_access_rules` returns `400`,
    not `500`, and that the portal is left intact when that happens.

## Implementation Decisions

**Backend Protocol Additions (`.fcgi`)**
- Add `portals` to `ObjectStore.OBJECT_REGISTRY`: columns `id`
  (autoincrement PK) and `name` (text, required), reusing the existing
  `portals` Drizzle table verbatim — mirroring exactly how `groups` and
  `time_zones` were added on top of their existing tables. No new REST
  routes; the existing `/api/admin/portals*` REST surface (backed by the
  same `portals` table and `portal-repository.ts`) is left untouched,
  deliberately out of scope, exactly as the Groups and Time Zones specs
  left their equivalent REST surfaces orphaned.
- No additional server-side validation for `portals.name` (no length cap,
  no uniqueness check) — matches current `.fcgi` behavior for
  `users`/`groups`/`time_zones`. The WebGUI enforces "non-empty" client-side
  only.
- `ObjectStore.destroy` gains the same SQLite-constraint-to-`ValidationError`
  translation `ObjectStore.create` already has (catching the driver's
  `SQLITE_CONSTRAINT*` error code and raising a `400` naming the object
  instead of letting the raw exception surface as a `500`). This is a
  generic change to `destroy`, not a `portals`-specific special case, so any
  future object with a `RESTRICT` foreign key gets the same behavior for
  free — the same generalization rationale used when `create`'s duplicate
  handling was added for the Groups spec (`user_groups`).
  `destroy_objects.fcgi?object=portals` therefore returns `400` (naming the
  portal) when the portal is still referenced by an `access_rule_portals`
  row, instead of the unhandled `500` that would occur today. This is the
  one object in the current schema where deletion isn't a plain no-guard
  delete — `accessRulePortals.portalId` already carries a real `ON DELETE
  RESTRICT` foreign key, unlike the no-guard stance taken for
  `groups`/`time_zones`/`user_groups`/`time_spans`.

**Navigation Architecture (WebGuiLayout)**
- Add a new `Portais` entry to `NAV_MODULES`
  (`web/src/components/WebGuiLayout.tsx`), placed after `Horários`:
  `{ name: 'Portais', path: '/admin/portals', enabled: true }`. Unlike
  Groups/Time Zones, there is no pre-existing disabled placeholder to flip
  — this is a brand-new entry.
- Add a `<Route path="portals" element={<PortalsPage />} />` under the
  existing `ProtectedRoute`-guarded route tree in `AppRouter.tsx`, next to
  `users`/`groups`/`time-zones`.

**Frontend: `web/src/pages/PortalsPage.tsx`**
- Structure mirrors `GroupsPage.tsx`/`TimeZonesPage.tsx`: a hand-rolled
  `<table>` listing portals (name, actions), a "New portal" button opening
  a create modal (name field only), row-level Edit and Delete actions each
  opening their own conditionally-rendered modal (not CSS-hidden), matching
  the established precedent. No membership/child-object management inside
  this page (see Out of Scope) — it is plain name-only CRUD, the simplest
  of the sections built so far.
- On a `400` from `destroy_objects.fcgi?object=portals` (the
  still-referenced-by-an-access-rule case), the delete confirmation modal
  shows the returned error message rather than silently closing, so the
  administrator understands why the portal wasn't removed.
- Uses the existing `useFcgi()` hook unchanged for every request (session
  injection, 401 handling, error-body parsing already generic).
- Styling matches the existing Tailwind/dark-slate vocabulary used by
  `GroupsPage`/`TimeZonesPage`/`WebGuiLayout` — no new design system
  introduced.

**Client Interaction & Authentication Invariance**
- Every mutation goes through the official `.fcgi` object endpoints with
  `?session=<token>` — no `/api/admin/*` calls anywhere in this section,
  preserving the invariant established by the Users/Groups/Time Zones
  specs.

## Testing Decisions

**Testing Principles**: test external behavior (rendered DOM state and
outgoing `.fcgi` requests), not internal component structure — same
principle as `groups.test.tsx`/`timeZones.test.tsx`.

**Frontend Seam** (`web/src/portals.test.tsx`): Vitest + React Testing
Library + `@testing-library/user-event`, mocking `globalThis.fetch` by
branching on the URL (`load_objects.fcgi`, `create_objects.fcgi`,
`modify_objects.fcgi`, `destroy_objects.fcgi`, `object=portals`), asserting
both DOM state and exact outgoing request bodies, including the case where
`destroy_objects.fcgi` returns `400` and the error is surfaced in the UI.
Session seeded via `localStorage`, rendered inside
`<AuthProvider><MemoryRouter>`, exactly as the prior pages' tests already
do.

**Backend Seam**: extend the existing Fastify HTTP integration suite
(`api/src/routes/fcgi/fcgi.integration.test.ts`) with the `portals`
object's create/load/modify/destroy round-trip, mirroring the coverage
already given to `groups`/`time_zones`, plus a dedicated case: create a
portal, associate it to an access rule via `portal_access_rules`, attempt
`destroy_objects.fcgi?object=portals`, and assert a `400` response (naming
the portal) with the portal row still present afterward. Add a
corresponding unit case in `api/src/repositories/object-store.test.ts`
covering `ObjectStore.destroy`'s new constraint-to-`ValidationError`
translation directly (mirroring the existing `create` duplicate-handling
unit test), since this is a generic `ObjectStore` behavior change, not
Portals-specific.

**Prior art**: `web/src/groups.test.tsx`/`web/src/timeZones.test.tsx`
(frontend seam), the existing `.fcgi` object-route integration suite under
`api/src/routes/fcgi/` (backend seam), and the existing `create`
duplicate-handling test in `api/src/repositories/object-store.test.ts`
(precedent for the `destroy` constraint-handling unit test).

## Out of Scope

- Any `/api/admin/portals*` REST route changes — left exactly as-is (unused
  by the WebGUI, not deleted).
- Managing `portal_actions` (portal ↔ action associations) — belongs to a
  future Actions section, which doesn't exist yet in the WebGUI.
- Managing `portal_access_rules` (portal ↔ access rule associations) —
  belongs to the Access Rules spec (#82), which is the natural place to
  decide how that relationship is surfaced, now that it's unblocked.
- Any UI representation of `access_rule_portals`' `RESTRICT` delete beyond
  surfacing the `400` message returned by `.fcgi` — no "show me which
  access rules reference this portal" affordance in this section.
- Pagination for the portal list.
- Implementation itself (opening build issues, writing code) — happens
  after this spec is reviewed/approved, same as Groups/Time Zones.

## Further Notes

- Assumes `portals` field shape exactly as it exists in
  `api/src/db/schema.ts` today (`portals`: `id`, `name`) — no schema
  migration needed beyond registering `portals` in `ObjectStore`.
- The `ObjectStore.destroy` constraint-handling change is intentionally
  generic (not gated on `object === 'portals'`), so it also protects any
  future Route Gap object that gains a `RESTRICT` foreign key, without
  further code changes.
- Decisions behind this spec were settled via grilling on wayfinder ticket
  "Spec da seção Portals na WebGUI" (#81), child of the WebGUI specs map
  (#77), blocked by #78 (Admin Management Panel removal, closed) and
  blocking #82 (Access Rules).
