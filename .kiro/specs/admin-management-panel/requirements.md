# Requirements Document

## Introduction

The Admin Management Panel is a new feature that extends the existing Control-iD Facial Emulator with a complete, device-style administration experience. Today the emulator exposes a Control-iD-compatible `.fcgi` API, a Push Engine, an Interception Log, and a minimal React + Vite control panel served at `/admin` that offers only a Simulate tab (authorized/denied/keep-alive with an identity picker) and an Interception Log tab.

This feature grows that control panel into a cohesive single-page administration application — modeled on the Control-iD / iDSecure device admin UI — backed by an expanded relational data model and a REST admin API. The panel adds a Dashboard, full CRUD management of Users (including real facial photo upload), Groups, Time Zones (schedules/horários), Access Rules, Portals (doors), and a filterable Access Logs view, while preserving the existing Simulate and Interception Log capabilities. All sections are reachable through navigation inside the same SPA served at `/admin`, and all administrative mutations are protected by a session.

The feature reuses and extends the existing layered architecture (routes → services → repositories → db), the existing Node.js + TypeScript + Fastify stack, SQLite persistence via Drizzle ORM, and the existing CI/CD pipeline, and it must ship inside the same single lightweight container. It must remain consistent with the Control-iD object concepts (`users`, `groups`, `portals`, `access_rules`, `time_zones`) where those concepts apply, using the Official Control-iD API Documentation (https://www.controlid.com.br/docs/access-api-pt/) as the fidelity reference.

This feature is an emulator extension, not a hardware reimplementation. It introduces the following documented divergences from real Control-iD hardware:
- **No biometric matching.** A user's facial photo is uploaded, stored, previewed, and served for display only. The emulator performs no face detection, enrollment, or 1:N matching against the stored image.
- **Synthetic device behavior.** Access outcomes are driven by the Simulate controls and stored records, not by physical sensors.
- **Emulated data structures.** Time zones, access rules, groups, and portals are persisted data structures intended for building and integration-testing client software, not a faithful reproduction of the device's internal access-decision engine.

## Glossary

- **Admin_Panel**: The single-page administration application served at the `/admin` path that provides Dashboard, Users, Groups, Time Zones, Access Rules, Portals, Access Logs, Simulate, and Interception Log sections.
- **Admin_API**: The emulator's own REST surface (under the `/api` path) that the Admin_Panel calls to read and mutate administrative entities. It is distinct from the Control-iD-compatible `.fcgi` compatibility surface.
- **API_Server**: The existing component that exposes the `.fcgi` routes, the Admin_API, and serves the static Admin_Panel assets.
- **Administrator**: A person who operates the Admin_Panel to manage entities and inspect activity.
- **Admin_Session**: An authenticated session, established through the device login/session flow (`login.fcgi` → session token) or a documented equivalent session mechanism, that authorizes Admin_API mutations.
- **Admin_Mutation**: Any Admin_API operation that creates, updates, or deletes an administrative entity (User, Group, Time_Zone, Access_Rule, or Portal).
- **User**: An identity record comprising a numeric id, a registration string, a display name, an optional password/PIN, an optional stored facial photo, and zero or more Group memberships. Extends the existing `users` table (id, registration, name, password, image_path).
- **Registration**: A user-facing enrollment number string that identifies a User for the Administrator.
- **PIN**: An optional numeric or alphanumeric secret stored on a User; persisted in the existing `password` field.
- **Facial_Photo**: A JPG or PNG image associated with a User, stored on disk and referenced by the User's image path, used only for display and for retrieval via `user_get_image.fcgi`. It is never used for biometric matching.
- **Group**: A named collection of Users used to compose Access_Rules. A Group has a numeric id, a name, and zero or more member Users.
- **Time_Zone**: A named weekly schedule (Portuguese: *horário*) with a numeric id, a name, and zero or more Time_Ranges, referenced by Access_Rules to constrain when access applies.
- **Time_Range**: A single interval within a Time_Zone, comprising one or more days of the week and a start time and end time expressed as `HH:MM` in 24-hour format where the start time is strictly earlier than the end time.
- **Day_Of_Week**: One of the seven weekdays (Sunday through Saturday) that a Time_Range applies to.
- **Portal**: A named door or access point that the device controls. A Portal has a numeric id and a name. Extends the existing `portal_id` concept referenced by access log records.
- **Access_Rule**: A composition that associates one or more Groups, one or more Time_Zones, and one or more Portals to express which Users may access which Portals during which schedules. An Access_Rule has a numeric id and a name.
- **Referenced_Entity**: A Group, Time_Zone, or Portal that is referenced by at least one Access_Rule, or a User that is a member of at least one Group.
- **Access_Log_Record**: A record of an access event, in the existing device shape (id, time, event, device_id, identifier_id, user_id, portal_id, identification_rule_id, card_value, log_type_id), reflecting both simulated events and stored records.
- **Access_Event_Type**: A symbolic access outcome — granted (`7`), denied (`6`), not identified (`3`), or REX (`11`) — carried in the `event` field of an Access_Log_Record.
- **Dashboard**: The Admin_Panel section that presents aggregate counts of Users, Groups, Access_Rules, and Portals together with the most recent Access_Log_Records.
- **Simulate_Section**: The existing Admin_Panel capability that triggers simulated authorized, denied, and keep-alive events with an identity picker, preserved by this feature.
- **Interception_Log**: The existing persisted collection of recorded inbound requests and outbound webhook records, preserved by this feature.
- **Existing_Emulator_Behavior**: The behavior implemented prior to this feature, comprising the `.fcgi` API surface, the Push Engine, the Interception Log, and the Simulate_Section.
- **Official_API_Documentation**: The Control-iD access control API documentation published at https://www.controlid.com.br/docs/access-api-pt/, used as the fidelity reference for object concepts and endpoint shapes.
- **Container_Image**: The single Docker image that packages the emulator, including the Admin_Panel and Admin_API.

## Requirements

### Requirement 1: Expanded Data Model and Entity Relationships

**User Story:** As an Administrator, I want the emulator to persist Users, Groups, Time Zones, Access Rules, and Portals with their relationships, so that I can model a complete access-control configuration.

#### Acceptance Criteria

1. THE Admin_API SHALL persist User, Group, Time_Zone, Time_Range, Access_Rule, and Portal entities in the existing SQLite database via the Drizzle ORM.
2. THE Admin_API SHALL represent Group membership as a many-to-many relationship in which one User belongs to zero or more Groups and one Group contains zero or more Users.
3. THE Admin_API SHALL represent each Access_Rule as a composition that references one or more Groups, one or more Time_Zones, and one or more Portals.
4. THE Admin_API SHALL represent each Time_Zone as containing zero or more Time_Ranges, where each Time_Range references one or more Day_Of_Week values and a start time and an end time.
5. THE Admin_API SHALL extend the existing `users` table rather than replacing it, preserving the existing fields id, registration, name, password, and image_path.
6. WHEN the emulator starts and any table required by the expanded data model is absent, THE Admin_API SHALL create the missing tables before accepting any Admin_API request.
7. THE Admin_API SHALL assign each newly created User, Group, Time_Zone, Access_Rule, and Portal a numeric identifier that is unique within its entity type.

### Requirement 2: User Management CRUD

**User Story:** As an Administrator, I want to create, list, view, update, and delete Users, so that I can manage the identities the emulator knows about.

#### Acceptance Criteria

1. WHEN an Administrator submits a create-User request over an authenticated Admin_Session with a non-empty registration string of 1 to 64 characters and a non-empty name string of 1 to 128 characters, THE Admin_API SHALL create a User, assign it a unique numeric id, and return the created User with an HTTP status code of 201.
2. WHEN an Administrator submits a create-User or update-User request that includes a PIN, THE Admin_API SHALL store the PIN in the User's password field.
3. IF an Administrator submits a create-User or update-User request with a missing registration, an empty registration, a missing name, an empty name, a registration longer than 64 characters, or a name longer than 128 characters, THEN THE Admin_API SHALL reject the request with an HTTP status code of 400, return an error-description field identifying the invalid field, and persist no change.
4. WHEN an Administrator requests the list of Users, THE Admin_API SHALL return a collection of all Users, each including its id, registration, name, whether a Facial_Photo is present, and its Group memberships.
5. WHEN an Administrator requests a single User by an id that exists, THE Admin_API SHALL return that User including its Group memberships within 2000 milliseconds.
6. IF an Administrator requests, updates, or deletes a User by an id that does not exist, THEN THE Admin_API SHALL respond with an HTTP status code of 404 and an error-description field, and persist no change.
7. WHEN an Administrator submits an update-User request over an authenticated Admin_Session for an existing User with valid fields, THE Admin_API SHALL replace the User's registration, name, PIN, and Group memberships with the submitted values and return the updated User with an HTTP status code of 200.
8. WHEN an Administrator submits a delete-User request over an authenticated Admin_Session for an existing User, THE Admin_API SHALL delete the User, remove that User from every Group it belonged to, and return an HTTP status code of 200.

### Requirement 3: Facial Photo Upload and Retrieval

**User Story:** As an Administrator, I want to upload a real facial photo for a User and see it as the avatar, so that identities are visually recognizable, while understanding the emulator does not perform biometric matching.

#### Acceptance Criteria

1. WHEN an Administrator uploads a Facial_Photo for an existing User over an authenticated Admin_Session with a file whose format is JPEG or PNG and whose size does not exceed 5 megabytes, THE Admin_API SHALL store the file, set the User's image path to reference the stored file, and return an HTTP status code of 200.
2. IF an Administrator uploads a Facial_Photo whose format is neither JPEG nor PNG, THEN THE Admin_API SHALL reject the upload with an HTTP status code of 400, return an error-description field indicating the accepted formats, and store no file.
3. IF an Administrator uploads a Facial_Photo whose size exceeds 5 megabytes, THEN THE Admin_API SHALL reject the upload with an HTTP status code of 413, return an error-description field indicating the size limit, and store no file.
4. WHEN a Facial_Photo has been stored for a User, THE Admin_Panel SHALL display that Facial_Photo as the User's avatar in the Users section.
5. WHEN an Integrating client or the Admin_Panel requests a User's image via the existing `user_get_image.fcgi` endpoint for a User that has a stored Facial_Photo, THE API_Server SHALL return the stored image bytes with a content type matching the stored image format.
6. WHEN an Administrator deletes a User's Facial_Photo over an authenticated Admin_Session, THE Admin_API SHALL remove the stored file, clear the User's image path, and return an HTTP status code of 200.
7. WHEN a User that has a stored Facial_Photo is deleted, THE Admin_API SHALL remove the stored Facial_Photo file associated with that User.
8. THE Admin_API SHALL NOT perform biometric detection, enrollment, or matching on any stored Facial_Photo, and SHALL use each Facial_Photo only for storage, display, and retrieval.

### Requirement 4: Group Management CRUD

**User Story:** As an Administrator, I want to create, list, view, update, and delete Groups and manage their members, so that I can organize Users for access rules.

#### Acceptance Criteria

1. WHEN an Administrator submits a create-Group request over an authenticated Admin_Session with a non-empty name string of 1 to 128 characters, THE Admin_API SHALL create a Group, assign it a unique numeric id, and return the created Group with an HTTP status code of 201.
2. IF an Administrator submits a create-Group or update-Group request with a missing name, an empty name, or a name longer than 128 characters, THEN THE Admin_API SHALL reject the request with an HTTP status code of 400, return an error-description field identifying the invalid field, and persist no change.
3. WHEN an Administrator requests the list of Groups, THE Admin_API SHALL return a collection of all Groups, each including its id, name, and member count.
4. WHEN an Administrator requests a single Group by an id that exists, THE Admin_API SHALL return that Group including the list of its member Users.
5. IF an Administrator requests, updates, or deletes a Group by an id that does not exist, THEN THE Admin_API SHALL respond with an HTTP status code of 404 and an error-description field, and persist no change.
6. WHEN an Administrator submits an update-Group request over an authenticated Admin_Session that sets the Group's members to a list of User ids that all exist, THE Admin_API SHALL replace the Group's membership with exactly those Users and return the updated Group with an HTTP status code of 200.
7. IF an Administrator submits a Group membership that includes a User id that does not exist, THEN THE Admin_API SHALL reject the request with an HTTP status code of 400, return an error-description field identifying the invalid User id, and persist no change.
8. WHEN an Administrator deletes a Group that is not referenced by any Access_Rule over an authenticated Admin_Session, THE Admin_API SHALL delete the Group, remove its membership associations, and return an HTTP status code of 200.

### Requirement 5: Time Zone and Weekly Schedule Management

**User Story:** As an Administrator, I want to define named Time Zones with weekly time ranges, so that access rules can restrict access to specific days and hours.

#### Acceptance Criteria

1. WHEN an Administrator submits a create-Time_Zone request over an authenticated Admin_Session with a non-empty name string of 1 to 128 characters and zero or more valid Time_Ranges, THE Admin_API SHALL create the Time_Zone, assign it a unique numeric id, persist its Time_Ranges, and return the created Time_Zone with an HTTP status code of 201.
2. WHEN an Administrator submits a Time_Range, THE Admin_API SHALL accept the Time_Range only if its start time and end time each match the 24-hour `HH:MM` format where hours are 00 to 23 and minutes are 00 to 59.
3. IF an Administrator submits a Time_Range whose start time is not strictly earlier than its end time, THEN THE Admin_API SHALL reject the request with an HTTP status code of 400, return an error-description field indicating the invalid range, and persist no change.
4. IF an Administrator submits a Time_Range that references no Day_Of_Week, or references a value that is not one of the seven weekdays, THEN THE Admin_API SHALL reject the request with an HTTP status code of 400, return an error-description field identifying the invalid day value, and persist no change.
5. WHEN an Administrator requests the list of Time_Zones, THE Admin_API SHALL return a collection of all Time_Zones, each including its id, name, and Time_Ranges.
6. IF an Administrator requests, updates, or deletes a Time_Zone by an id that does not exist, THEN THE Admin_API SHALL respond with an HTTP status code of 404 and an error-description field, and persist no change.
7. WHEN an Administrator submits an update-Time_Zone request over an authenticated Admin_Session with a valid name and valid Time_Ranges, THE Admin_API SHALL replace the Time_Zone's name and Time_Ranges with the submitted values and return the updated Time_Zone with an HTTP status code of 200.
8. WHEN an Administrator deletes a Time_Zone that is not referenced by any Access_Rule over an authenticated Admin_Session, THE Admin_API SHALL delete the Time_Zone, remove its Time_Ranges, and return an HTTP status code of 200.

### Requirement 6: Portal Management CRUD

**User Story:** As an Administrator, I want to create, list, view, update, and delete Portals, so that I can model the doors the device controls.

#### Acceptance Criteria

1. WHEN an Administrator submits a create-Portal request over an authenticated Admin_Session with a non-empty name string of 1 to 128 characters, THE Admin_API SHALL create a Portal, assign it a unique numeric id, and return the created Portal with an HTTP status code of 201.
2. IF an Administrator submits a create-Portal or update-Portal request with a missing name, an empty name, or a name longer than 128 characters, THEN THE Admin_API SHALL reject the request with an HTTP status code of 400, return an error-description field identifying the invalid field, and persist no change.
3. WHEN an Administrator requests the list of Portals, THE Admin_API SHALL return a collection of all Portals, each including its id and name.
4. IF an Administrator requests, updates, or deletes a Portal by an id that does not exist, THEN THE Admin_API SHALL respond with an HTTP status code of 404 and an error-description field, and persist no change.
5. WHEN an Administrator submits an update-Portal request over an authenticated Admin_Session for an existing Portal with a valid name, THE Admin_API SHALL replace the Portal's name with the submitted value and return the updated Portal with an HTTP status code of 200.
6. WHEN an Administrator deletes a Portal that is not referenced by any Access_Rule over an authenticated Admin_Session, THE Admin_API SHALL delete the Portal and return an HTTP status code of 200.

### Requirement 7: Access Rule Composition and Referential Integrity

**User Story:** As an Administrator, I want to compose Access Rules from Groups, Time Zones, and Portals, so that I can express who may access which doors during which schedules.

#### Acceptance Criteria

1. WHEN an Administrator submits a create-Access_Rule request over an authenticated Admin_Session with a non-empty name string of 1 to 128 characters and at least one existing Group id, at least one existing Time_Zone id, and at least one existing Portal id, THE Admin_API SHALL create the Access_Rule, assign it a unique numeric id, and return the created Access_Rule with an HTTP status code of 201.
2. IF an Administrator submits a create-Access_Rule or update-Access_Rule request that references a Group id, Time_Zone id, or Portal id that does not exist, THEN THE Admin_API SHALL reject the request with an HTTP status code of 400, return an error-description field identifying the missing reference, and persist no change.
3. IF an Administrator submits a create-Access_Rule or update-Access_Rule request that references zero Groups, zero Time_Zones, or zero Portals, THEN THE Admin_API SHALL reject the request with an HTTP status code of 400, return an error-description field identifying the missing association, and persist no change.
4. WHEN an Administrator requests the list of Access_Rules, THE Admin_API SHALL return a collection of all Access_Rules, each including its id, name, and the ids of its associated Groups, Time_Zones, and Portals.
5. IF an Administrator requests, updates, or deletes an Access_Rule by an id that does not exist, THEN THE Admin_API SHALL respond with an HTTP status code of 404 and an error-description field, and persist no change.
6. WHEN an Administrator submits an update-Access_Rule request over an authenticated Admin_Session with a valid name and valid existing references, THE Admin_API SHALL replace the Access_Rule's name and its Group, Time_Zone, and Portal associations with the submitted values and return the updated Access_Rule with an HTTP status code of 200.
7. IF an Administrator attempts to delete a Group, Time_Zone, or Portal that is referenced by at least one Access_Rule, THEN THE Admin_API SHALL reject the deletion with an HTTP status code of 409, return an error-description field identifying the referencing Access_Rules, and persist no change.
8. WHEN an Administrator deletes an Access_Rule over an authenticated Admin_Session, THE Admin_API SHALL delete the Access_Rule and its associations to Groups, Time_Zones, and Portals, and SHALL leave the referenced Groups, Time_Zones, and Portals unchanged.

### Requirement 8: Access Logs View and Filtering

**User Story:** As an Administrator, I want to view and filter access logs, so that I can inspect simulated and recorded access events.

#### Acceptance Criteria

1. WHEN an Administrator requests the Access_Log_Records, THE Admin_API SHALL return a collection of Access_Log_Records ordered by their time field from most recent to oldest.
2. WHEN an Administrator requests Access_Log_Records filtered by a User id, THE Admin_API SHALL return only records whose user_id equals the supplied User id.
3. WHEN an Administrator requests Access_Log_Records filtered by an Access_Event_Type, THE Admin_API SHALL return only records whose event field equals the supplied event code.
4. WHEN an Administrator requests Access_Log_Records filtered by a start date and an end date, THE Admin_API SHALL return only records whose time falls within the inclusive range bounded by the start date and the end date.
5. WHEN an Administrator supplies more than one filter parameter, THE Admin_API SHALL return only records that satisfy every supplied filter parameter.
6. IF an Administrator supplies a filter parameter whose value fails validation, THEN THE Admin_API SHALL respond with an HTTP status code of 400, return no records, and include an error-description field identifying the invalid parameter.
7. WHEN an Administrator requests Access_Log_Records and no records match the supplied filters, THE Admin_API SHALL respond with an HTTP status code of 200 and an empty collection.

### Requirement 9: Dashboard Aggregation

**User Story:** As an Administrator, I want a dashboard overview, so that I can see the state of the emulator at a glance.

#### Acceptance Criteria

1. WHEN an Administrator opens the Dashboard, THE Admin_API SHALL return the total count of Users, the total count of Groups, the total count of Access_Rules, and the total count of Portals.
2. WHEN an Administrator opens the Dashboard, THE Admin_API SHALL return the 10 most recent Access_Log_Records ordered by time from most recent to oldest.
3. WHEN the Dashboard requests aggregate counts and an entity type has zero records, THE Admin_API SHALL return a count of zero for that entity type.
4. WHEN an Administrator opens the Dashboard, THE Admin_Panel SHALL display the aggregate counts and the recent Access_Log_Records within 2000 milliseconds of receiving the Admin_API response.

### Requirement 10: Admin Session and Authorization

**User Story:** As an Administrator, I want administrative changes to require a session, so that the emulator's configuration is not modified without authentication.

#### Acceptance Criteria

1. WHEN an Administrator authenticates through the device login flow at `login.fcgi` with valid credentials, THE API_Server SHALL issue a session token that authorizes subsequent Admin_Mutation requests.
2. IF an Administrator submits an Admin_Mutation with no session token, an empty session token, a malformed session token, or a session token whose validity duration of 3600 seconds since issuance has elapsed, THEN THE Admin_API SHALL reject the request with an HTTP status code of 401 and persist no change.
3. WHEN an Administrator submits an Admin_API read request that lists or reads entities, the Dashboard, or Access_Log_Records, THE Admin_API SHALL process the request without requiring a session token.
4. WHEN an Administrator submits an Admin_Mutation with a session token that matches a token issued by a prior successful login and has not exceeded its 3600-second validity duration, THE Admin_API SHALL process the request.
5. WHERE the emulator is configured with a documented simple-session mechanism instead of the device login flow, THE Admin_API SHALL require that same documented session mechanism to authorize every Admin_Mutation.

### Requirement 11: Cohesive Single-Page Navigation

**User Story:** As an Administrator, I want to move between all administration sections in one application, so that I can manage the emulator without switching tools.

#### Acceptance Criteria

1. WHEN an Administrator navigates to the `/admin` path, THE API_Server SHALL serve the Admin_Panel application and return the rendered page within 2000 milliseconds.
2. THE Admin_Panel SHALL present navigation controls that reach the Dashboard, Users, Groups, Time_Zones, Access_Rules, Portals, Access_Logs, Simulate_Section, and Interception_Log sections.
3. WHEN an Administrator selects a navigation control, THE Admin_Panel SHALL display the corresponding section within 2000 milliseconds without a full page reload.
4. IF an Administrator navigates to a path under `/admin` that does not correspond to an existing static asset, THEN THE API_Server SHALL serve the Admin_Panel application entry point so client-side routing can resolve the path.
5. IF an Admin_API request initiated from the Admin_Panel returns an error response or fails to complete, THEN THE Admin_Panel SHALL display a visible message indicating the failure and SHALL retain the Administrator's current input without resubmitting the request.
6. WHERE an Administrator views the Admin_Panel on a viewport width of 360 pixels or greater, THE Admin_Panel SHALL present every section's primary controls without horizontal scrolling of the page.

### Requirement 12: Preservation of Existing Emulator Behavior

**User Story:** As a Developer, I want the existing emulator features to keep working, so that adding the admin panel does not break my current integrations.

#### Acceptance Criteria

1. WHEN the emulator serves the Admin_Panel and Admin_API, THE API_Server SHALL continue to expose every existing `.fcgi` endpoint with unchanged request and response shapes.
2. WHEN a Simulated access event is initiated from the Simulate_Section, THE Push Engine SHALL dispatch the corresponding webhook exactly as it did before this feature.
3. THE Simulate_Section SHALL continue to present controls for authorized, denied, and keep-alive events with an identity selection input populated from the current list of Users.
4. WHEN an Administrator opens the Interception_Log section, THE Admin_Panel SHALL display recorded inbound requests and outbound webhook records exactly as it did before this feature.
5. WHEN this feature is delivered, THE Existing_Emulator_Behavior SHALL remain covered by its existing passing automated tests.

### Requirement 13: Single-Container Packaging and Layered Architecture

**User Story:** As a maintainer, I want the admin panel to fit the existing deployment and architecture, so that maintainability and distribution are preserved.

#### Acceptance Criteria

1. THE Container_Image SHALL serve the Admin_Panel, the Admin_API, and the existing `.fcgi` endpoints from a single running container listening on one exposed TCP port.
2. THE Admin_API SHALL implement its logic in the existing layered architecture such that HTTP routing, business-logic services, data repositories, and database access remain in separate layers.
3. WHERE the emulator is running in Persistent_Mode, THE Admin_API SHALL retain all administrative entities and stored Facial_Photos across a container restart.
4. WHEN a commit is pushed to the main branch or a pull request targeting the main branch is opened, THE existing CI pipeline SHALL run the project linter and the automated test suite, including the tests added for this feature.
5. THE feature SHALL NOT increase the final Container_Image size beyond 200 MB.

### Requirement 14: Testing and Validation Coverage

**User Story:** As a maintainer, I want the admin panel covered by tests, so that its behavior is verified and regressions are caught.

#### Acceptance Criteria

1. THE feature SHALL provide unit tests that verify entity validation rules for Users, Groups, Time_Zones, Access_Rules, and Portals, including field-length limits and required fields.
2. THE feature SHALL provide integration tests that exercise the Admin_API CRUD endpoints for each managed entity, including success responses and the 400, 401, 404, 409, and 413 error responses defined in these requirements.
3. THE feature SHALL provide property-based tests for the Time_Range validation invariants, verifying that only `HH:MM` values with a start time strictly earlier than the end time and at least one valid Day_Of_Week are accepted.
4. THE feature SHALL provide property-based tests for the Access_Rule referential-integrity invariants, verifying that deleting a Referenced_Entity is rejected while deleting an unreferenced entity succeeds.
5. THE feature SHALL provide tests that confirm the Existing_Emulator_Behavior continues to pass after the feature is added.

### Requirement 15: Documented Divergences from Real Hardware

**User Story:** As a Developer, I want the emulator's divergences from real hardware documented, so that I can distinguish emulated behavior from device behavior.

#### Acceptance Criteria

1. THE project documentation SHALL state that the emulator performs no biometric matching and that a Facial_Photo is stored, displayed, and retrieved only.
2. THE project documentation SHALL state that access outcomes are produced by the Simulate_Section and stored records rather than by physical sensing.
3. THE project documentation SHALL state that Time_Zones, Access_Rules, Groups, and Portals are emulated data structures intended for building and integration-testing client software.
4. WHERE an Admin_API concept corresponds to a Control-iD object concept in the Official_API_Documentation, THE project documentation SHALL identify the correspondence so a reader can relate the emulated entity to the reference concept.
