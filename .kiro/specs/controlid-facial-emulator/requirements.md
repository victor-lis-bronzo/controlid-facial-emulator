# Requirements Document

## Introduction

The Control-iD Facial Emulator is an open-source, "plug and play" service that simulates the behavior of Control-iD facial access control readers. It is intended to let developers integrate against a Control-iD-compatible device without physical hardware, by faithfully reproducing the device's HTTP (`.fcgi`) REST API, its configuration persistence, and its proactive Push/webhook communication.

The emulator ships as a single lightweight Docker container that serves both a REST API and a static web-based control panel. The control panel lets a developer trigger simulated access events (authorized, denied, keep-alive) and inspect an interception log of received requests and dispatched webhooks, removing the need for external tools such as Postman to drive the emulator. Configuration submitted by integrating clients (for example, the push server target) is persisted so that subsequent webhooks are dispatched to the most recently configured destination.

The project targets senior-level demonstration of architecture, integration fidelity, and Developer Experience (DX), and is distributed as source on GitHub and as a versioned image on Docker Hub, supported by an automated CI/CD pipeline.

The intended technology direction is Node.js with TypeScript and the Fastify HTTP framework, SQLite persistence via the Drizzle ORM, and a React + Vite control panel served as a static build. Requirements below are stated in a solution-agnostic manner where the behavior does not depend on that stack, and reference the stack explicitly only where distribution and DX outcomes require it.

## Glossary

- **Emulator**: The overall software service that simulates a Control-iD facial access reader, comprising the API Server, the Push Engine, the Control Panel, and the Interception Logger.
- **API Server**: The component that exposes Control-iD-compatible HTTP endpoints (`.fcgi` routes) and serves the static Control Panel assets.
- **FCGI_Endpoint**: An individual Control-iD-compatible HTTP route that terminates in the `.fcgi` suffix (for example, `/login.fcgi`, `/set_configuration.fcgi`).
- **Push_Engine**: The component that dispatches outbound HTTP POST webhooks that mirror a real reader's proactive communication when an access event is simulated.
- **Push_Target**: The destination server URL to which the Push_Engine dispatches webhooks, as configured by an integrating client.
- **Control_Panel**: The web-based user interface served at the `/admin` path that lets a developer trigger simulated events and view the Interception Log.
- **Interception_Logger**: The component that records inbound requests received by the API Server and outbound webhook payloads dispatched by the Push_Engine.
- **Interception_Log**: The persisted, queryable collection of recorded inbound requests and outbound webhook records maintained by the Interception_Logger.
- **Configuration_Store**: The persistent data store that holds emulator configuration, including the Push_Target.
- **Persistent_Mode**: An operating mode in which the Configuration_Store and Interception_Log are retained across container restarts by using a mounted storage volume.
- **Ephemeral_Mode**: An operating mode in which the Configuration_Store and Interception_Log are held in a location that is discarded when the container stops, intended for continuous integration pipelines.
- **Simulated_Access_Event**: A developer-initiated action representing a person presenting a face to the reader, which the Emulator processes and reports via the Push_Engine.
- **Integrating_Client**: A third-party system or developer tool that communicates with the API Server as if it were a physical Control-iD reader.
- **Developer**: A person who operates the Emulator through the Control_Panel or the API Server for the purpose of building or testing an integration.
- **Official_API_Documentation**: The Control-iD access control API documentation published at https://www.controlid.com.br/docs/access-api-pt/, used as the fidelity reference.
- **Container_Image**: The Docker image that packages the Emulator for distribution.
- **CI_Pipeline**: The automated workflow that lints and tests the source on changes to the main branch.
- **CD_Pipeline**: The automated workflow that builds and publishes the Container_Image and creates a versioned release on tag creation.

## Requirements

### Requirement 1: Control-iD Compatible API Surface

**User Story:** As a Developer, I want the Emulator to expose Control-iD-compatible `.fcgi` endpoints, so that I can point an existing integration at the Emulator without changing client code.

#### Acceptance Criteria

1. THE API_Server SHALL expose HTTP endpoints whose paths end with the `.fcgi` suffix, and whose HTTP methods and request body field names match the corresponding endpoints described in the Official_API_Documentation exactly (case-sensitive path and field-name matching).
2. WHEN an Integrating_Client sends a request to a supported FCGI_Endpoint, THE API_Server SHALL return a response whose field names and JSON structure match the corresponding response described in the Official_API_Documentation, with the response `Content-Type` header set to `application/json`.
3. WHEN an Integrating_Client sends a request to a supported FCGI_Endpoint with a body that conforms to the field names and types described in the Official_API_Documentation, THE API_Server SHALL respond with an HTTP status code of 200 within 500 milliseconds.
4. IF an Integrating_Client sends a request to a supported FCGI_Endpoint with a body that is not valid JSON, is missing a required field, or contains a field whose type differs from the type described in the Official_API_Documentation, THEN THE API_Server SHALL respond with an HTTP status code of 400 and a JSON response body containing an error-description field indicating which validation rule failed, without persisting any state change.
5. IF an Integrating_Client sends a request to an endpoint path not listed in the Official_API_Documentation, THEN THE API_Server SHALL respond with an HTTP status code of 404 and a JSON response body containing an error-description field, without persisting any state change.
6. IF an Integrating_Client sends a request to a supported FCGI_Endpoint using an HTTP method that does not match the method described for that endpoint in the Official_API_Documentation, THEN THE API_Server SHALL respond with an HTTP status code of 405.

### Requirement 2: Session and Authentication Emulation

**User Story:** As a Developer, I want the Emulator to emulate the device login and session flow, so that clients that authenticate before issuing commands behave the same against the Emulator as against a real reader.

#### Acceptance Criteria

1. WHEN an Integrating_Client sends a login request containing a username no longer than 64 characters and a password no longer than 64 characters to the login FCGI_Endpoint, THE API_Server SHALL respond within 1000 milliseconds with a success response containing a non-empty session token string as described in the Official_API_Documentation.
2. IF an Integrating_Client sends a login request with a username or password that does not match the configured credentials, THEN THE API_Server SHALL reject the request with an HTTP status code of 401, SHALL NOT return a session token, and SHALL return a response body indicating authentication failure.
3. IF an Integrating_Client sends a login request that is missing the username field, the password field, or both, THEN THE API_Server SHALL reject the request with an HTTP status code of 400 and SHALL return a response body indicating which required field is missing.
4. WHEN an Integrating_Client includes a session token in a request to a protected FCGI_Endpoint, and that token matches a token issued by a prior successful login and has not exceeded its validity duration of 3600 seconds since issuance, THE API_Server SHALL process the request and respond within 1000 milliseconds.
5. IF an Integrating_Client sends a request to a protected FCGI_Endpoint with no session token, an empty session token, a malformed session token, or a session token whose validity duration of 3600 seconds since issuance has elapsed, THEN THE API_Server SHALL reject the request with an HTTP status code of 401 and SHALL NOT process the requested command.

### Requirement 3: Configuration Persistence

**User Story:** As a Developer, I want configuration submitted by a client to be stored durably, so that the Emulator continues to behave according to the most recent configuration.

#### Acceptance Criteria

1. WHEN an Integrating_Client sends a configuration change containing one or more valid configuration key-value pairs to the configuration FCGI_Endpoint, THE API_Server SHALL write each submitted configuration value to the Configuration_Store and return a success response within 2000 milliseconds.
2. IF an Integrating_Client sends a configuration change in which any key is not a recognized configuration key or any value fails type or range validation, THEN THE API_Server SHALL reject the entire request, leave all values in the Configuration_Store unchanged, and return a response indicating a validation error identifying the rejected key.
3. WHEN an Integrating_Client requests the current configuration from the configuration FCGI_Endpoint, THE API_Server SHALL return the values most recently written to the Configuration_Store for all recognized configuration keys within 2000 milliseconds.
4. WHEN an Integrating_Client requests the current configuration and no value has been written for a recognized configuration key, THE API_Server SHALL return that key with its documented default value.
5. WHEN an Integrating_Client submits a configuration change that sets the Push_Target to a non-empty string of 1 to 2048 characters, THE API_Server SHALL persist the new Push_Target value to the Configuration_Store, replacing any previously stored Push_Target value.
6. WHEN a configuration change is submitted for a recognized configuration key that already holds a value, THE API_Server SHALL replace the stored value with the submitted value so that a subsequent read returns only the submitted value.
7. WHERE the Emulator is running in Persistent_Mode, THE Configuration_Store SHALL retain all stored configuration values across a container restart such that a read issued after restart returns the same values written before the restart.
8. WHERE the Emulator is not running in Persistent_Mode, WHEN the container restarts, THE Configuration_Store SHALL return the documented default value for every recognized configuration key.

### Requirement 4: Mock Log and Biometry Endpoints

**User Story:** As a Developer, I want the Emulator to answer log-query and biometry requests with structured data, so that I can exercise the parts of my integration that read records and enrollment data.

#### Acceptance Criteria

1. WHEN an Integrating_Client sends a log-query request to the corresponding FCGI_Endpoint, THE API_Server SHALL respond with an HTTP status code of 200 and a collection of access log records structured according to the Official_API_Documentation within 2000 milliseconds.
2. WHEN an Integrating_Client sends a log-query request and no records exist or no records match the supplied filters, THE API_Server SHALL respond with an HTTP status code of 200 and an empty collection.
3. WHEN an Integrating_Client sends a biometry request to the corresponding FCGI_Endpoint, THE API_Server SHALL respond with an HTTP status code of 200 and biometry data structured according to the Official_API_Documentation within 2000 milliseconds.
4. WHEN an Integrating_Client sends a log-query request that includes one or more filter parameters described in the Official_API_Documentation, THE API_Server SHALL return only records for which every supplied filter parameter matches.
5. IF an Integrating_Client sends a log-query or biometry request with a filter parameter that is unrecognized or whose value fails validation, THEN THE API_Server SHALL respond with an HTTP status code of 400, return no records, and include an error-description field identifying the invalid parameter.

### Requirement 5: Push and Webhook Dispatch Engine

**User Story:** As a Developer, I want the Emulator to dispatch webhooks to my configured server when an access is simulated, so that I can observe how my system reacts to reader events.

#### Acceptance Criteria

1. WHEN a Simulated_Access_Event is initiated, THE Push_Engine SHALL read the Push_Target from the Configuration_Store before dispatching a webhook.
2. WHEN the Push_Engine dispatches a webhook for a Simulated_Access_Event, THE Push_Engine SHALL send an HTTP POST request to the Push_Target and treat an HTTP response status code in the range 200 to 299 as a successful dispatch.
3. WHEN the Push_Engine dispatches a webhook, THE Push_Engine SHALL include a payload whose structure and field names match the reader event payload described in the Official_API_Documentation.
4. WHEN the Push_Target is changed and a subsequent Simulated_Access_Event is initiated, THE Push_Engine SHALL dispatch the webhook to the most recently stored Push_Target.
5. IF no Push_Target is present in the Configuration_Store when a Simulated_Access_Event is initiated, THEN THE Push_Engine SHALL record the event in the Interception_Log with an indication that no Push_Target is configured and SHALL not attempt an HTTP POST request.
6. WHEN the Push_Engine sends an HTTP POST request to the Push_Target, THE Push_Engine SHALL wait a maximum of 10 seconds for a response before treating the request as timed out.
7. IF the Push_Target does not return a response within the 10-second timeout, THEN THE Push_Engine SHALL retry the HTTP POST request up to 3 additional times using a fixed interval of 5 seconds between attempts.
8. IF the Push_Target is unreachable, times out, or returns a response status code outside the range 200 to 299 after all retry attempts are exhausted, THEN THE Push_Engine SHALL record the failed dispatch in the Interception_Log with the Push_Target, the final response status code or timeout indication, and the total number of attempts made.

### Requirement 6: Simulated Access Events

**User Story:** As a Developer, I want to simulate authorized access, denied access, and keep-alive events, so that I can drive my integration through its full range of reader-originated scenarios.

#### Acceptance Criteria

1. WHEN a Developer initiates a Simulated_Access_Event of type authorized access for a selected identity, THE Push_Engine SHALL dispatch a webhook payload conforming to the authorized-identification structure defined in the Official_API_Documentation, including the selected identity's identifier, to the configured webhook destination.
2. WHEN a Developer initiates a Simulated_Access_Event of type denied access, THE Push_Engine SHALL dispatch a webhook payload conforming to the denied-identification structure defined in the Official_API_Documentation to the configured webhook destination.
3. WHEN a Developer initiates a keep-alive event, THE Push_Engine SHALL dispatch a webhook payload conforming to the device keep-alive message structure defined in the Official_API_Documentation to the configured webhook destination.
4. THE Push_Engine SHALL complete dispatch of each Simulated_Access_Event webhook payload within 2 seconds of the Developer initiating the event.
5. IF the configured webhook destination is unreachable or returns a response outside the 200-299 success range when dispatching a Simulated_Access_Event, THEN THE Push_Engine SHALL retry dispatch up to 3 times and, if all attempts fail, present an error indication to the Developer identifying the failed event while preserving the Developer's selected identity and event configuration.
6. IF a Developer initiates a Simulated_Access_Event of type authorized access without a selected identity, THEN THE Push_Engine SHALL reject the event, dispatch no webhook payload, and present an error indication that an identity must be selected.

### Requirement 7: Web Control Panel

**User Story:** As a Developer, I want a web control panel served by the Emulator, so that I can trigger events and inspect activity without an external HTTP client.

#### Acceptance Criteria

1. WHEN a Developer navigates to the `/admin` path, THE API_Server SHALL serve the static Control_Panel application and return the rendered page within 2000 milliseconds.
2. IF a Developer navigates to a path under `/admin` that does not correspond to an existing static asset, THEN THE API_Server SHALL serve the Control_Panel application entry point so client-side routing can resolve the path.
3. THE Control_Panel SHALL present a control to initiate a Simulated_Access_Event of type authorized access, including a selection input that lists at least one selectable identity and requires a single identity to be selected before the control can be activated.
4. THE Control_Panel SHALL present a control to initiate a Simulated_Access_Event of type denied access.
5. THE Control_Panel SHALL present a control to initiate a keep-alive event.
6. WHEN a Developer activates a control in the Control_Panel, THE Control_Panel SHALL send the corresponding request to the API_Server.
7. WHEN the API_Server returns a success response for a request initiated from the Control_Panel, THE Control_Panel SHALL display the returned outcome within 2000 milliseconds of receiving the response.
8. IF the API_Server returns an error response or the request fails to complete, THEN THE Control_Panel SHALL display a visible message indicating the request failed and SHALL retain the Developer's current selections without resubmitting the request.

### Requirement 8: Interception Logging and Observability

**User Story:** As a Developer, I want to see the requests the Emulator received and the webhooks it sent, so that I can debug my integration.

#### Acceptance Criteria

1. WHEN the API_Server receives a request from an Integrating_Client, THE Interception_Logger SHALL record the request path, HTTP method, an ISO 8601 UTC timestamp with millisecond precision, and the request body in the Interception_Log within 500 milliseconds.
2. IF an inbound request body exceeds 64 KB, THEN THE Interception_Logger SHALL record the first 64 KB of the body and mark the record as truncated.
3. WHEN the Push_Engine dispatches a webhook, THE Interception_Logger SHALL record the Push_Target, an ISO 8601 UTC timestamp with millisecond precision, the dispatched payload, and the dispatch outcome in the Interception_Log.
4. IF a webhook dispatch fails, THEN THE Interception_Logger SHALL record the failure category and, when available, the returned HTTP status code in the corresponding Interception_Log record.
5. WHEN a Developer opens the Interception_Log view in the Control_Panel, THE Control_Panel SHALL display recorded inbound requests and outbound webhook records ordered by recorded timestamp from most recent to oldest.
6. WHEN a Developer opens the Interception_Log view and no records exist, THE Control_Panel SHALL display an explicit empty-state indication.
7. WHEN the Interception_Log reaches 10,000 records, THE Interception_Logger SHALL discard the oldest records so that no more than 10,000 records are retained.
8. WHERE the Emulator is running in Persistent_Mode, THE Interception_Log SHALL retain its records across a container restart.

### Requirement 9: Ephemeral and Persistent State Modes

**User Story:** As a Developer, I want to choose between persistent and ephemeral state, so that I can retain data during local development and discard it during CI runs.

#### Acceptance Criteria

1. WHERE the Emulator is configured for Persistent_Mode with a mounted storage volume, THE Emulator SHALL store the Configuration_Store and Interception_Log on the mounted volume such that all records written before the container stops are readable after the container is restarted with the same mounted volume.
2. WHERE the Emulator is configured for Ephemeral_Mode, THE Emulator SHALL store the Configuration_Store and Interception_Log in storage that is deleted when the container stops, such that a subsequent container start presents an empty Configuration_Store (except for default values) and an empty Interception_Log.
3. WHEN the Emulator starts and finds the Configuration_Store absent or containing zero configuration records, THE Emulator SHALL initialize the Configuration_Store with the documented default values within 5 seconds of startup.
4. WHEN the Emulator starts, THE Emulator SHALL read the state mode from its startup/environment configuration and apply the selected mode before accepting any request.
5. IF the Emulator starts configured for Persistent_Mode but no mounted storage volume is accessible for read and write, THEN THE Emulator SHALL abort startup, remain in a non-serving state, and emit a startup error indicating that the required mounted volume is unavailable.
6. IF the startup configuration specifies no state mode or an unrecognized state mode value, THEN THE Emulator SHALL default to Ephemeral_Mode and emit a warning indicating that the default mode was applied.

### Requirement 10: Single-Container Distribution

**User Story:** As a Developer, I want the Emulator to run from a single lightweight container, so that I can start it with one command.

#### Acceptance Criteria

1. THE Container_Image SHALL serve both the API_Server endpoints and the static Control_Panel from a single running container listening on one exposed TCP port.
2. THE Container_Image SHALL be produced from a multi-stage build whose final stage is based on a Node.js Alpine runtime image and whose final image size does not exceed 200 MB.
3. WHEN the Container_Image is started with default settings, THE Emulator SHALL accept API requests within 10 seconds of container start without requiring additional manual configuration steps.
4. IF the Container_Image is started and a required runtime dependency or environment variable is missing or invalid, THEN THE Emulator SHALL terminate startup with a non-zero exit code and emit a log message indicating the specific missing or invalid item, without listening on the exposed port.
5. THE project SHALL provide a `docker-compose.yml` file that starts the Emulator for local testing with a single `docker compose up` command and maps the exposed container port to a host port.

### Requirement 11: Continuous Integration Pipeline

**User Story:** As a maintainer, I want automated linting and testing on changes to the main branch, so that regressions are caught before release.

#### Acceptance Criteria

1. WHEN a commit is pushed to the main branch, THE CI_Pipeline SHALL start a run and execute the project linter followed by the automated test suite within 60 seconds of the push event being received.
2. WHEN a pull request targeting the main branch is opened, updated, or reopened, THE CI_Pipeline SHALL run the project linter and the automated test suite before the pull request is eligible to merge.
3. IF the linter reports one or more errors during the CI_Pipeline, THEN THE CI_Pipeline SHALL report a failed status for the run and record the failing check as the linter step.
4. IF one or more automated tests fail during the CI_Pipeline, THEN THE CI_Pipeline SHALL report a failed status for the run and record the failing check as the test step.
5. WHEN the linter completes with zero errors and every automated test passes, THE CI_Pipeline SHALL report a successful status for the run.
6. IF the CI_Pipeline run does not complete within 15 minutes of starting, THEN THE CI_Pipeline SHALL terminate the run and report a failed status indicating a timeout.

### Requirement 12: Continuous Delivery and Release

**User Story:** As a maintainer, I want tagged releases to build and publish the image automatically, so that consumers can pull a versioned image from Docker Hub.

#### Acceptance Criteria

1. WHEN a Git tag matching the semantic version format `vMAJOR.MINOR.PATCH` (where MAJOR, MINOR, and PATCH are each integers from 0 to 999999) is pushed to the repository, THE CD_Pipeline SHALL build the Container_Image within 30 minutes of the tag push event.
2. IF the pushed tag does not match the semantic version format `vMAJOR.MINOR.PATCH`, THEN THE CD_Pipeline SHALL NOT build or publish the Container_Image and SHALL complete without producing any published artifact.
3. IF the Container_Image build fails, THEN THE CD_Pipeline SHALL terminate without publishing any Container_Image to Docker Hub and SHALL report a failed pipeline status indicating the build failure.
4. WHEN the CD_Pipeline successfully builds the Container_Image on a semantic version tag, THE CD_Pipeline SHALL publish the Container_Image to Docker Hub with a tag equal to the semantic version tag with the leading `v` removed (e.g., tag `v1.2.3` publishes image tag `1.2.3`).
5. WHEN the CD_Pipeline successfully publishes the version-tagged Container_Image to Docker Hub, THE CD_Pipeline SHALL also publish the identical Container_Image to Docker Hub with the `latest` tag.
6. IF publishing the Container_Image to Docker Hub fails, THEN THE CD_Pipeline SHALL report a failed pipeline status indicating the publish failure and SHALL NOT create a GitHub release.
7. WHEN the CD_Pipeline successfully publishes the Container_Image to Docker Hub on a semantic version tag, THE CD_Pipeline SHALL create a GitHub release named with the semantic version tag and containing a changelog listing the commit messages merged since the previous semantic version tag.

### Requirement 13: Documentation and Onboarding

**User Story:** As a Developer, I want clear documentation, so that I can run and integrate with the Emulator quickly.

#### Acceptance Criteria

1. THE project SHALL provide a README file at the repository root that documents the command to run the Container_Image, the network address and port to reach the API_Server, and the network address and port to reach the Control_Panel.
2. THE README file SHALL document each configuration option that selects Persistent_Mode or Ephemeral_Mode, including the option name, its accepted values, and the default value applied when the option is unset.
3. THE README file SHALL list every supported FCGI_Endpoint by path and HTTP method, and SHALL reference the Official_API_Documentation (https://www.controlid.com.br/docs/access-api-pt/) as the fidelity source for endpoint behavior.
4. WHEN a Developer follows the README run instructions on a supported environment, THE README SHALL provide a verification step whose expected observable result (a successful response from the API_Server) confirms the Emulator is running.
5. IF a documented FCGI_Endpoint diverges in behavior from the Official_API_Documentation, THEN THE README SHALL document the specific divergence so a reader can distinguish emulated behavior from the reference behavior.
