# Implementation Plan: Control-iD Facial Emulator

## Overview

This plan builds the emulator monorepo incrementally and test-first, in dependency order:
tooling and scaffolding → shared payload types → Drizzle schema/connection → the state-mode
bootstrap → services (each with unit + property tests) → the `.fcgi` and control-panel
routes → the React control panel → Docker packaging → CI/CD workflows → README.

Design language is **Node.js + TypeScript** (Fastify, Drizzle/SQLite, React + Vite, undici,
vitest + fast-check) as fixed by the design; no language selection is required.

Each correctness property from the design's *Correctness Properties* section is implemented
by a **single** fast-check property test (≥ 100 iterations) tagged
`// Feature: controlid-facial-emulator, Property N`. Test sub-tasks are marked optional with
`*`. Pure infra/verification-only items (CI/CD behavior, image-size/startup smoke, README)
are validated by build/workflow runs rather than PBT. Tasks are kept small enough to be
individually committable.

## Tasks

- [x] 1. Scaffold monorepo, tooling, and shared types
  - [x] 1.1 Create root and `api/` project scaffolding and tooling
    - Create the monorepo layout (`api/`, `web/`, root), root `.gitignore`, root
      `package.json` with workspaces (or npm/pnpm workspace config)
    - In `api/`: `tsconfig.json` (strict), ESLint config, Prettier, and `vitest.config.ts`;
      add `fast-check` and `vitest` as dev dependencies; add `fastify`, `drizzle-orm`,
      SQLite driver, and `undici` as dependencies
    - Add npm scripts: `lint`, `test`, `build` for `api/`
    - _Traceability: enables Req 11 (lint+test scripts), Req 10 (build), foundation for all
      services. Design: Technology Stack and Rationale, Architecture (monorepo)_

  - [x] 1.2 Define shared Control-iD payload/types module
    - Create a `types`/`shared` module in `api/` with TypeScript types for the grounded
      payload shapes: `MonitorConfig`, `UserRecord`/`AccessLogRecord`, session token,
      `PushOutcome`, `InterceptionRecord`, and the `.fcgi` request/response shapes and the
      `dao` / `device_is_alive` webhook envelopes from the Payload Catalog
    - No business logic — types and JSON Schema constants only
    - _Traceability: Req 1.1, 1.2, 5.3, 6.1–6.3; Design: Components and Interfaces, Push/
      Webhook Payload Catalog_

- [x] 2. Database schema and connection layer
  - [x] 2.1 Implement Drizzle schema and DB connection factory
    - Create `db/schema.ts` with `config`, `users`, `access_logs`, `sessions`, and
      `interception_log` tables exactly as in the Data Models section
    - Create a connection factory that opens either `:memory:` (ephemeral) or a file path
      (persistent), returning a typed Drizzle DB; add migration/`createTables` bootstrap
    - _Traceability: Req 3, 4, 8, 9.1, 9.2; Design: Data Models_

  - [x]* 2.2 Write unit tests for schema/connection factory
    - Verify tables are created for both `:memory:` and file connections; verify a file DB
      round-trips a written row after reopening the same file
    - _Traceability: Req 9.1, 9.2; Design: Data Models_

- [x] 3. Bootstrap and state-mode selection
  - [x] 3.1 Implement Bootstrap / StateMode selector
    - Implement `resolveMode(env)` (persistent|ephemeral, default ephemeral + warning on
      unset/unknown), `openStore(mode)`, `ensureVolumeWritable(path)` (abort with non-zero
      exit + message when persistent volume missing/unwritable), and `initDefaultsIfEmpty`
    - Read env vars (`EMULATOR_STATE_MODE`, `EMULATOR_DB_PATH`, `EMULATOR_PORT`,
      `EMULATOR_DEVICE_ID`, `EMULATOR_LOGIN`, `EMULATOR_PASSWORD`); validate required items
      and terminate startup with a specific log message + non-zero exit on missing/invalid
    - Apply the selected mode before binding the port
    - _Traceability: Req 9.3, 9.4, 9.5, 9.6, 10.4; Design: Bootstrap / StateMode selector_

  - [x]* 3.2 Write unit tests for Bootstrap
    - Cover: default-to-ephemeral + warning on unset/unknown mode (9.6); persistent-with-
      missing-volume aborts without listening (9.5, 10.4); defaults initialized when store
      empty (9.3); missing/invalid required env var terminates with non-zero exit (10.4)
    - _Traceability: Req 9.3, 9.5, 9.6, 10.4; Design: Error Handling table_

- [x] 4. ConfigService (configuration persistence)
  - [x] 4.1 Implement ConfigService with defaults, validation, and target resolution
    - Implement `get(module, keys?)` filling documented defaults for unset keys, `set(patch)`
      as all-or-nothing with `ValidationError` naming the rejected key, `getDefaults()`, and
      `resolvePushTarget()` composing `http://<hostname>:<port>/<path>` (or `null` when unset)
    - Enforce replace/last-write-wins semantics and Push_Target 1–2048 char rule
    - _Traceability: Req 3.1–3.6, 5.1; Design: ConfigService_

  - [x]* 4.2 Write property test — configuration round-trip
    - **Property 1: Configuration round-trip** — for any valid config write, a subsequent
      read returns exactly the written values
    - Tag `// Feature: controlid-facial-emulator, Property 1`; ≥ 100 iterations
    - _Traceability: Req 3.1, 3.3; Design: Property 1_

  - [x]* 4.3 Write property test — last-write-wins config replace
    - **Property 6: Idempotent (last-write-wins) config replace** — for any recognized key
      and two sequential writes, a read returns only the second value
    - Tag `// Feature: controlid-facial-emulator, Property 6`; ≥ 100 iterations
    - _Traceability: Req 3.6; Design: Property 6_

  - [x]* 4.4 Write property test — config validation is all-or-nothing
    - **Property 8: Config validation is all-or-nothing** — any write with ≥ 1 invalid
      key/value is rejected whole, store unchanged, error names a rejected key
    - Tag `// Feature: controlid-facial-emulator, Property 8`; ≥ 100 iterations
    - _Traceability: Req 3.2, 1.4; Design: Property 8_

- [x] 5. SessionService
  - [x] 5.1 Implement SessionService
    - Implement `issue()` (URL-safe random token, persisted with issuedAt/expiresAt =
      issuedAt + 3600 s) and `validate(token)` returning `valid|expired|invalid` against the
      3600 s TTL
    - _Traceability: Req 2.1, 2.4, 2.5; Design: SessionService, `sessions` model_

  - [x]* 5.2 Write property test — session validity
    - **Property 3: Session validity** — issued tokens are valid while elapsed < 3600 s and
      rejected (401, command not processed) when absent/empty/malformed/expired
    - Use fake timers around the 3600 s boundary; tag
      `// Feature: controlid-facial-emulator, Property 3`; ≥ 100 iterations
    - _Traceability: Req 2.4, 2.5; Design: Property 3_

- [x] 6. ObjectStore / UserRepository (log & biometry data)
  - [x] 6.1 Implement ObjectStore and UserRepository
    - Implement `create/load/modify/destroy` over the object model with filter-based `load`,
      and `UserRepository.list()`, `getImage()`, `appendAccessLog()`; validate filter params
      and signal unrecognized/invalid filters
    - _Traceability: Req 4.1–4.5; Design: ObjectStore / UserRepository, `users`/`access_logs`_

  - [x]* 6.2 Write property test — filtered log queries return exact matching subset
    - **Property 10: Filtered log queries return exactly the matching subset** — for any set
      of records and any valid filter subset, `load` returns precisely the matching records
    - Tag `// Feature: controlid-facial-emulator, Property 10`; ≥ 100 iterations
    - _Traceability: Req 4.4; Design: Property 10_

  - [x]* 6.3 Write unit tests for ObjectStore edge cases
    - Empty/no-match query returns empty collection (4.2); unrecognized/invalid filter
      returns validation error naming the parameter (4.5); biometry returns structured data
    - _Traceability: Req 4.2, 4.3, 4.5; Design: Error Handling table_

- [x] 7. InterceptionLogger
  - [x] 7.1 Implement InterceptionLogger
    - Implement `recordInbound`/`recordOutbound` (ISO 8601 UTC ms timestamps), 64 KB body
      truncation with `truncated=true`, `query(limit?)` ordered `id DESC` (newest-first),
      and capacity enforcement discarding oldest beyond 10,000
    - _Traceability: Req 8.1–8.4, 8.5, 8.7; Design: InterceptionLogger, `interception_log`_

  - [x]* 7.2 Write property test — interception log strictly newest-first
    - **Property 4: Interception log is strictly newest-first** — for any sequence of
      recorded events, the view returns them with strictly decreasing ids
    - Tag `// Feature: controlid-facial-emulator, Property 4`; ≥ 100 iterations
    - _Traceability: Req 8.5; Design: Property 4_

  - [x]* 7.3 Write property test — interception log capacity cap
    - **Property 5: Interception log capacity cap** — for any N > 10000 writes, exactly the
      10000 newest records are retained
    - Use N in (10000, 12000]; tag `// Feature: controlid-facial-emulator, Property 5`; ≥ 100
    - _Traceability: Req 8.7; Design: Property 5_

  - [x]* 7.4 Write property test — inbound body truncation invariant
    - **Property 11: Inbound body truncation invariant** — bodies > 64 KB store exactly the
      first 64 KB and are marked truncated; otherwise stored in full and not truncated
    - Use body sizes straddling 65536; tag
      `// Feature: controlid-facial-emulator, Property 11`; ≥ 100 iterations
    - _Traceability: Req 8.2; Design: Property 11_

- [x] 8. Checkpoint — data + core services
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. PushEngine (webhook dispatch)
  - [x] 9.1 Implement PushEngine with timeout and retry policy
    - Implement `resolvePushTarget(endpoint)` composing the final URL, and `dispatch()` using
      undici with a 10 s per-request timeout, up to 3 retries at fixed 5 s intervals (max 4
      attempts), treating only 2xx as success; return a `PushOutcome`; record `no_target` and
      skip POST when no target; record failures with target, final status/timeout, attempts
    - _Traceability: Req 5.1, 5.2, 5.5, 5.6, 5.7, 5.8; Design: PushEngine, Error Handling_

  - [x]* 9.2 Write property test — push re-targeting composes exact destination URL
    - **Property 2: Push re-targeting composes the exact destination URL** — for any valid
      monitor target, dispatch POSTs to exactly `http://<hostname>:<port>/<path>/<endpoint>`
    - Assert against a local stub server / injected client mock; tag
      `// Feature: controlid-facial-emulator, Property 2`; ≥ 100 iterations
    - _Traceability: Req 5.4, 5.1, 3.5; Design: Property 2_

  - [x]* 9.3 Write property test — push retry is bounded to four attempts
    - **Property 7: Push retry is bounded to four attempts** — for any unreachable/timing-out
      target, exactly 4 attempts are recorded with target, final status/timeout, and count
    - Tag `// Feature: controlid-facial-emulator, Property 7`; ≥ 100 iterations (mock client)
    - _Traceability: Req 5.7, 5.8; Design: Property 7_

  - [x]* 9.4 Write property test — HTTP 2xx classification of dispatch outcomes
    - **Property 9: HTTP 2xx classification of dispatch outcomes** — dispatch is successful
      iff the target status code is in 200–299
    - Stub returns generated codes 100–599; tag
      `// Feature: controlid-facial-emulator, Property 9`; ≥ 100 iterations
    - _Traceability: Req 5.2; Design: Property 9_

  - [x]* 9.5 Write unit test — no-target dispatch records no_target
    - Verify a simulate with no configured target records `no_target` and performs no POST
    - _Traceability: Req 5.5; Design: Error Handling table_

- [x] 10. SimulationService
  - [x] 10.1 Implement SimulationService
    - Implement `simulateAuthorized(userId)` (event 7 `dao` payload incl. identity, appends
      an `access_logs` record), `simulateDenied()` (event 6 `dao`), `forceKeepAlive()`
      (`device_is_alive`); reject authorized-without-identity so no webhook is dispatched;
      complete dispatch within 2 s; delegate to PushEngine
    - _Traceability: Req 6.1–6.6, 4.1; Design: SimulationService, Payload Catalog_

  - [x]* 10.2 Write unit tests for SimulationService
    - Authorized-without-identity rejected with error, no webhook (6.6); each event builds the
      grounded payload shape (6.1–6.3); failure after retries surfaces error while preserving
      selection (6.5)
    - _Traceability: Req 6.1, 6.2, 6.3, 6.5, 6.6; Design: SimulationService, Error Handling_

- [x] 11. Composition root and inbound interception tap
  - [x] 11.1 Wire dependency-injection composition root and Fastify instance
    - Build a bootstrap/composition module that instantiates DB, ConfigService, SessionService,
      ObjectStore/UserRepository, InterceptionLogger, PushEngine, SimulationService and creates
      the Fastify app; add a global inbound hook tapping `InterceptionLogger.recordInbound`;
      no business logic in route handlers
    - _Traceability: Req 8.1; Design: Architecture (composition root, inbound tap)_

  - [x]* 11.2 Write integration test for inbound interception tap
    - Verify an inbound request is recorded with path, method, ISO-8601 ms timestamp, and body
    - _Traceability: Req 8.1; Design: Architecture_

- [x] 12. FcgiRouter and `.fcgi` route handlers
  - [x] 12.1 Implement session middleware and login/session routes
    - Register `/login.fcgi` (credential check → token or 401; 400 on missing username/
      password naming the field) and `/session_is_valid.fcgi`; implement session middleware
      that short-circuits protected routes to 401 on absent/empty/malformed/expired token
    - _Traceability: Req 2.1, 2.2, 2.3, 2.4, 2.5; Design: FcgiRouter, SessionService_

  - [x] 12.2 Implement configuration `.fcgi` routes
    - Register `/set_configuration.fcgi` and `/get_configuration.fcgi` (protected) delegating
      to ConfigService with all-or-nothing validation and defaults
    - _Traceability: Req 3.1–3.6; Design: FcgiRouter, ConfigService_

  - [x] 12.3 Implement object/log/biometry `.fcgi` routes
    - Register `/create_objects.fcgi`, `/load_objects.fcgi`, `/modify_objects.fcgi`,
      `/destroy_objects.fcgi`, `/user_get_image.fcgi`, and `/new_user_identified.fcgi` with
      exact request/response shapes and Content-Type `application/json` (octet-stream for
      images)
    - _Traceability: Req 1.1, 1.2, 4.1–4.5; Design: API/Endpoint Specification_

  - [x] 12.4 Implement global error, 404, and 405 handling
    - JSON Schema validation → 400 + `error-description` and no state change; unknown path →
      404 + `error-description`; wrong method → 405; ensure `Content-Type: application/json`
      and the 200-within-500ms behavior for valid requests
    - _Traceability: Req 1.2, 1.3, 1.4, 1.5, 1.6; Design: Error Handling table_

  - [x]* 12.5 Write integration tests for `.fcgi` contract and errors
    - Live-Fastify round-trips: response shapes/Content-Type (1.1/1.2), 400 on bad body
      (1.4), 404 unknown path (1.5), 405 wrong method (1.6), login flows (2.1–2.3), latency
      budgets (1.3)
    - _Traceability: Req 1.1–1.6, 2.1–2.3; Design: Testing Strategy_

- [x] 13. Control Panel and Interception APIs
  - [x] 13.1 Implement Control Panel and Interception API routes
    - Register `GET /api/identities`, `POST /api/simulate/authorized|denied|keep-alive`
      (400 when `userId` missing for authorized), and `GET /api/interception?limit=`
      (newest-first, empty array when none); error bodies carry a message that lets the panel
      keep the developer's selection
    - _Traceability: Req 6.1–6.3, 6.5, 6.6, 7.3, 8.5, 8.6; Design: ControlPanelApi, Interception API_

  - [x]* 13.2 Write integration tests for control-panel/interception APIs
    - Simulate endpoints return `PushOutcome`; missing `userId` → 400; interception newest-
      first ordering and empty-state array
    - _Traceability: Req 6.1, 6.6, 8.5, 8.6; Design: ControlPanelApi_

- [x] 14. Static asset serving and main entrypoint
  - [x] 14.1 Implement StaticAssetServer and `main.ts` entrypoint
    - Serve the built SPA at `/admin` with `index.html` fallback for unknown sub-paths; wire
      `main.ts` to run Bootstrap then bind the single `EMULATOR_PORT` after mode is applied
    - _Traceability: Req 7.1, 7.2, 9.4, 10.1; Design: StaticAssetServer, Bootstrap_

  - [x]* 14.2 Write integration test for SPA serving and fallback
    - `/admin` serves the app; unknown `/admin/*` path returns the SPA entry point
    - _Traceability: Req 7.1, 7.2; Design: StaticAssetServer_

- [x] 15. Checkpoint — full API surface
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. React + Vite control panel (`web/`)
  - [x] 16.1 Scaffold the `web/` React + Vite app and API client
    - Create `web/` with Vite, TypeScript, ESLint; add an API client for `/api/identities`,
      `/api/simulate/*`, and `/api/interception`; configure the build to output the static
      assets served at `/admin`
    - _Traceability: Req 7 (Tech Stack), 7.6; Design: Frontend (React + Vite)_

  - [x] 16.2 Implement event controls with identity selection
    - Build controls for authorized (with identity picker listing ≥ 1 identity, requiring a
      selection before activation), denied, and keep-alive; send the corresponding request on
      activation and display the returned outcome within budget
    - _Traceability: Req 7.3, 7.4, 7.5, 7.6, 7.7; Design: ControlPanelApi_

  - [x] 16.3 Implement error handling and Interception Log view
    - On error/failed request, show a visible message and retain selections without
      resubmitting; render the interception log newest-first with an explicit empty-state
    - _Traceability: Req 7.8, 8.5, 8.6; Design: ControlPanelApi, Interception API_

  - [x]* 16.4 Write component tests for control panel behavior
    - Authorized control disabled until an identity is selected (7.3); error message shown and
      selection retained on failure (7.8); empty-state rendered when no records (8.6)
    - _Traceability: Req 7.3, 7.8, 8.6; Design: Testing Strategy_

- [ ] 17. Docker packaging
  - [~] 17.1 Write multi-stage Dockerfile and docker-compose.yml
    - Multi-stage build: web build → api build (tsc + prune dev deps) → `node:alpine` runner
      copying compiled API + static assets + prod deps; `EXPOSE 8080`; `CMD node dist/main.js`;
      add `docker-compose.yml` mapping host:container port with a persistent-mode volume
    - _Traceability: Req 10.1, 10.2, 10.3, 10.5; Design: Dockerfile plan, docker-compose outline_

  - [ ]* 17.2 Add image-size and startup smoke check (verification-only, not PBT)
    - Script/CI step asserting final image < 200 MB and the container accepts an API request
      within 10 s of start; verified by build/run, not property tests
    - _Traceability: Req 10.2, 10.3; Design: Out-of-scope for PBT_

- [ ] 18. CI/CD workflows (verification-only, not PBT)
  - [~] 18.1 Add GitHub Actions CI workflow
    - On push to `main` and PR (opened/synchronize/reopened): checkout → install → lint →
      test (vitest incl. property tests); lint/test failure fails and records the step;
      all-green succeeds; 15-minute job timeout
    - _Traceability: Req 11.1–11.6; Design: CI workflow_

  - [~] 18.2 Add GitHub Actions CD workflow
    - Trigger on tags `v[0-9]+.[0-9]+.[0-9]+` (non-matching tags do nothing); buildx build →
      on failure stop without publishing → push Docker Hub `<version>` (v stripped) + `latest`
      → on publish failure fail and skip release → create GitHub release named with the tag
      and a changelog of commits since the previous semver tag
    - _Traceability: Req 12.1–12.7; Design: CD workflow_

- [ ] 19. README and documentation (verification-only, not PBT)
  - [~] 19.1 Write root README
    - Document the run command, API and Control Panel address/port; state-mode option name,
      accepted values, and default; list every supported `.fcgi` endpoint by path + method
      referencing the Official API Documentation; a verification step (successful API
      response); and each documented divergence from reference behavior
    - _Traceability: Req 13.1–13.5; Design: Design Decisions (documented divergences)_

- [~] 20. Final checkpoint — full build, tests, and image
  - Ensure all tests pass, the image builds under budget, and CI is green; ask the user if
    questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP.
- Each correctness property (1–11) is implemented by exactly one fast-check property test
  (≥ 100 iterations) tagged `// Feature: controlid-facial-emulator, Property N`.
- Property → task map: P1→4.2, P2→9.2, P3→5.2, P4→7.2, P5→7.3, P6→4.3, P7→9.3, P8→4.4,
  P9→9.4, P10→6.2, P11→7.4.
- CI/CD (Req 11, 12), image size/startup (Req 10.2, 10.3), and documentation (Req 13) are
  verification-only — validated by build/workflow runs and smoke checks, not property tests.
- Every requirement 1–13 is covered: 1 (12.3, 12.4, 12.5), 2 (5.1, 12.1), 3 (4.1, 12.2),
  4 (6.1, 12.3), 5 (9.1), 6 (10.1, 13.1), 7 (14.1, 16.x), 8 (7.1, 11.1, 13.1), 9 (3.1, 14.1),
  10 (17.1, 17.2), 11 (18.1), 12 (18.2), 13 (19.1).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "4.1", "5.1", "6.1", "7.1"] },
    { "id": 3, "tasks": ["3.2", "4.2", "4.3", "4.4", "5.2", "6.2", "6.3", "7.2", "7.3", "7.4", "9.1"] },
    { "id": 4, "tasks": ["9.2", "9.3", "9.4", "9.5", "10.1"] },
    { "id": 5, "tasks": ["10.2", "11.1"] },
    { "id": 6, "tasks": ["11.2", "12.1", "12.2", "12.3"] },
    { "id": 7, "tasks": ["12.4", "13.1", "14.1"] },
    { "id": 8, "tasks": ["12.5", "13.2", "14.2", "16.1"] },
    { "id": 9, "tasks": ["16.2", "16.3"] },
    { "id": 10, "tasks": ["16.4", "17.1"] },
    { "id": 11, "tasks": ["17.2", "18.1", "18.2", "19.1"] }
  ]
}
```
