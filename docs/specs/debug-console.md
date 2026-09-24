# Spec: Debug Console (Simulate + Interception Log)

## Problem Statement

The emulator has always shipped a way for integrators to trigger a fake
access event and watch what the emulator did with it, without owning real
hardware: `POST /api/simulate/{authorized,denied,keep-alive}` dispatches a
real Push-engine webhook, and `GET /api/interception` returns a live tail of
every inbound request and outbound webhook dispatch. Both backends are still
registered and functional today (`control-panel-routes.ts`,
`interception-routes.ts`), but their only frontend (`EventControls.tsx`,
`InterceptionLog.tsx`) was deleted alongside the orphaned Admin Management
Panel (#78), leaving them reachable only via curl. README and
`docs/CURRENT_STATE.md` already document this as the current state, but it
means an integrator has to read source/docs to discover the endpoints exist
at all — real engineering investment (retry semantics, log truncation,
property-tested capacity limits) sitting behind zero discoverability.

## Solution

Give Simulate + Interception Log a minimal UI again, but **not** inside the
WebGUI: a physical Control-iD reader has no "simulate a fake event" or "show
me an interception log" screen, so unlike Dashboard (which at least proxies
real `.fcgi` calls and earned an ADR-sanctioned exception), these tools have
no real-device counterpart to justify bending the WebGUI's fidelity
invariant. They become a new domain concept, **Debug Console**: a single
page, outside the WebGUI's route tree, combining the Simulate controls and
the Interception Log view — mirroring how they were coupled originally (the
old log's empty state literally read "Simulate an event to see inbound
requests and outbound webhooks here").

## User Stories

1. As an integrator testing my webhook receiver, I want to trigger a
   simulated Authorized, Denied, or Keep-alive event from a page instead of
   crafting curl commands, so I can test my push target without hardware.
2. As an integrator, I want to pick which user the Authorized event
   identifies, the same way the old Simulate controls did, so I can test
   with realistic identity data.
3. As an integrator, I want to see immediately whether my simulated event's
   webhook dispatch succeeded, failed, retried, or had no configured target,
   so I don't have to separately query the interception log to find out.
4. As an integrator, I want a live-refreshable log of every inbound request
   and outbound webhook dispatch on the same page as the Simulate controls,
   so triggering an event and observing its effect is one continuous flow,
   not two disconnected tools.
5. As an operator, I want the Debug Console to require the same login
   session as the WebGUI, so a debug tool that dispatches real webhooks
   isn't more exposed than the administrative surface it sits next to.
6. As a developer maintaining the emulator, I want the Debug Console kept
   structurally separate from the WebGUI's route tree and component set, so
   the WebGUI's "faithful clone of the device, `.fcgi`-only" invariant is
   never at risk of being read as broken by this page's presence.
7. As a developer, I want the underlying `/api/simulate/*` and
   `/api/interception` endpoints unchanged, so no existing curl-based
   workflow documented in the README breaks.
8. As a developer reading `CONTEXT.md`, I want "Debug Console" defined as
   its own glossary term, distinct from both WebGUI and Admin Management
   Panel, so future specs don't conflate the three.

## Implementation Decisions

**Placement & routing**
- New route, structurally outside `AppRouter.tsx`'s WebGUI tree (e.g. a
  sibling top-level route such as `/debug`, exact path decided at
  implementation time) — not nested under `WebGuiLayout` or its nav.
- Backed by the existing `/api/simulate/*` and `/api/interception` routes,
  unmodified. No new backend endpoints.

**Authentication**
- Require the same session used by the WebGUI (`useFcgi()`'s existing
  session/`ProtectedRoute` machinery) rather than leaving the page open the
  way the underlying REST endpoints are today. The endpoints' own
  no-session requirement is left as-is (documented curl usage keeps
  working); only the new page gates on login.

**Page structure**
- Single page, two stacked panels, replicating the coupled UX of the
  removed `EventControls.tsx` + `InterceptionLog.tsx`:
  - **Simulate panel**: identity picker (`GET /api/identities`) plus three
    actions — Authorized (`POST /api/simulate/authorized`), Denied
    (`POST /api/simulate/denied`), Keep-alive
    (`POST /api/simulate/keep-alive`) — each rendering the returned
    `PushOutcome` inline.
  - **Interception Log panel**: table of `GET /api/interception` results
    (direction, method, path/target, timestamp, outcome), newest-first,
    manual refresh — same shape as the removed `InterceptionLog.tsx`.
- No new design system: reuse the WebGUI's existing Tailwind/dark-slate
  styling vocabulary so the page doesn't look like a third, unrelated UI.

## Testing Decisions

- Frontend seam: a `debug-console.test.tsx` following the same
  fetch-mocking pattern as `users.test.tsx`/`groups.test.tsx` — mock
  `globalThis.fetch` branching on `/api/identities`, `/api/simulate/*`,
  `/api/interception`, assert rendered `PushOutcome`/log state and outgoing
  request bodies.
- No backend test changes: `/api/simulate/*` and `/api/interception` are
  unmodified, already covered by existing integration/property tests.

## Out of Scope

- Any change to `/api/simulate/*` or `/api/interception` themselves.
- Any WebGUI nav entry, route, or component referencing the Debug Console —
  it stays discoverable only by its own direct URL, not from WebGUI
  navigation.
- Implementation itself (opening build issues, writing code) — happens
  after this spec is reviewed/approved, same as the WebGUI section specs.

## Further Notes

- Decisions behind this spec were settled via grilling on wayfinder ticket
  "Decidir o destino de Simulate e Interception Log" (#84), child of the
  WebGUI specs map (#77).
- `CONTEXT.md` gains a "Debug Console" glossary entry alongside this spec
  (see that file's diff), and its stale "Admin Management Panel" entry
  (which still claimed the removed code "ainda existe no repositório") is
  corrected in the same change.
