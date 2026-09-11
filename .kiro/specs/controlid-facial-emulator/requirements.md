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
