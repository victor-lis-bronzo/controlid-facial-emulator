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

