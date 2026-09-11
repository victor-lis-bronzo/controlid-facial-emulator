# Implementation Plan: Admin Management Panel

## Overview

This plan extends the existing, working Control-iD Facial Emulator (base spec:
`.kiro/specs/controlid-facial-emulator/`) with the Admin Management Panel. It is strictly
**additive**: new Drizzle tables, a `PhotoStorage` abstraction, new repositories/services,
a new `/api/admin/*` REST surface wired into the existing `buildApp`, an upgraded
`user_get_image.fcgi`, and a hash-router SPA — while preserving every existing `.fcgi`
route, the Push Engine, the Interception Log, and the Simulate section.

Tasks are ordered foundations-first and dependency-ordered so each builds on the previous
and ends by wiring things together (no orphaned code). Every task references the
requirement number(s) and the design component it implements. Test sub-tasks are marked
optional with `*`. The four correctness properties from the design are implemented as
optional fast-check property tests colocated with their service. Follow the existing
conventions (Node 22 + TypeScript ESM with `.js` import specifiers, strict,
`consistent-type-imports`; Fastify 5; Drizzle + better-sqlite3; vitest + fast-check).

**Language:** TypeScript — the design specifies concrete TypeScript throughout; no language
selection is required.

## Tasks

- [ ] 1. Data model: schema additions, idempotent DDL, and inferred types
  - [x] 1.1 Add new Drizzle tables to `api/src/db/schema.ts`
    - Add `groups`, `usersGroups`, `portals`, `timeZones`, `timeRanges`, `accessRules`,
      `accessRuleGroups`, `accessRuleTimeZones`, `accessRulePortals` exactly as in the
      design (composite PKs via `primaryKey`; FKs via `.references(...)`; `usersGroups` and
      `timeRanges` `onDelete: 'cascade'`; the three `accessRule*` join columns toward
      Groups/TimeZones/Portals `onDelete: 'restrict'`, toward `accessRules` `cascade`).
    - Add the new tables to the exported `schema` object; add inferred row/insert types
      (`GroupRow`/`GroupInsert`, `PortalRow`, `TimeZoneRow`, `TimeRangeRow`,
      `AccessRuleRow`, and the join-table types) following the `$inferSelect`/`$inferInsert`
      pattern. Do NOT drop or alter any existing `users`/`access_logs`/`config`/`sessions`/
      `interception_log` column.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7_ · _Design: Data Models → Drizzle schema additions_

  - [x] 1.2 Append idempotent `CREATE TABLE IF NOT EXISTS` DDL in `api/src/db/connection.ts`
    - Append the nine new statements to `CREATE_TABLE_STATEMENTS` in parent-before-child
      order (groups, users_groups, portals, time_zones, time_ranges, access_rules,
      access_rule_groups, access_rule_time_zones, access_rule_portals), mirroring the FK/
      cascade choices in 1.1 so `createTables(db)` stays idempotent and self-bootstraps on
      startup before any Admin API request is served.
    - _Requirements: 1.6, 1.1_ · _Design: Data Models → Idempotent DDL additions_

  - [x]* 1.3 Regression: confirm existing DB/bootstrap tests still pass
    - Run the existing `api/src/db/connection.test.ts` and `composition/*.test.ts` to verify
      the additive schema/DDL changes leave existing behavior intact.
    - _Requirements: 12.5, 14.5_ · _Design: Testing Strategy → Regression_

- [ ] 2. Shared validation module and domain errors
  - [x] 2.1 Add `NotFoundError` (404) and `ConflictError` (409) to `api/src/routes/errors.ts`
    - Add both `HttpError` subclasses (setting `name` and `Object.setPrototypeOf`) next to
      `BadRequestError`/`UnauthorizedError`, and add `case 'NotFoundError':` and
      `case 'ConflictError':` to the name-based `switch` in `classify()` (reading the carried
      `statusCode`, defaulting 404/409) so they map correctly under the duplicate-class
      fallback the file documents. Leave the existing `413`/`FastifyError` Layer-3 handling
      untouched (it already renders multipart `FST_REQ_FILE_TOO_LARGE` as 413).
    - _Requirements: 7.7, 2.6, 4.5, 5.6, 6.4, 7.5_ · _Design: Domain error additions_

  - [x] 2.2 Create shared `api/src/services/validation.ts` pure primitives
    - Implement `validateName(field, value, max)` (non-empty, ≤ max → `BadRequestError`
      naming the field), `parseHhMm(value)` (`HH:MM` 00–23 / 00–59), `WEEKDAYS` (the seven
      names), `daysToMask`/`maskToDays` (7-bit weekday mask, 1..127), and
      `validateTimeRange(write)` (valid `HH:MM`, `start < end`, ≥ 1 valid weekday). Pure
      functions only; throw shared domain errors on invalid input.
    - _Requirements: 5.2, 5.3, 5.4, 2.1, 4.2, 6.2, 7.1_ · _Design: shared `validation.ts`_

  - [x]* 2.3 Unit tests for validation primitives and new errors
    - Test `validateName` length bounds (1/64, 1/128, empty, over-length), `parseHhMm`
      edges (`00:00`, `23:59`, `24:00`, `12:60`, non-numeric), `daysToMask`/`maskToDays`
      round-trip, and that `NotFoundError`/`ConflictError` classify to 404/409 with an
      `error-description`.
    - _Requirements: 14.1_ · _Design: Testing Strategy → Unit_

- [ ] 3. PhotoStorage abstraction
  - [x] 3.1 Implement `api/src/repositories/photo-storage.ts`
    - Implement the `PhotoStorage` interface (`save`/`read`/`delete`) and `StoredPhoto`/
      `PhotoMime` types over Node `fs`. Resolve the root from `EMULATOR_DATA_DIR` else
      `dirname(dbPath)` else a temp dir; create the `photos/` subfolder on first write; name
      files `<userId>.jpg`/`<userId>.png` so re-upload overwrites and `delete` is a simple
      idempotent unlink; recover the mime from the stored extension in `read`. No biometric
      processing.
    - _Requirements: 3.1, 3.5, 3.6, 3.7, 3.8, 13.3, 15.1_ · _Design: PhotoStorage_

  - [x]* 3.2 Unit tests for PhotoStorage
    - Test save→read round-trip preserves bytes and mime for JPEG and PNG, re-upload
      overwrites, `delete` is idempotent, and `read` returns null when absent. Use a temp
      dir.
    - _Requirements: 3.1, 3.5, 3.6, 14.1_ · _Design: Testing Strategy → Unit_

- [ ] 4. Admin repositories (typed reads/writes over DrizzleDb)
  - [x] 4.1 Extend `api/src/repositories/user-repository.ts` for admin CRUD + photo
    - Keep `list()`/`appendAccessLog()`/`getBiometry()` unchanged. Upgrade `getImage` and add
      `getImageWithMime(userId)` to delegate to `PhotoStorage.read` (inject `PhotoStorage`).
      Add `AdminUserView`/`UserWrite` types and `listAdmin()`, `getAdmin(id)`, `create(write)`,
      `update(id, write)`, `delete(id)` (also removing `users_groups` rows), `setImagePath`,
      and `existingIds(ids)`. Store PIN in the `password` column. Multi-table writes run in a
      Drizzle transaction.
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.7, 2.8, 3.1, 3.5, 3.6, 4.7_ · _Design: UserRepository extensions_

  - [x] 4.2 Create `api/src/repositories/group-repository.ts`
    - Implement `GroupRepository` (`list` → `GroupView` with `memberCount`; `get` →
      `GroupDetail` with members; `create`; `update(id, name, memberIds)` replacing membership
      transactionally; `delete` cascading `users_groups`; `referencingAccessRules(id)` for the
      409 check) and its `GroupView`/`GroupDetail` types.
    - _Requirements: 4.1, 4.3, 4.4, 4.6, 4.8, 7.7_ · _Design: GroupRepository_

  - [x] 4.3 Create `api/src/repositories/portal-repository.ts`
    - Implement `PortalRepository` (`list`/`get`/`create`/`update`/`delete` +
      `referencingAccessRules(id)`) and `PortalView`.
    - _Requirements: 6.1, 6.3, 6.5, 6.6, 7.7_ · _Design: PortalRepository_

  - [x] 4.4 Create `api/src/repositories/time-zone-repository.ts`
    - Implement `TimeZoneRepository` (`list`/`get`/`create(name, ranges)`/`update`/`delete`
      cascading `time_ranges` + `referencingAccessRules(id)`) with `TimeZoneView`/
      `TimeRangeView`/`TimeRangeWrite`. Persist ranges using the 7-bit `days` mask; decode to
      weekday-name arrays on read. Ranges write transactionally with the zone.
    - _Requirements: 5.1, 5.5, 5.7, 5.8, 7.7_ · _Design: TimeZoneRepository_

  - [x] 4.5 Create `api/src/repositories/access-rule-repository.ts`
    - Implement `AccessRuleRepository` (`list`/`get`/`create(write)`/`update(id, write)`/
      `delete` cascading association rows only) with `AccessRuleView`/`AccessRuleWrite`;
      association writes are transactional; delete leaves referenced entities intact.
    - _Requirements: 7.1, 7.4, 7.5, 7.6, 7.8_ · _Design: AccessRuleRepository_

  - [x] 4.6 Create `api/src/repositories/access-log-repository.ts`
    - Implement read-only `AccessLogRepository` over `access_logs`: `query(filter)`
      (`userId`/`event`/`from`/`to`, AND-combined, ordered `time` DESC) and `recent(limit)`
      (newest-first). Return the existing all-string `AccessLogRecord` envelope.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.7, 9.2_ · _Design: AccessLogRepository_

  - [x]* 4.7 Unit tests for admin repositories
    - Test membership replacement, cascade-on-delete, `referencingAccessRules` results, mask
      encode/decode on time ranges, and access-log filter/ordering over an ephemeral DB.
    - _Requirements: 14.1_ · _Design: Testing Strategy → Unit_

- [ ] 5. Admin services (validation + referential integrity)
  - [x] 5.1 Create `api/src/services/user-admin-service.ts`
    - `UserAdminService`: registration 1–64 and name 1–128 validation via `validation.ts`,
      PIN→`password`, submitted `groupIds` existence check (400 naming the id), `NotFoundError`
      on unknown id, and photo save/delete orchestration (`setPhoto`, `deletePhoto`) plus
      cascade of memberships and photo file on user delete.
    - _Requirements: 2.1, 2.2, 2.3, 2.6, 2.7, 2.8, 3.1, 3.2, 3.6, 3.7, 4.7_ · _Design: Admin services → UserAdminService_

  - [x] 5.2 Create `api/src/services/group-service.ts`
    - `GroupService`: name validation (400), member-id existence (400 naming invalid id),
      `NotFoundError` (404), and `ConflictError` (409) naming referencing Access Rules when
      deleting a referenced Group.
    - _Requirements: 4.1, 4.2, 4.5, 4.6, 4.7, 4.8, 7.7_ · _Design: Admin services → GroupService_

  - [x] 5.3 Create `api/src/services/time-zone-service.ts`
    - `TimeZoneService`: name validation, per-range validation (`HH:MM`, `start < end`, ≥ 1
      valid weekday) with weekday-name⇄mask encoding, `NotFoundError` (404), and
      `ConflictError` (409) on referenced delete.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 5.8, 7.7_ · _Design: Admin services → TimeZoneService_

  - [x]* 5.4 Property test: Time Range validity
    - **Property 1: Time Range validity** — for any generated `startTime`/`endTime` (valid
      `HH:MM` mixed with noise) and day-name set, `validateTimeRange` accepts iff both times
      are valid `HH:MM`, `start` strictly earlier than `end`, and the day set is non-empty
      over the seven weekdays. Single fast-check test, ≥ 100 iterations, tagged
      `// Feature: admin-management-panel, Property 1`.
    - _Requirements: 5.2, 5.3, 5.4, 14.3_ · _Design: Correctness Properties → Property 1_

  - [x] 5.5 Create `api/src/services/portal-service.ts`
    - `PortalService`: name validation (400), `NotFoundError` (404), `ConflictError` (409) on
      referenced delete.
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.6, 7.7_ · _Design: Admin services → PortalService_

  - [x] 5.6 Create `api/src/services/access-rule-service.ts`
    - `AccessRuleService`: name validation, non-empty group/time-zone/portal sets (400 naming
      the missing association), existence of every referenced id (400 naming the missing
      reference), `NotFoundError` (404); delete leaves referenced entities unchanged.
    - _Requirements: 7.1, 7.2, 7.3, 7.5, 7.6, 7.8_ · _Design: Admin services → AccessRuleService_

  - [x]* 5.7 Property test: Access-rule referential integrity
    - **Property 2: Access-rule referential integrity** — for a random universe of
      Groups/TimeZones/Portals and an Access Rule referencing a non-empty subset of each,
      deleting a referenced entity throws `ConflictError` (→409) and it still exists; deleting
      an unreferenced entity succeeds. Single fast-check test, ≥ 100 iterations, tagged
      `// Feature: admin-management-panel, Property 2`.
    - _Requirements: 7.7, 7.8, 14.4_ · _Design: Correctness Properties → Property 2_

  - [x]* 5.8 Property test: Access-rule composition validity
    - **Property 4: Access-rule composition validity** — for any submitted Access Rule, the
      service creates it iff name is valid (1–128), each id set is non-empty, and every
      referenced id exists; otherwise rejected with 400 and nothing persisted. Single
      fast-check test, ≥ 100 iterations, tagged
      `// Feature: admin-management-panel, Property 4`.
    - _Requirements: 7.1, 7.2, 7.3_ · _Design: Correctness Properties → Property 4_

  - [x] 5.9 Create `api/src/services/dashboard-service.ts`
    - `DashboardService`: aggregate counts of Users/Groups/Access Rules/Portals (zero when
      empty) plus `AccessLogRepository.recent(10)` for the 10 most-recent logs.
    - _Requirements: 9.1, 9.2, 9.3_ · _Design: Admin services → DashboardService_

  - [x]* 5.10 Property test: Group membership round-trip
    - **Property 3: Group membership round-trip** — for any users and any subset chosen as
      members, setting the group membership then reading it back returns exactly that member
      set (order-insensitive), and deleting the group leaves every member user intact. Single
      fast-check test, ≥ 100 iterations, tagged
      `// Feature: admin-management-panel, Property 3`.
    - _Requirements: 4.6, 2.8_ · _Design: Correctness Properties → Property 3_

- [ ] 6. Container wiring and config plumbing
  - [x] 6.1 Add `dataDir` to `ResolvedConfig` in `api/src/composition/bootstrap.ts`
    - Derive a new `dataDir` field from `EMULATOR_DATA_DIR` else `dirname(dbPath)` in
      `resolveConfig`; update `TEST_RESOLVED` in `routes/test-helpers.ts` accordingly.
    - _Requirements: 13.3_ · _Design: Container wiring_

  - [x] 6.2 Extend `buildContainer`/`Container`/`BuildContainerOverrides` in `container.ts`
    - Construct `PhotoStorage` from `resolved.dataDir`; inject it into the upgraded
      `UserRepository` and `UserAdminService`; construct and expose `photos`, `groups`,
      `portals`, `timeZones`, `accessRules`, `userAdmin`, `dashboard`, and read-only
      `accessLogs` on the `Container` interface. Add an optional `photoStorage` seam to
      `BuildContainerOverrides` for in-memory test injection.
    - _Requirements: 13.2, 3.1, 1.1_ · _Design: Container wiring_

- [ ] 7. Admin route registration and per-entity endpoints
  - [ ] 7.1 Create `api/src/routes/admin/admin-routes.ts` shell + multipart + wiring
    - Implement `registerAdminRoutes(app, container, requireSession)`; register
      `@fastify/multipart` scoped here with `limits: { fileSize: 5*1024*1024, files: 1 }`; add
      a positive-integer `:id` param guard (400 naming `id`). Call it from `buildApp` AFTER the
      existing route registrations and BEFORE the awaited `registerStaticAssets`, so the
      error/404 handlers already installed apply. Attach `requireSession` to mutations only;
      reads attach none. Add `@fastify/multipart` (`^9`) to `api/package.json`.
    - _Requirements: 10.2, 10.3, 10.4, 13.2, 3.3_ · _Design: Admin route registration; Endpoint Specification_

  - [ ] 7.2 Implement Users routes (JSON CRUD)
    - `GET/POST /api/admin/users`, `GET/PUT/DELETE /api/admin/users/:id` delegating to
      `container.userAdmin`; 201 on create, 200 on update/delete; 400/401/404 per the spec.
      Thin handlers only.
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 10.2, 10.3_ · _Design: Endpoint Specification → Users_

  - [ ] 7.3 Implement User photo upload/delete routes (multipart)
    - `POST /api/admin/users/:id/photo` reads the single file part, sniffs magic bytes (JPEG
      `FF D8 FF`, PNG `89 50 4E 47`) in addition to the reported mimetype (400 "Accepted
      formats: JPEG, PNG." on mismatch, no file written), maps the multipart
      `FST_REQ_FILE_TOO_LARGE` to 413 with the 5 MB message, confirms the user exists (404),
      then `UserAdminService.setPhoto` → 200. `DELETE /api/admin/users/:id/photo` clears the
      photo → 200.
    - _Requirements: 3.1, 3.2, 3.3, 3.6, 10.2_ · _Design: Photo Upload & Retrieval → Upload/Deletion_

  - [ ] 7.4 Implement Groups routes
    - `GET/POST /api/admin/groups`, `GET/PUT/DELETE /api/admin/groups/:id` delegating to
      `container.groups`; 201/200; 400/401/404 and 409 (referenced) per the spec.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 7.7_ · _Design: Endpoint Specification → Groups_

  - [ ] 7.5 Implement Portals routes
    - `GET/POST /api/admin/portals`, `GET/PUT/DELETE /api/admin/portals/:id` delegating to
      `container.portals`; 201/200; 400/401/404/409 per the spec.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.7_ · _Design: Endpoint Specification → Portals_

  - [ ] 7.6 Implement Time Zones routes
    - `GET/POST /api/admin/time-zones`, `GET/PUT/DELETE /api/admin/time-zones/:id` delegating
      to `container.timeZones`; accepts `{ name, timeRanges: [{ days[], startTime, endTime }] }`;
      201/200; 400/401/404/409 per the spec.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 7.7_ · _Design: Endpoint Specification → Time Zones_

  - [ ] 7.7 Implement Access Rules routes
    - `GET/POST /api/admin/access-rules`, `GET/PUT/DELETE /api/admin/access-rules/:id`
      delegating to `container.accessRules`; 201/200; 400/401/404 per the spec.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.8_ · _Design: Endpoint Specification → Access Rules_

- [ ] 8. Serve stored photos via the existing `user_get_image.fcgi`
  - [ ] 8.1 Upgrade the image handler in `api/src/routes/fcgi/object-routes.ts`
    - Have the existing `userGetImageHandler` obtain bytes + mime via
      `container.users.getImageWithMime` and set the reply content type to the stored mime
      (`image/jpeg`/`image/png`) instead of a fixed `application/octet-stream`; keep the 404
      + `error-description` when no photo is stored, and keep the route shape/auth unchanged.
    - _Requirements: 3.5, 12.1_ · _Design: Photo Upload & Retrieval → Retrieval_

- [ ] 9. Access Logs and Dashboard endpoints
  - [ ] 9.1 Implement Access Logs route
    - `GET /api/admin/access-logs?user_id=&event=&from=&to=` (all optional; accepts ISO date
      or epoch) → 200 newest-first `AccessLogRecord[]`, `[]` when none; 400 naming the invalid
      parameter on a bad filter value. Delegates to `container.accessLogs.query`.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 10.3_ · _Design: Endpoint Specification → Access Logs_

  - [ ] 9.2 Implement Dashboard route
    - `GET /api/admin/dashboard` → `{ counts: { users, groups, accessRules, portals },
      recentLogs }` via `container.dashboard`; open read.
    - _Requirements: 9.1, 9.2, 9.3, 10.3_ · _Design: Endpoint Specification → Dashboard_

  - [ ]* 9.3 Integration tests for admin CRUD, photo round-trip, filters, dashboard, auth
    - Extend `api/src/routes/test-helpers.ts` with an in-memory `photoStorage` override and a
      `loginSession(app)` helper reusing the existing `login`. Add
      `api/src/routes/admin/admin.integration.test.ts` exercising, per entity, CRUD success
      plus 400/401/404 and (Groups/Portals/Time Zones) 409; photo upload (200) → download
      through `user_get_image.fcgi` round-trip, bad-mime 400, and >5 MB 413; access-log filters
      (single/combined/empty/invalid); dashboard counts + recent logs; and 401 on each mutation
      when the session is omitted/expired.
    - _Requirements: 14.2, 2.x, 3.1, 3.2, 3.3, 3.5, 4.x, 5.x, 6.x, 7.x, 8.x, 9.x, 10.2_ · _Design: Testing Strategy → Integration_

- [ ] 10. Checkpoint — backend complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Frontend: hash router + navigation shell
  - [ ] 11.1 Add `useHashRoute` hook and nav shell in `web/src/App.tsx`
    - Add a `useHashRoute` hook over `window.location.hash` with routes `#/dashboard`,
      `#/users`, `#/groups`, `#/time-zones`, `#/access-rules`, `#/portals`, `#/access-logs`,
      `#/simulate`, `#/interception` (default `#/dashboard`); render a persistent sidebar/top-bar
      that lists all nine sections and swaps the section component without a full reload. Keep
      the existing `EventControls`/`InterceptionLog` renders wired unchanged.
    - _Requirements: 11.2, 11.3, 11.4, 12.3, 12.4_ · _Design: Frontend → Navigation and routing_

  - [ ] 11.2 Add admin API clients + reusable UI primitives in `web/src`
    - Extend `web/src/api/client.ts` with `adminUsers`, `adminGroups`, `adminPortals`,
      `adminTimeZones`, `adminAccessRules`, `adminAccessLogs`, `adminDashboard` (same-origin,
      reusing `request<T>`/`ApiError`, appending `?session=` to mutations; a session helper
      that logs in via `POST /login.fcgi` and caches the token). Add reusable
      `ResourceTable.tsx`, `Modal.tsx`, `ErrorBanner.tsx`, `Avatar.tsx`, `TimeRangeEditor.tsx`
      under `web/src/components`.
    - _Requirements: 11.5, 3.4, 10.1_ · _Design: Frontend → API client; Reusable components_

  - [ ] 11.3 Responsive layout in `web/src/index.css`
    - Add mobile-first CSS so at viewport width ≥ 360 px every section's primary controls are
      reachable without horizontal page scrolling; sidebar collapses to a top nav below a small
      breakpoint; wide tables scroll within their own container.
    - _Requirements: 11.6_ · _Design: Frontend → Responsiveness_

- [ ] 12. Frontend sections (one at a time)
  - [ ] 12.1 Portals section (`web/src/components/PortalsSection.tsx` + `PortalForm.tsx`)
    - List/create/edit/delete over `adminPortals`; show `ErrorBanner` on `ApiError` without
      clearing the form.
    - _Requirements: 6.1, 6.3, 6.5, 6.6, 11.3, 11.5_ · _Design: Frontend → Sections_

  - [ ] 12.2 Groups section (`GroupsSection.tsx` + `GroupForm.tsx`)
    - List (with member count), create/edit (member picker), delete; surface 409 message on
      referenced delete.
    - _Requirements: 4.1, 4.3, 4.4, 4.6, 4.8, 11.3, 11.5_ · _Design: Frontend → Sections_

  - [ ] 12.3 Time Zones section (`TimeZonesSection.tsx` + `TimeZoneForm.tsx`)
    - List/create/edit/delete with `TimeRangeEditor` (weekday checkboxes + `HH:MM` inputs);
      surface range/day validation errors inline.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 5.8, 11.3, 11.5_ · _Design: Frontend → Sections_

  - [ ] 12.4 Access Rules section (`AccessRulesSection.tsx` + `AccessRuleForm.tsx`)
    - List/create/edit/delete selecting Groups/Time Zones/Portals; surface empty-set / unknown-
      reference 400 messages inline.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6, 7.8, 11.3, 11.5_ · _Design: Frontend → Sections_

  - [ ] 12.5 Users section (`UsersSection.tsx` + `UserForm.tsx`) with photo + `Avatar`
    - List/create/edit/delete users with group membership; upload/delete Facial_Photo and
      render the stored photo via `Avatar` (`<img src="/user_get_image.fcgi?user_id=...">`);
      surface 400/413 messages inline.
    - _Requirements: 2.1, 2.4, 2.5, 2.7, 2.8, 3.2, 3.3, 3.4, 3.6, 11.3, 11.5_ · _Design: Frontend → Sections; Avatar_

  - [ ] 12.6 Access Logs section (`AccessLogsSection.tsx`)
    - Filterable table (user id / event type / date range) over `adminAccessLogs`, newest-first,
      empty-state handling.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.7, 11.3_ · _Design: Frontend → Sections_

  - [ ] 12.7 Dashboard section (`Dashboard.tsx`)
    - Render aggregate counts and the 10 most-recent Access_Log_Records from
      `GET /api/admin/dashboard`.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 11.3_ · _Design: Frontend → Sections_

  - [ ]* 12.8 Frontend component tests + preserved-section regression
    - Add render/interaction tests for the router shell and a couple of sections (error banner
      retains input on `ApiError`; avatar renders when `hasPhoto`), and confirm the existing
      `EventControls`/`InterceptionLog` component tests still pass unchanged.
    - _Requirements: 11.5, 12.3, 12.4, 12.5, 14.5_ · _Design: Frontend → Preserved sections; Testing Strategy_

- [ ] 13. Packaging, data dir, and documentation
  - [ ]* 13.1 Verify Docker data-dir and image budget
    - Confirm the multi-stage `Dockerfile` builds `web/` into `web/dist`, the container serves
      one port, the photos data dir sits under the persistent volume (`EMULATOR_DATA_DIR` /
      `dirname(EMULATOR_DB_PATH)`), and the final image stays < 200 MB with only
      `@fastify/multipart` added.
    - _Requirements: 13.1, 13.3, 13.5_ · _Design: Design Decisions → Image size budget; Persistence_

  - [ ] 13.2 Update `README.md` with panel usage and documented divergences
    - Document the Admin Panel sections and `/api/admin` surface; and explicitly state: no
      biometric matching (photos stored/displayed/retrieved only), access outcomes come from
      Simulate + stored records not physical sensing, Time Zones/Access Rules/Groups/Portals are
      emulated data structures for building/testing clients, and the Control-iD concept mapping
      (`users`/`groups`/`portals`/`access_rules`/`time_zones`).
    - _Requirements: 15.1, 15.2, 15.3, 15.4_ · _Design: Fidelity Anchor; Requirements Traceability (15)_

  - [ ]* 13.3 Verify CI runs lint + full suite including new tests
    - Confirm `.github/workflows/ci.yml` runs the linter and the full vitest suite (existing +
      new) on push/PR to `main`; no workflow change expected unless the web test step is
      missing.
    - _Requirements: 13.4_ · _Design: Testing Strategy → Regression / CI_

- [ ] 14. Regression — existing emulator suite passes unchanged
  - [ ]* 14.1 Run the full existing test suite and confirm no regressions
    - Run the entire existing suite (`composition/*.test.ts`, `repositories/*.test.ts`,
      `services/*.test.ts`, `routes/**/*.integration.test.ts`, `web/src/**/*.test.tsx`) plus the
      new tests and confirm every existing `.fcgi` route, the Push Engine, the Interception Log,
      and the Simulate section behave unchanged.
    - _Requirements: 12.1, 12.2, 12.5, 14.5_ · _Design: Testing Strategy → Regression_

- [ ] 15. Final checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests / verification-only) and can be skipped for a
  faster MVP; core implementation tasks are never optional.
- Every task references specific requirements and the design component it implements for
  traceability. All 15 requirements are covered: R1 (1.1–1.2), R2 (4.1, 5.1, 7.2), R3 (3.1,
  4.1, 5.1, 7.3, 8.1), R4 (4.2, 5.2, 7.4), R5 (4.4, 5.3, 5.4, 7.6), R6 (4.3, 5.5, 7.5), R7
  (4.2–4.5, 5.2/5.6, 5.7, 5.8, 7.4/7.5/7.7), R8 (4.6, 9.1), R9 (5.9, 9.2), R10 (7.1–7.7),
  R11 (11.1–12.7), R12 (8.1, 11.1, 12.8, 14.1), R13 (6.1, 6.2, 7.1, 13.1, 13.3), R14
  (5.4/5.7/5.8/5.10, 9.3), R15 (13.2).
- Correctness Properties map to tasks: Property 1 → 5.4, Property 2 → 5.7, Property 3 →
  5.10, Property 4 → 5.8. Each is a single fast-check test (≥ 100 iterations) tagged
  `// Feature: admin-management-panel, Property N`.
- Multi-table writes (user+memberships, time zone+ranges, access rule+associations, group
  membership replacement) run inside Drizzle transactions so 400/404/409/413 paths persist
  no change.
- The change is strictly additive: no existing table column, `.fcgi` route, Push Engine,
  Interception Log, or Simulate behavior is altered.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "2.2", "3.1"] },
    { "id": 2, "tasks": ["1.3", "2.3", "3.2", "4.2", "4.3", "4.4", "4.5", "4.6"] },
    { "id": 3, "tasks": ["4.1", "5.2", "5.3", "5.5", "5.6", "5.9"] },
    { "id": 4, "tasks": ["5.1", "5.4", "5.7", "5.8", "5.10", "6.1"] },
    { "id": 5, "tasks": ["4.7", "6.2"] },
    { "id": 6, "tasks": ["7.1"] },
    { "id": 7, "tasks": ["7.2", "7.4", "7.5", "7.6", "7.7", "8.1", "9.1", "9.2"] },
    { "id": 8, "tasks": ["7.3", "11.1", "11.2", "11.3"] },
    { "id": 9, "tasks": ["9.3", "12.1", "12.2", "12.3", "12.4", "12.6", "12.7"] },
    { "id": 10, "tasks": ["12.5"] },
    { "id": 11, "tasks": ["12.8", "13.1", "13.2", "13.3"] },
    { "id": 12, "tasks": ["14.1"] }
  ]
}
```
