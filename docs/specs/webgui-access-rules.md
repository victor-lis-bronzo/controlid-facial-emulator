# Spec: WebGUI Access Rules Section

## Problem Statement

Administrators using the WebGUI today can manage Users, Groups, Time
Zones, and Portals, but have no way to tie them together into an Access
Rule — the device-native entity that decides who can go through which
portal and when. "Regras de Acesso" still shows as a disabled placeholder
in WebGuiLayout, so there is no `.fcgi`-faithful equivalent to the
(now-removed) admin panel's Access Rules screen, even though the three
association objects it needs (`group_access_rules`, `access_rule_time_zones`,
`portal_access_rules`) have been reachable via `.fcgi` since the Route Gap
work (spec #41).

## Solution

Add a new WebGUI section, Access Rules, reachable at `/admin/access-rules`,
backed exclusively by `.fcgi` object endpoints, split into the same two
phases already used for Time Zones: first a plain name-only CRUD screen for
the `access_rules` object itself (added to the `.fcgi` ObjectStore for the
first time, reusing the existing `access_rules` table), then association
management for the rule's Groups, Time Zones, and Portals, each represented
as its own checklist inside the edit modal, diffed and synced against the
already-implemented `group_access_rules`/`access_rule_time_zones`/
`portal_access_rules` objects on Save.

## User Stories

1. As an administrator, I want to see "Regras de Acesso" enabled in the
   WebGUI navigation, so that I can reach the new section instead of a
   placeholder.
2. As an administrator, I want to see a list of all existing access rules
   when I open `/admin/access-rules`, so that I know what's already
   configured.
3. As an administrator, I want an explicit empty state when no access
   rules exist yet, so that I understand the list isn't broken.
4. As an administrator, I want to create a new access rule by providing
   just a name, so that I can start configuring it quickly (associations
   are added afterward, via Edit).
5. As an administrator, I want access rule creation to call
   `POST create_objects.fcgi?object=access_rules`, so that the WebGUI stays
   faithful to the device's `.fcgi` protocol.
6. As an administrator, I want to edit an existing access rule's name, so
   that I can correct typos or rename it as its purpose evolves.
7. As an administrator, I want access rule edits to be submitted via
   `POST modify_objects.fcgi?object=access_rules`, consistent with
   creation.
8. As an administrator, I want to delete an access rule I no longer need,
   so that the list stays relevant.
9. As an administrator, I want access rule deletion to be submitted via
   `POST destroy_objects.fcgi?object=access_rules`, consistent with the
   rest of the WebGUI.
10. As an administrator, I want deleting an access rule to also remove its
    group/time-zone/portal associations automatically, so that I don't
    have to clean up the three join objects by hand (relies on the
    existing `ON DELETE CASCADE` foreign keys from each join table's
    `access_rule_id` back to `access_rules.id`).
11. As an administrator, I want a clear error if the access rule name is
    left blank, so that I don't accidentally submit an unnamed rule
    (client-side only, since `.fcgi` performs no server-side validation
    here, matching every prior section).
12. As an administrator, I want to open an access rule's edit view and see
    three checklists — Groups, Time Zones, and Portals — each listing every
    existing entity of that kind with the rule's current associations
    pre-checked, so I can see its full configuration at a glance.
13. As an administrator, I want to check or uncheck entries in any of the
    three checklists and save, so that the WebGUI computes the difference
    per checklist and issues the minimal set of `create_objects.fcgi`/
    `destroy_objects.fcgi` calls against `group_access_rules`/
    `access_rule_time_zones`/`portal_access_rules` to reach the new
    configuration.
14. As an administrator, I want association changes across all three
    checklists to be a single Save action from my perspective, even though
    they're implemented as several `.fcgi` calls under the hood, so the UI
    doesn't feel more complicated than the device's own admin experience.
15. As an administrator, I want a clear client-side error if I try to save
    an access rule with zero groups, zero time zones, or zero portals
    checked, so that I don't end up with a rule that can never match
    anything — mirroring the intent of the old admin panel's
    `AccessRuleService` validation, now enforced entirely in the WebGUI
    since `.fcgi` itself has no such guard.
16. As an administrator, I want an error message if a `.fcgi` call fails
    (network error, 401, 500), so I know the action didn't complete.
17. As a developer maintaining the emulator, I want `access_rules` added as
    a first-class `.fcgi` object (`id`/`name`), so Access Rules is
    reachable without any `/api/admin/*` dependency, keeping the WebGUI's
    fidelity invariant intact.
18. As a QA/reviewer, I want the Access Rules section tested with the same
    fetch-mocking seam as Groups/Time Zones/Portals (`accessRules.test.tsx`),
    so behavior is verified without hitting a real server.
19. As a QA/reviewer, I want a backend integration test proving that
    deleting an `access_rules` row cascades all three of its association
    rows, so the no-orphan guarantee this section depends on is verified,
    not assumed.

## Implementation Decisions

**Backend Protocol Additions (`.fcgi`)**
- Add `access_rules` to `ObjectStore.OBJECT_REGISTRY`: columns `id`
  (autoincrement PK) and `name` (text, required), reusing the existing
  `accessRules` Drizzle table verbatim — mirroring exactly how `groups`,
  `time_zones`, and `portals` were added on top of their existing tables.
  No new REST routes; the existing `/api/admin/access-rules*` REST surface
  (backed by the same `accessRules` table, `access-rule-repository.ts`, and
  `AccessRuleService`) is left untouched, deliberately out of scope,
  exactly as the three prior specs left their equivalent REST surfaces
  orphaned.
- No additional server-side validation for `access_rules.name`, and no
  replication of `AccessRuleService`'s non-empty-set/existence checks at
  the `.fcgi` level — matches current `.fcgi` behavior for every other
  object (no guard beyond what SQLite's schema itself enforces). The
  "each association set must be non-empty" rule is reimplemented as a
  WebGUI-only client-side check (see Frontend, below); it never touches the
  wire protocol, so a third-party integrator talking `.fcgi` directly can
  still create an access rule with empty association sets, same as today.
- `destroy_objects.fcgi?object=access_rules` performs a plain delete with
  no referential-integrity guard beyond what the schema already enforces.
  Deleting an `access_rules` row cascades its `group_access_rules`/
  `access_rule_time_zones`/`portal_access_rules` rows automatically via the
  existing `ON DELETE CASCADE` foreign keys already declared on each join
  table's `access_rule_id` column — no new application code needed for
  that cascade (this is the same "free cascade" pattern already relied on
  for Groups → `user_groups`).

**Navigation Architecture (WebGuiLayout)**
- Flip the `Regras de Acesso` entry in `NAV_MODULES`
  (`web/src/components/WebGuiLayout.tsx`) to
  `{ name: 'Regras de Acesso', path: '/admin/access-rules', enabled: true }`,
  keeping its current position in the list.
- Add a `<Route path="access-rules" element={<AccessRulesPage />} />` under
  the existing `ProtectedRoute`-guarded route tree in `AppRouter.tsx`, next
  to `users`/`groups`/`time-zones`/`portals`.

**Frontend: `web/src/pages/AccessRulesPage.tsx`**
- Structure mirrors `GroupsPage.tsx`/`TimeZonesPage.tsx`/`PortalsPage.tsx`:
  a hand-rolled `<table>` listing access rules (name, actions), a "New
  access rule" button opening a create modal (name field only), row-level
  Edit and Delete actions each opening their own conditionally-rendered
  modal — no association editing in the create flow, matching the
  Time Zones precedent of a plain name-only create step.
- The Edit modal has the name field plus three independent checklist
  sections — Groups, Time Zones, Portals — each loaded via its own
  `load_objects.fcgi?object=groups|time_zones|portals` call for the full
  list, cross-referenced against the rule's current associations (loaded
  via `load_objects.fcgi?object=group_access_rules|access_rule_time_zones|
  portal_access_rules&where.access_rule_id=<id>`), with matching entries
  pre-checked. Each checklist behaves exactly like Groups' membership
  checklist, just repeated three times side by side (or stacked) in the
  same modal.
- On Save: update the name via `modify_objects.fcgi?object=access_rules`
  if changed, then independently diff each of the three checklists against
  its loaded associations and issue one `create_objects.fcgi`/
  `destroy_objects.fcgi` per newly-checked/newly-unchecked entry, against
  `group_access_rules`, `access_rule_time_zones`, and `portal_access_rules`
  respectively — three independent diffs, not one combined one.
- Client-side validation before Save: access rule name must not be empty;
  each of the three checklists must have at least one entry checked
  (mirrors the intent of the old `AccessRuleService.requireNonEmpty`
  check, reimplemented purely in the frontend — see Implementation
  Decisions above for why this doesn't touch `.fcgi` itself).
- No pagination for the access rule list or any of the three checklists —
  matches the codebase-wide absence of pagination; revisit only if
  real-world list sizes make this unusable.
- Uses the existing `useFcgi()` hook unchanged for every request (session
  injection, 401 handling, error-body parsing already generic).
- Styling matches the existing Tailwind/dark-slate vocabulary used by the
  three prior sections — no new design system introduced.

**Client Interaction & Authentication Invariance**
- Every mutation goes through the official `.fcgi` object endpoints with
  `?session=<token>` — no `/api/admin/*` calls anywhere in this section,
  preserving the invariant established by every prior WebGUI spec.

## Testing Decisions

**Testing Principles**: test external behavior (rendered DOM state and
outgoing `.fcgi` requests), not internal component structure — same
principle as `groups.test.tsx`/`timeZones.test.tsx`/`portals.test.tsx`.

**Frontend Seam** (`web/src/accessRules.test.tsx`): Vitest + React Testing
Library + `@testing-library/user-event`, mocking `globalThis.fetch` by
branching on the URL (`load_objects.fcgi`, `create_objects.fcgi`,
`modify_objects.fcgi`, `destroy_objects.fcgi`, for `object=access_rules`
and each of the three join objects), asserting both DOM state and exact
outgoing request bodies, including the client-side "each checklist needs
≥1 entry" validation. Session seeded via `localStorage`, rendered inside
`<AuthProvider><MemoryRouter>`, exactly as the prior pages' tests already
do.

**Backend Seam**: extend the existing Fastify HTTP integration suite
(`api/src/routes/fcgi/fcgi.integration.test.ts`) with the `access_rules`
object's create/load/modify/destroy round-trip, mirroring the coverage
already given to `groups`/`time_zones`/`portals`, plus a dedicated case:
create an access rule, associate it to a group/time zone/portal via the
three join objects, `destroy_objects.fcgi?object=access_rules` it, and
assert all three join rows are gone afterward (the cascade this section
depends on). Add a corresponding unit case in
`api/src/repositories/object-store.test.ts` for the new `access_rules`
registry entry, mirroring the existing per-object CRUD/edge-case tests.

**Prior art**: `web/src/groups.test.tsx`/`web/src/timeZones.test.tsx`/
`web/src/portals.test.tsx` (frontend seam), the existing `.fcgi`
object-route integration suite under `api/src/routes/fcgi/` (backend
seam), and the Groups cascade-delete integration test (precedent for the
three-way cascade test here).

## Out of Scope

- Any `/api/admin/access-rules*` REST route changes, or replicating
  `AccessRuleService`'s existence-check (Req 7.2) validation at the
  `.fcgi` level — left exactly as-is (unused by the WebGUI, not deleted).
- Any UI representation of Access Logs (`access_logs`) or how an access
  rule's evaluation actually plays out against incoming events — this
  section only manages the rule's static configuration.
- Alarm Zones or `alarm_zone_time_zones`/`network_interlocking_rules` —
  unrelated join objects, no future spec currently references them from
  this one.
- Pagination for the access rule list or any of the three checklists.
- Implementation itself (opening build issues, writing code) — happens
  after this spec is reviewed/approved, same as every prior section.

## Further Notes

- Assumes `access_rules` field shape exactly as it exists in
  `api/src/db/schema.ts` today (`accessRules`: `id`, `name`) — no schema
  migration needed beyond registering `access_rules` in `ObjectStore`.
  `group_access_rules`/`access_rule_time_zones`/`portal_access_rules` also
  need no schema change; they are reused exactly as implemented by spec
  #41.
- This spec was the last of the four blockers listed on wayfinder ticket
  "Spec da seção Access Rules na WebGUI" (#82), child of the WebGUI specs
  map (#77) — Groups (#79), Time Zones (#80), and Portals (#81) are all
  closed, and #82 itself had no other WebGUI-section blockers left when
  this grilling started.
- Decisions behind this spec were settled via grilling on ticket #82
  (Q1–Q6): two-phase build (CRUD screen, then association management,
  mirroring Time Zones), client-side-only non-empty-set validation, and
  reliance on the existing `CASCADE` foreign keys for delete cleanup
  rather than new application code.
