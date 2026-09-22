# Spec: WebGUI Groups Section

## Problem Statement

Administrators using the WebGUI today can manage Users, but have no way to
organize them into Groups — the device-native mechanism for composing
membership before it's referenced by Access Rules and Time Zones. The
"Grupos" nav item already exists in WebGuiLayout but is a disabled
placeholder, so there is no `.fcgi`-faithful equivalent to the (now-removed)
admin panel's Groups screen.

## Solution

Add a new WebGUI section, Groups, reachable at `/admin/groups`, backed
exclusively by `.fcgi` object endpoints. It lets administrators create,
rename, and delete groups, and manage which users belong to each group via
the `user_groups` join object. The `groups` object itself is added to the
`.fcgi` ObjectStore for the first time, mirroring the fields used by the
now-orphaned REST admin API but exposed only through the compatibility
surface, matching the fidelity constraint already enforced for Users.

## User Stories

1. As an administrator, I want to see "Grupos" enabled in the WebGUI
   navigation, so that I can reach the new section instead of a placeholder.
2. As an administrator, I want to see a list of all existing groups when I
   open `/admin/groups`, so that I know what's already configured.
3. As an administrator, I want an explicit empty state when no groups exist
   yet, so that I understand the list isn't broken.
4. As an administrator, I want to create a new group by providing just a
   name, so that I can start organizing users quickly.
5. As an administrator, I want group creation to call
   `POST create_objects.fcgi?object=groups`, so that the WebGUI stays
   faithful to the device's `.fcgi` protocol.
6. As an administrator, I want to edit an existing group's name, so that I
   can correct typos or rename it as its purpose evolves.
7. As an administrator, I want group edits to be submitted via
   `POST modify_objects.fcgi?object=groups`, consistent with creation.
8. As an administrator, I want to delete a group I no longer need, so that
   the list stays relevant.
9. As an administrator, I want group deletion to be submitted via
   `POST destroy_objects.fcgi?object=groups`, consistent with the rest of
   the WebGUI.
10. As an administrator, I want deleting a group to also remove its
    membership rows automatically, so that I don't have to clean up
    `user_groups` by hand (relies on the existing `ON DELETE CASCADE`
    foreign key).
11. As an administrator, I want deleting a group that's still referenced by
    an Access Rule to succeed without a blocking error, matching the
    emulator's current fidelity stance (no `.fcgi` object has a referential
    guard today); I understand this may leave a dangling reference until an
    Access Rules screen exists to manage it.
12. As an administrator, I want to open a group's edit view and see a
    checklist of every user, with current members pre-checked, so that I can
    see membership at a glance.
13. As an administrator, I want to check or uncheck users in that list and
    save, so that the WebGUI computes the difference and issues the minimal
    set of `create_objects.fcgi`/`destroy_objects.fcgi` calls against
    `object=user_groups` to reach the new membership.
14. As an administrator, I want membership changes to be a single Save
    action from my perspective, even though they're implemented as several
    `.fcgi` calls under the hood, so the UI doesn't feel more complicated
    than the device's own admin experience.
15. As an administrator, I want a clear error if the group name is left
    blank, so that I don't accidentally submit an unnamed group
    (client-side only, since `.fcgi` performs no server-side validation here,
    matching Users).
16. As an administrator, I want an error message if a `.fcgi` call fails
    (network error, 401, 500), so I know the action didn't complete.
17. As an administrator, I want a duplicate membership attempt (e.g. a stale
    second tab re-adding a user already in the group) to fail with a clear
    message instead of a raw server error.
18. As a developer maintaining the emulator, I want `groups` added as a
    first-class `.fcgi` object (`id`/`name`), so Groups is reachable without
    any `/api/admin/*` dependency, keeping the WebGUI's fidelity invariant
    intact.
19. As a developer, I want `user_groups` create calls to surface a friendly
    `400` on a duplicate `(user_id, group_id)` pair instead of an unhandled
    `500`, so a race-condition duplicate doesn't crash the request.
20. As a QA/reviewer, I want the Groups section tested with the same
    fetch-mocking seam as Users (`groups.test.tsx`), so behavior is verified
    without hitting a real server.

## Implementation Decisions

**Backend Protocol Additions (`.fcgi`)**
- Add `groups` to `ObjectStore.OBJECT_REGISTRY`: columns `id` (autoincrement
  PK) and `name` (text, required), mirroring the existing `users` entry's
  field-registration shape. No new REST routes; the existing
  `/api/admin/groups*` REST surface is left untouched (still backs nothing
  today, deliberately out of scope).
- No additional server-side validation for `groups.name` (no length cap, no
  uniqueness check) — matches current `.fcgi` behavior for `users`. The
  WebGUI enforces "non-empty" client-side only.
- `destroy_objects.fcgi?object=groups` performs a plain delete with no
  referential-integrity guard (no `409`), consistent with every other
  `.fcgi` object today. `user_groups` rows for the deleted group are removed
  automatically via the existing `ON DELETE CASCADE` foreign key on
  `usersGroups.group_id` — no new application code needed for that cascade.
- `user_groups` gains duplicate-insert handling: `ObjectStore.create` catches
  the SQLite constraint violation on `(user_id, group_id)` and raises a
  `ValidationError` (`400`, naming the duplicate pair) instead of letting the
  raw driver exception surface as a `500`. Scope the catch generically in
  `ObjectStore.create` (keyed off SQLite's constraint-violation error code)
  so any future composite-key join object gets the same behavior for free.

**Navigation Architecture (WebGuiLayout)**
- Flip the `Grupos` entry in `NAV_MODULES`
  (`web/src/components/WebGuiLayout.tsx`) to
  `{ name: 'Grupos', path: '/admin/groups', enabled: true }`.
- Add a `<Route path="groups" element={<GroupsPage />} />` under the existing
  `ProtectedRoute`-guarded route tree in `AppRouter.tsx`, next to `users`.

**Frontend: `web/src/pages/GroupsPage.tsx`**
- Structure mirrors `UsersPage.tsx`: a hand-rolled `<table>` listing groups
  (name, member count, actions), a "New group" button opening a create modal
  (name field only), row-level Edit and Delete actions each opening their
  own conditionally-rendered modal (not CSS-hidden), matching the Users
  precedent.
- The Edit modal has the name field plus a scrollable checklist of every user
  (`load_objects.fcgi?object=users`), each row checked if a matching
  `(user_id, group_id)` pair exists in the group's current membership
  (`load_objects.fcgi?object=user_groups&where.group_id=<id>`). On Save:
  update the name via `modify_objects.fcgi?object=groups` if changed, then
  diff the checked set against loaded membership and issue one
  `create_objects.fcgi?object=user_groups` per newly-checked user and one
  `destroy_objects.fcgi?object=user_groups` per newly-unchecked user.
- No pagination for the groups list or the member checklist — matches the
  codebase-wide absence of pagination; revisit only if real-world list sizes
  make this unusable.
- Uses the existing `useFcgi()` hook unchanged for every request (session
  injection, 401 handling, error-body parsing already generic).
- Styling matches the existing Tailwind/dark-slate vocabulary used by
  `UsersPage`/`WebGuiLayout` — no new design system introduced.

**Client Interaction & Authentication Invariance**
- Every mutation goes through the official `.fcgi` object endpoints with
  `?session=<token>` — no `/api/admin/*` calls anywhere in this section,
  preserving the invariant established by the Users spec.

## Testing Decisions

**Testing Principles**: test external behavior (rendered DOM state and
outgoing `.fcgi` requests), not internal component structure — same
principle as `users.test.tsx`.

**Frontend Seam** (`web/src/groups.test.tsx`): Vitest + React Testing
Library + `@testing-library/user-event`, mocking `globalThis.fetch` by
branching on the URL (`load_objects.fcgi`, `create_objects.fcgi`,
`modify_objects.fcgi`, `destroy_objects.fcgi`, each with `object=groups` or
`object=user_groups`), asserting both DOM state and exact outgoing request
bodies. Session seeded via `localStorage`, rendered inside
`<AuthProvider><MemoryRouter>`, exactly as `users.test.tsx` already does.

**Backend Seam**: a Fastify HTTP integration test (mirroring the existing
`.fcgi` object-route integration tests) covering: `groups` create/load/
modify/destroy round-trip; `user_groups` create/load-by-`group_id`/
load-by-`user_id`/destroy; the new duplicate-insert `400` on `user_groups`;
and that deleting a `groups` row cascades its `user_groups` rows.

**Prior art**: `web/src/users.test.tsx` (frontend seam), the existing
`.fcgi` object-route integration suite under `api/src/routes/fcgi/`
(backend seam, exact file located during implementation).

## Out of Scope

- Any `/api/admin/groups*` REST route changes — left exactly as-is (unused
  by the WebGUI, not deleted).
- Referential-integrity guard preventing deletion of a group referenced by
  an Access Rule — left as a silent/orphaning delete; revisit once the
  Access Rules spec exists and can decide the policy end-to-end.
- Group-level access to Access Rules or Time Zones — belongs to the future
  Access Rules spec, not this one.
- Pagination for the group list or the member checklist.
- Implementation itself (opening build issues, writing code) — happens after
  this spec is reviewed/approved, same as Users.

## Further Notes

- Assumes `groups`/`user_groups` field shapes exactly as they exist in
  `api/src/db/schema.ts` today (`groups`: `id`, `name`; `user_groups`:
  `user_id`, `group_id`) — no schema migration needed beyond registering
  `groups` in `ObjectStore`.
- Decisions behind this spec were settled via grilling on wayfinder ticket
  "Spec da seção Groups na WebGUI" (#79), child of the WebGUI specs map
  (#77).
