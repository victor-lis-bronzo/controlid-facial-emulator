# Spec: WebGUI Dashboard Section

## Problem Statement

Administrators using the WebGUI today land directly on the Users screen
after logging in, with no at-a-glance overview of what's configured across
Users, Groups, Time Zones, Portals, and Access Rules, and no visibility
into recent access activity without opening a dedicated screen (which
doesn't exist yet for Access Logs). "Início"/Dashboard has no nav entry at
all today — there isn't even a disabled placeholder for it.

## Solution

Add a new WebGUI section, Dashboard, reachable at `/admin/dashboard`, and
make it the new landing page after login (replacing the current redirect
to `/admin/users`). It shows five clickable count cards (Users, Groups,
Time Zones, Portals, Access Rules), each computed client-side by calling
`load_objects.fcgi` for the corresponding object with no filter and
counting the returned array's length — there is no native aggregation
endpoint on the real device, so this is the only `.fcgi`-faithful way to
produce a count. It also shows a total Access Logs count and a "recent
activity" list of the 10 most recent access logs, sorted client-side since
`load_objects.fcgi` gives no ordering guarantee.

This is the first WebGUI screen with no direct equivalent on the real
device's own admin interface. Per ADR 0001/0002 and the "Documented
Divergence" concept in `CONTEXT.md`, the fidelity requirement is scoped to
the `.fcgi` wire protocol (paths, methods, field names, payload shapes) —
not to the WebGUI's own screen inventory. A convenience screen like this
one is permitted as long as every request it makes is a real, unmodified
`.fcgi` call; nothing here introduces a new endpoint or a fictional wire
behavior.

## User Stories

1. As an administrator, I want to land on a Dashboard immediately after
   logging in, so that I get an overview before diving into any specific
   section.
2. As an administrator, I want to see "Início" enabled in the WebGUI
   navigation as the first item, so that I can always get back to the
   overview.
3. As an administrator, I want to see a count of Users, Groups, Time
   Zones, Portals, and Access Rules, so that I know the scale of what's
   configured without opening each section.
4. As an administrator, I want each of those five count cards to be
   clickable, taking me straight to that entity's list screen, so the
   Dashboard also works as a quick-navigation hub.
5. As an administrator, I want to see a total count of Access Logs, so
   that I have a sense of how much access activity has been recorded.
6. As an administrator, I want to see the 10 most recent access log
   entries, each showing when it happened, what happened (translated to a
   human label — "Autorizado", "Negado", "Não identificado" — instead of
   the device's raw numeric event code), which user, and which portal, so
   that I can spot recent activity at a glance without a dedicated Access
   Logs screen (which doesn't exist yet).
7. As an administrator, I want the recent-activity rows to be
   non-interactive (no click-through), so that the Dashboard doesn't imply
   navigation to a screen that doesn't exist yet.
8. As an administrator, I want an explicit "no logs yet" state when
   `access_logs` is empty, so that I understand the list isn't broken.
9. As an administrator, I want the counts and recent-activity list to
   reflect the current state every time I visit or return to the
   Dashboard, so that stale numbers don't mislead me.
10. As an administrator, I want a clear error message if any of the
    underlying `.fcgi` calls fail, so I know the Dashboard's numbers might
    be incomplete.
11. As a developer maintaining the emulator, I want the Dashboard to
    consume only `load_objects.fcgi` calls that already exist for other
    sections (`users`, `groups`, `time_zones`, `portals`, `access_rules`,
    `access_logs`), so that no new `.fcgi` object or endpoint is
    introduced just for this screen.
12. As a QA/reviewer, I want the Dashboard tested with the same
    fetch-mocking seam as every other WebGUI section
    (`dashboard.test.tsx`), so behavior is verified without hitting a real
    server.

## Implementation Decisions

**Navigation Architecture (WebGuiLayout)**
- Add a new `Início` entry to `NAV_MODULES`
  (`web/src/components/WebGuiLayout.tsx`), placed **first**, before
  `Usuários`: `{ name: 'Início', path: '/admin/dashboard', enabled: true }`.
- Change `RootRedirect` in `AppRouter.tsx`: authenticated traffic on `/`,
  `/admin`, and any unmatched path now redirects to `/admin/dashboard`
  instead of `/admin/users`. Unauthenticated traffic is unaffected (still
  redirects to `/admin/login`).
- Add a `<Route path="dashboard" element={<DashboardPage />} />` under the
  existing `ProtectedRoute`-guarded route tree in `AppRouter.tsx`.

**Frontend: `web/src/pages/DashboardPage.tsx`**
- On mount, issues one `load_objects.fcgi` call per object with no filter,
  in parallel: `users`, `groups`, `time_zones`, `portals`, `access_rules`,
  `access_logs`. Each count card's number is `response[object].length` —
  purely client-side aggregation, since no native aggregation endpoint
  exists on the real device.
- Five count cards (Usuários, Grupos, Horários, Portais, Regras de
  Acesso), each a clickable element (e.g. a styled link/button) navigating
  to the entity's existing list screen (`/admin/users`, `/admin/groups`,
  `/admin/time-zones`, `/admin/portals`, `/admin/access-rules`
  respectively). A sixth, non-clickable card shows the total Access Logs
  count.
- A "recent activity" list below the cards: take the `access_logs` array
  already fetched for the count, sort it by `id` descending client-side
  (chosen over `time` because `time` is a device-shaped epoch-seconds
  string with no ordering guarantee in ad-hoc/simulated data, while `id`
  is a reliable autoincrement), and render the first 10. Each row shows:
  `time` (formatted for display), `event` translated from its raw device
  code (`'7'` → "Autorizado", `'6'` → "Negado", `'3'` → "Não
  identificado", any other value shown as-is as a fallback), `user_id`,
  and `portal_id` — both ids displayed raw, with no cross-reference/join
  to the corresponding user or portal name (keeps this screen to the
  objects already being fetched, no extra `.fcgi` calls). Rows are plain,
  non-interactive (no navigation, no expand).
- Explicit empty state when `access_logs` is empty: no recent-activity
  rows, just a message, consistent with every other section's empty-list
  treatment.
- Uses the existing `useFcgi()` hook unchanged for every request (session
  injection, 401 handling, error-body parsing already generic). A single
  error banner surfaces if any of the six parallel calls fails.
- Styling matches the existing Tailwind/dark-slate vocabulary used by
  every other section — no new design system introduced. Implementation
  should consult this codebase's `dataviz`/stat-tile design guidance (if
  available in the assistant's toolset at build time) for the count-card
  layout, since this is the first screen in the WebGUI with this kind of
  summary-tile UI; no existing precedent component exists in `web/src` to
  copy from directly.

**Client Interaction & Authentication Invariance**
- Every request goes through the official `.fcgi` object endpoints with
  `?session=<token>` — no `/api/admin/*` calls, no new endpoint, no
  aggregation logic added to the backend. Preserves the invariant
  established by every prior WebGUI spec, while making explicit (per
  Further Notes) that this screen itself has no 1:1 device counterpart —
  only its underlying requests do.

## Testing Decisions

**Testing Principles**: test external behavior (rendered DOM state and
outgoing `.fcgi` requests), not internal component structure — same
principle as every other WebGUI page's tests.

**Frontend Seam** (`web/src/dashboard.test.tsx`): Vitest + React Testing
Library + `@testing-library/user-event`, mocking `globalThis.fetch` by
branching on the URL/object for all six `load_objects.fcgi` calls,
asserting: each count card shows the correct number and length-derived
value; clicking a count card navigates to the right route (via
`MemoryRouter`'s location assertions, same technique already used in
`router.test.tsx`); the recent-activity list renders the 10 most recent
logs sorted by `id` descending with translated event labels; the empty
state renders when `access_logs` is empty; an error banner renders when
any of the six calls fails. Session seeded via `localStorage`, rendered
inside `<AuthProvider><MemoryRouter>`, exactly as every prior page's tests
already do.

**Root redirect test**: extend `web/src/router.test.tsx`'s existing
authenticated-redirect assertion to expect `/admin/dashboard` instead of
`/admin/users`.

**Prior art**: `web/src/groups.test.tsx`/`web/src/timeZones.test.tsx`/
`web/src/portals.test.tsx`/`web/src/accessRules.test.tsx` (frontend seam,
fetch-mocking-by-URL pattern), `web/src/router.test.tsx` (redirect
assertions), `web/src/layout.test.tsx` (nav-entry assertions, needs a new
case for the "Início" link).

## Out of Scope

- Any new backend endpoint, aggregation route, or schema change — the
  Dashboard is entirely a client-side composition of six already-existing
  `load_objects.fcgi` calls.
- A dedicated Access Logs section/page — recent-activity rows are
  deliberately non-interactive because that screen doesn't exist yet; this
  spec doesn't build it.
- Cross-referencing `user_id`/`portal_id` in the recent-activity list to
  display names instead of raw ids — would require extra `.fcgi` calls per
  row/id and is deferred until (if ever) it's worth the cost.
- Any caching, polling, or auto-refresh of the Dashboard's numbers — it
  refetches fresh on every visit/mount, no live-update behavior.
- Pagination, filtering, or date-range selection for the recent-activity
  list — always exactly the 10 most recent, unconditionally.
- Any chart/graph visualization — this spec is count cards and a flat
  recent-activity list, not analytics.

## Further Notes

- This is the first WebGUI screen without a real-device counterpart in
  its own right (the underlying requests are all real `.fcgi` calls, but
  no physical Control-iD reader ships an admin "dashboard" screen). This
  is deliberately allowed per ADR 0001/0002's fidelity scope (the `.fcgi`
  wire surface, not WebGUI screen composition) and is worth keeping in
  mind if a future spec ever needs to draw that line more explicitly.
- Decisions behind this spec were settled via grilling on wayfinder ticket
  "Spec da seção Dashboard na WebGUI" (#83), child of the WebGUI specs map
  (#77), blocked by #78 (Admin Management Panel removal, closed).
- With this spec written, all children of #77 originally named in its
  title (Groups, Time Zones, Portals, Access Rules, Dashboard) have specs;
  #77 itself and #84 (Simulate/Interception Log fate) remain open,
  separate decisions for the repo owner.
