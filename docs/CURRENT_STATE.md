# Control-iD Facial Emulator: Current State & Architecture

## Overview
The `controlid-facial-emulator` is a plug-and-play, open-source emulator of the Control-iD facial access control reader. It faithfully reproduces the device's HTTP (`.fcgi`) REST API, its configuration persistence, and its proactive Push/webhook communication. It is packaged as a single lightweight Docker container containing both an API server and a built-in web control panel.

**Sources:**
- `README.md` (Lines 1-20)
- `package.json`

## Architecture & Workspaces
The project is structured as an npm-workspaces monorepo running Node.js >=22.
- **`api` Workspace (`api/`)**: A backend server built with Fastify, Drizzle ORM, and `better-sqlite3`. It provides the `.fcgi` API surface and a dedicated `/api/...` for the control panel.
- **`web` Workspace (`web/`)**: A frontend control panel built with React and Vite. It is served by the API at the `/admin` path in production.

**Sources:**
- `package.json` (Workspaces definition)
- `api/package.json` (Dependencies: `fastify`, `drizzle-orm`, `better-sqlite3`, `undici`)
- `web/package.json` (Dependencies: `react`, `react-dom`, `vite`)
- `README.md` (Lines 200-205)

## Main Functionality & Components

### 1. State Modes & Persistence
The emulator operates in two modes defined by `EMULATOR_STATE_MODE`:
- **Ephemeral (default)**: Uses an in-memory SQLite database. Storage is discarded when the container stops.
- **Persistent**: Uses a file-based SQLite database (default path: `/data/emulator.sqlite`). Requires a writable mounted volume.

**Sources:**
- `api/src/composition/bootstrap.ts` (StateMode selector, `resolveConfig`, `openStore`)
- `README.md` (Lines 87-95)

### 2. Database Schema
The database uses SQLite and models device internal state with nine main tables:
- `config`: Stores configuration modules as JSON blobs.
- `users`: Stores user identities (id, registration, name, password, imagePath).
- `accessLogs`: Logs of biometric access events (event type, identifiers).
- `sessions`: Token-based session management for `.fcgi` routes.
- `interceptionLog`: Stores all inbound API requests and outbound webhook events.
- `groups`: Named collections of users, used to compose access rules (admin panel).
- `portals`: The doors / access points the device controls (admin panel).
- `timeZones`: Named weekly schedules built from time ranges (admin panel).
- `accessRules`: Compositions associating Groups, Time Zones, and Portals (admin panel).

The official Access API documents ~40 object types in total; only 6 of them
(`users`, `groups`, `portals`, `time_zones`, `access_rules`, `access_logs`)
are implemented today. The full object-by-object breakdown, and the
remaining action endpoints, are tracked in
[docs/route-gaps.md](route-gaps.md) against
[ADR 0002](adr/0002-full-route-coverage-mocked-hardware.md), not as
divergences — see [CONTEXT.md](../CONTEXT.md) for the distinction.

**Sources:**
- `api/src/db/schema.ts`

### 3. Emulated API (`.fcgi`)
The emulator provides high-fidelity API endpoints matching the Control-iD specifications:
- **Session Management**: `/login.fcgi`, `/session_is_valid.fcgi`
- **Configuration**: `/set_configuration.fcgi`, `/get_configuration.fcgi`
- **Object Management**: `/create_objects.fcgi`, `/load_objects.fcgi`, `/modify_objects.fcgi`, `/destroy_objects.fcgi`
- **User Actions**: `/user_get_image.fcgi`, `/new_user_identified.fcgi`

**Sources:**
- `api/src/routes/fcgi/`
- `README.md` (Lines 100-125)

### 4. Push/Webhook Engine
Outbound webhooks (Monitor mechanism) are dispatched to a configured push target. The `PushEngine` reads the target from the `monitor` configuration module, appends the endpoint, and POSTs the JSON payload.
- Requests have a 10s timeout limit.
- If a request fails, it retries up to 3 times (4 attempts total) with a 5s interval.
- Emitted events include Authorized access (`event=7`), Denied access (`event=6`), and Keep-alive (`device_is_alive`).

**Sources:**
- `api/src/services/push-engine.ts` (PushEngine dispatch and retry logic)
- `README.md` (Lines 151-170)

### 5. Control Panel & Interception Logger
The web control panel at `/admin` (React SPA) allows developers to:
- Simulate access events (Authorized, Denied, Keep-alive).
- Inspect an interception log containing all incoming requests and outbound webhooks in real-time.
This relies on a specific set of API endpoints (`/api/identities`, `/api/simulate/*`, `/api/interception`).

**Sources:**
- `api/src/routes/control-panel/control-panel-routes.ts`
- `api/src/services/interception-logger.ts`
- `web/src/components/` (EventControls, InterceptionLog)

### 6. Packaging & Deployment
The repository is packaged into a single, multi-stage Docker image using `node:22-alpine`.
- Stage 1: Builds the React SPA.
- Stage 2: Compiles the Fastify API using `tsc`.
- Stage 3: Installs production dependencies and compiles `better-sqlite3` native bindings for `musl`.
- Stage 4: Packages only the compiled API, SPA, and production `node_modules` into a slim runner image. The API serves the SPA directly from `/app/web/dist` on port 8080.

**Sources:**
- `Dockerfile`
