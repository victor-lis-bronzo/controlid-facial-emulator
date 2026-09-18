# Control-iD Facial Emulator

A plug-and-play, open-source emulator of the **Control-iD facial access control reader**.
It faithfully reproduces the device's HTTP (`.fcgi`) REST API, its configuration
persistence, and its proactive Push/webhook communication — packaged as a single
lightweight Docker container with a built-in web control panel.

Point an existing Control-iD integration at the emulator instead of physical hardware:
drive simulated access events (authorized / denied / keep-alive) from the `/admin` panel,
watch the emulator dispatch webhooks to your server, and inspect every request and
response in a live interception log — no scarce hardware and no external HTTP client
required.

> **Fidelity sources.** Endpoint paths, methods, request field names, response shapes, and
> webhook payloads are grounded in the official
> [Control-iD Access API documentation](https://www.controlid.com.br/docs/access-api-pt/)
> and the official
> [Control-iD integration examples](https://github.com/controlid/integracao) repository
> (see its `Controle de Acesso` folder, including the NodeJS Push, Monitor, and
> Online-server samples). Those are the single sources of truth for behavior; see
> [Documented divergences](#documented-divergences) for where the emulator deliberately
> simplifies the hardware.

---

## Quick start (Docker)

Run the published image directly:

```bash
docker run --rm -p 8080:8080 \
  -e EMULATOR_STATE_MODE=ephemeral \
  <your-dockerhub-username>/controlid-facial-emulator:latest
```

Or start it with Docker Compose (persistent mode with a named `/data` volume):

```bash
docker compose up
```

Once running:

- **API server** (`.fcgi` endpoints + control-panel API): <http://localhost:8080>
- **Web control panel**: <http://localhost:8080/admin>

> Replace `<your-dockerhub-username>` with the Docker Hub namespace the image is published
> under (the [CD pipeline](#cicd) pushes to
> `${DOCKERHUB_USERNAME}/controlid-facial-emulator`).

### Verify it's running

Log in with the default credentials — a `200` response carrying a `session` token confirms
the emulator is up:

```bash
curl -X POST localhost:8080/login.fcgi \
  -H 'content-type: application/json' \
  -d '{"login":"admin","password":"admin"}'
```

Expected response:

```json
{ "session": "apx7NM2CErTcvXpuvExuzaZ" }
```

You can also open <http://localhost:8080/admin> in a browser to reach the control panel.

---

## Configuration

The emulator is configured entirely through environment variables. Every option has a
documented default, so the container runs with zero configuration.

| Variable             | Purpose                                        | Accepted values                     | Default                                          |
| -------------------- | ---------------------------------------------- | ----------------------------------- | ------------------------------------------------ |
| `EMULATOR_STATE_MODE`| Selects the state mode (see below)             | `persistent` \| `ephemeral`         | `ephemeral` (a warning is logged if unset/unknown) |
| `EMULATOR_DB_PATH`   | SQLite file path used in **persistent** mode   | any writable path on a mounted volume | `/data/emulator.sqlite`                          |
| `EMULATOR_PORT`      | TCP port the server listens on                 | `1`–`65535`                         | `8080`                                           |
| `EMULATOR_DEVICE_ID` | Synthetic `device_id` used in payloads         | integer                             | a generated synthetic id                         |
| `EMULATOR_LOGIN`     | Admin username for `/login.fcgi`               | string, ≤ 64 characters             | `admin`                                          |
| `EMULATOR_PASSWORD`  | Admin password for `/login.fcgi`               | string, ≤ 64 characters             | `admin`                                          |

> **Security note.** The default `admin`/`admin` credentials mirror the device defaults for
> fidelity. This is a development tool — do not expose it to untrusted networks.

### Persistent vs. ephemeral state

- **`ephemeral`** (default) — the configuration store and interception log live in
  in-memory / discardable storage that is wiped when the container stops. Every fresh start
  presents default configuration and an empty log. This is the mode to use in CI pipelines.
- **`persistent`** — the configuration store and interception log are written to the SQLite
  file at `EMULATOR_DB_PATH` (default `/data/emulator.sqlite`). Mount a volume at `/data`
  (the provided `docker-compose.yml` does this with a named `emulator-data` volume) so data
  survives container restarts. If persistent mode is selected but the volume is missing or
  not writable, the emulator aborts startup with a clear error instead of listening.

---

## Emulated Control-iD `.fcgi` endpoints

Every endpoint below matches the paths, methods, field names, and response shapes described
in the official
[Control-iD Access API documentation](https://www.controlid.com.br/docs/access-api-pt/),
which is the fidelity source for their behavior. Requests and responses use
`Content-Type: application/json` unless noted. Protected routes require a valid session
token (passed as `?session=<token>`); the token TTL is 3600 seconds.

| Path                        | Method     | Auth | Purpose                                                        |
| --------------------------- | ---------- | ---- | -------------------------------------------------------------- |
| `/login.fcgi`               | POST       | No   | Authenticate and receive a session token                       |
| `/session_is_valid.fcgi`    | POST       | No   | Check whether a session token is still valid                   |
| `/set_configuration.fcgi`   | POST       | Yes  | Write configuration modules (e.g. the `monitor` push target)   |
| `/get_configuration.fcgi`   | POST       | Yes  | Read configuration values (defaults filled for unset keys)     |
| `/create_objects.fcgi`      | POST       | Yes  | Create objects (e.g. `users`)                                  |
| `/load_objects.fcgi`        | POST       | Yes  | Query objects with filters (e.g. `access_logs`)                |
| `/modify_objects.fcgi`      | POST       | Yes  | Update objects matching a `where` clause                       |
| `/destroy_objects.fcgi`     | POST       | Yes  | Delete objects matching a `where` clause                       |
| `/user_get_image.fcgi`      | GET / POST | Yes  | Retrieve a user's stored face image (image bytes)              |
| `/user_set_image.fcgi`      | POST       | Yes  | Upload a user's face image (multipart)                         |
| `/user_destroy_image.fcgi`  | POST       | Yes  | Remove a user's stored face image                               |
| `/new_user_identified.fcgi` | POST       | No   | Online-identification callback returning the reply message     |

Validation follows the reference API: an invalid body (bad JSON, missing required field, or
wrong field type) returns `400` with an `error-description`; an unknown path returns `404`;
a wrong HTTP method returns `405`; and a missing/expired/invalid session on a protected
route returns `401`.

### Control-panel API (`/api/...`)

These are the emulator's own control endpoints, consumed by the `/admin` panel — distinct
from the Control-iD compatibility surface above.

| Path                          | Method | Purpose                                                      |
| ----------------------------- | ------ | ------------------------------------------------------------ |
| `/api/identities`             | GET    | List selectable identities for the authorized-access picker  |
| `/api/simulate/authorized`    | POST   | Simulate an authorized access for a selected identity        |
| `/api/simulate/denied`        | POST   | Simulate a denied access                                     |
| `/api/simulate/keep-alive`    | POST   | Force a device keep-alive event                              |
| `/api/interception`           | GET    | Read the interception log (newest-first; `?limit=<n>`)       |

---

## Simulating events

The `/api/simulate/*` endpoints trigger simulated access events directly (there is
currently no panel UI for this — see [WebGUI](#webgui) below):

```bash
curl -X POST localhost:8080/api/simulate/authorized -H 'content-type: application/json' -d '{"identityId":1}'
curl -X POST localhost:8080/api/simulate/denied
curl -X POST localhost:8080/api/simulate/keep-alive
```

- **Authorized access** — pick an identity (`/api/identities` lists the enrolled users),
  then trigger the event. The emulator dispatches an authorized-identification webhook
  (`event=7`) that includes the selected identity.
- **Denied access** — dispatches a denied-identification webhook (`event=6`).
- **Keep-alive** — dispatches a `device_is_alive` keep-alive webhook.

Each action runs through the **Push/webhook engine**, which reads the configured push
target and POSTs the grounded payload to it. Every inbound request and every outbound
webhook (with its dispatch outcome) is recorded in the interception log
(`/api/interception`, newest-first).

### Configuring the push target

The push destination is the `monitor` block, set via `/set_configuration.fcgi`:

```bash
curl -X POST "localhost:8080/set_configuration.fcgi?session=<token>" \
  -H 'content-type: application/json' \
  -d '{"monitor":{"hostname":"192.168.0.20","port":"8000","path":"api/notifications","alive_interval":30000,"enable_photo_upload":1,"request_timeout":"5000"}}'
```

The engine composes the destination as
`http://<hostname>:<port>/<path>/<endpoint>` (e.g. `.../api/notifications/dao`). It treats
any `2xx` response as success, waits up to **10 seconds** per attempt, and retries up to
**3** additional times at a fixed 5-second interval. If no target is configured, the event
is recorded in the interception log as `no_target` and no POST is made.

---

## WebGUI

The web app at <http://localhost:8080/admin> is a from-scratch rewrite that mirrors the
Control-iD device's own admin UI, built exclusively against the `.fcgi` compatibility
surface above (no separate control-panel API). Today it covers:

- **Login** — authenticates via `login.fcgi` and gates the rest of the panel behind the
  session.
- **Users** — create, edit, and delete users, and upload/remove a **facial photo** (via
  `user_set_image.fcgi` / `user_destroy_image.fcgi`) shown as the user's avatar.

Groups, Time Zones, Access Rules, Portals, and a Dashboard are planned as `.fcgi`-native
additions to this WebGUI; they are not implemented yet. An earlier, separate admin
interface (its own REST API under `/api/admin/*` plus Simulate/Interception-Log controls)
was built first, then superseded by this rewrite; its now-unused frontend code has been
removed. The `/api/admin/*` backend routes described below remain available as a REST
surface distinct from `.fcgi`, but nothing in the WebGUI calls them today.

### Creating a user (and using it in Simulate)

Create a user from the **Users** section (or via the API below). Once created, the user
immediately appears in the `/api/identities` list used by
[Simulating events](#simulating-events), and you can attach a facial photo to it. The
stored photo is served back through the existing `user_get_image.fcgi` endpoint and
rendered as the user's avatar.

### Admin API (`/api/admin/...`)

A REST surface under `/api/admin`, distinct from the Control-iD `.fcgi` compatibility
surface and not currently consumed by the WebGUI. **Reads are open; every mutation
(create/update/delete and photo upload/delete) requires a valid session token** obtained from
`POST /login.fcgi` and passed as `?session=<token>` (the same session mechanism the `.fcgi`
routes use; token TTL is 3600 seconds). A missing/expired/invalid session on a mutation
returns `401` and persists no change.

| Method                | Path                             | Auth | Purpose                                             |
| --------------------- | -------------------------------- | ---- | --------------------------------------------------- |
| `GET`                 | `/api/admin/dashboard`           | No   | Aggregate counts + 10 most-recent access logs       |
| `GET`                 | `/api/admin/access-logs`         | No   | Filterable logs (`user_id`, `event`, `from`, `to`)  |
| `GET`                 | `/api/admin/users`               | No   | List users                                          |
| `POST`                | `/api/admin/users`               | Yes  | Create a user                                       |
| `GET`                 | `/api/admin/users/:id`           | No   | Read one user                                       |
| `PUT`                 | `/api/admin/users/:id`           | Yes  | Update a user                                       |
| `DELETE`              | `/api/admin/users/:id`           | Yes  | Delete a user (and its photo + memberships)         |
| `POST`                | `/api/admin/users/:id/photo`     | Yes  | Upload a JPEG/PNG facial photo (≤ 5 MB, multipart)  |
| `DELETE`              | `/api/admin/users/:id/photo`     | Yes  | Remove a user's stored photo                        |
| `GET` / `POST`        | `/api/admin/groups`              | No/Yes | List / create groups                              |
| `GET` / `PUT` / `DELETE` | `/api/admin/groups/:id`       | No/Yes | Read / update / delete a group                    |
| `GET` / `POST`        | `/api/admin/time-zones`          | No/Yes | List / create time zones                          |
| `GET` / `PUT` / `DELETE` | `/api/admin/time-zones/:id`   | No/Yes | Read / update / delete a time zone                |
| `GET` / `POST`        | `/api/admin/access-rules`        | No/Yes | List / create access rules                        |
| `GET` / `PUT` / `DELETE` | `/api/admin/access-rules/:id` | No/Yes | Read / update / delete an access rule             |
| `GET` / `POST`        | `/api/admin/portals`             | No/Yes | List / create portals                             |
| `GET` / `PUT` / `DELETE` | `/api/admin/portals/:id`      | No/Yes | Read / update / delete a portal                   |

Validation mirrors the rest of the API: invalid input returns `400` with an
`error-description`; an unknown id returns `404`; deleting a Group, Time Zone, or Portal that
is still referenced by an Access Rule returns `409`; a photo larger than 5 MB returns `413`.

### Photo persistence (`EMULATOR_DATA_DIR`)

Uploaded facial photos are stored on disk under a `photos/` subfolder of the emulator's data
directory. The data directory is resolved as follows:

- If `EMULATOR_DATA_DIR` is set, photos are stored under that directory.
- Otherwise, in **persistent** mode the data directory is the directory that contains
  `EMULATOR_DB_PATH` — by default `/data`, which is the mounted volume — so stored photos
  survive container restarts alongside the SQLite file (mount a volume at `/data`, as the
  provided `docker-compose.yml` does).
- Otherwise, in **ephemeral** mode photos are written to a discardable per-run temporary
  directory and are wiped when the container stops (matching ephemeral state semantics).

| Variable            | Purpose                                              | Default                                                    |
| ------------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| `EMULATOR_DATA_DIR` | Root directory under which `photos/` is created      | persistent: `dirname(EMULATOR_DB_PATH)` (i.e. `/data`); ephemeral: a temp dir |

---

## Documented divergences

The emulator intentionally simplifies some hardware behavior. Wherever it diverges from the
[official documentation](https://www.controlid.com.br/docs/access-api-pt/), the difference
is called out here so you can distinguish emulated behavior from the reference:

- **No real biometric matching.** The emulator performs no face detection, template
  extraction, or 1:N matching. "Authorized" vs. "denied" is a **developer-selected outcome**
  in the control panel, not the result of a biometric comparison.
- **Facial photos are for display only.** A user's facial photo is uploaded, stored,
  previewed in the panel, and served for display via `user_get_image.fcgi` **only**. The
  emulator performs no face detection, enrollment, or matching against the stored image.
- **Access outcomes are simulated, not sensed.** Access-log records and access outcomes are
  produced by the **Simulate** controls and by stored records — not by physical sensing of a
  person at a door.
- **Admin entities are emulated data structures.** Users, Groups, Time Zones, Access Rules,
  and Portals are persisted data structures intended for **building and integration-testing
  client software**, not a faithful reproduction of the device's internal access-decision
  engine. An Access Rule composing Groups × Time Zones × Portals is stored and returned as
  configured; the emulator does not evaluate it to grant or deny live access.
- **Control-iD concept mapping.** Where an admin concept corresponds to a Control-iD object
  concept in the [official API](https://www.controlid.com.br/docs/access-api-pt/), the names
  align so you can relate the emulated entity to the reference: Users ↔ `users`, Groups ↔
  `groups`, Portals ↔ `portals`, Access Rules ↔ `access_rules`, and Time Zones ↔
  `time_zones`.
- **Synthetic `device_id`.** The device identifier used in payloads is a synthetic value
  (configurable via `EMULATOR_DEVICE_ID`) rather than a hardware serial.
- **Simplified `identifier_id`.** The identifier field on access events is simplified and
  does not reflect a real biometric identifier registry.
- **Synthetic biometry data.** Face-image and biometry responses return synthetic /
  placeholder data, not captured biometric samples.
- **Single logical device.** One running container represents a single device
  (`device_id`); it is not a multi-device fleet simulator.

---

## Development

The project is an npm-workspaces monorepo (Node.js 22):

```
.
├── api/   # Fastify + Drizzle/SQLite API server (the .fcgi + control-panel API)
├── web/   # React + Vite control panel, built and served at /admin
├── Dockerfile
├── docker-compose.yml
└── package.json  # workspaces: ["api", "web"]
```

Install and run the standard checks from the repository root:

```bash
npm ci          # install all workspace dependencies
npm run build   # build api (tsc) and web (vite)
npm run lint    # lint api and web
npm test        # run the vitest suites (api includes property-based tests)
```

Run the pieces individually during development:

```bash
npm run dev       # start the API server in watch mode (port 8080)
npm run dev:web   # start the Vite dev server for the control panel
```

The Vite dev server proxies `/api` to `http://localhost:8080`, so run the API
(`npm run dev`) alongside the web dev server (`npm run dev:web`) and the panel's API client
works same-origin without CORS. In production the compiled SPA is served directly by the
API at `/admin`.

---

## CI/CD

- **CI** (`.github/workflows/ci.yml`) runs on every push to `main` and on pull requests
  targeting `main`. It installs the workspace and runs `lint`, `build`, and `test`; any lint
  error or failing test fails the run, and the job is capped at 15 minutes.
- **CD** (`.github/workflows/cd.yml`) runs when a semantic-version tag `vMAJOR.MINOR.PATCH`
  is pushed. It builds the Docker image and publishes it to Docker Hub under **two** tags —
  the version with the leading `v` stripped (e.g. `v1.2.3` → `1.2.3`) and `latest` — then
  creates a GitHub release named with the tag whose notes are an auto-generated changelog of
  commits since the previous tag. A build or publish failure aborts the pipeline before the
  release is created. Non-matching tags do not trigger a build or publish.

### Required secrets

Configure these repository secrets for the CD pipeline to publish to Docker Hub:

| Secret               | Purpose                                                     |
| -------------------- | ----------------------------------------------------------- |
| `DOCKERHUB_USERNAME` | Docker Hub account/namespace that owns the image            |
| `DOCKERHUB_TOKEN`    | Docker Hub access token with push permission                |

To cut a release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

---

## References

The emulator's behavior is grounded in Control-iD's official materials:

- **API documentation** — [Control-iD Access API (pt)](https://www.controlid.com.br/docs/access-api-pt/): endpoint paths, request/response field names, configuration modules, and the Monitor/Push notification payloads.
- **Integration examples** — [`controlid/integracao`](https://github.com/controlid/integracao) (folder `Controle de Acesso`). The NodeJS samples were used to validate the emulator's request/response shapes and webhook flows:
  - **`Exemplo API Monitor - NodeJS`** — configures the device Monitor via `set_configuration.fcgi` with a `monitor` block `{ request_timeout, hostname, port, path: "api/notifications" }`, and receives device notifications at `POST /api/notifications/{dao,door,operation_mode,template,face_template,card,secbox,user_image,catra_event,usb_drive}`. This is the mechanism the emulator's Push Engine reproduces.
  - **`Exemplo API Modo Push - NodeJS`** — the alternative proactive Push mode, configured with a `push_server` block (`push_request_timeout`, `push_request_period`, `push_remote_address`).
  - **`Servidor Online - NodeJS`** — an online-identification server replying to identification events with the *Mensagem de Retorno* shape `{ result: { event, user_id, ... } }` (event `7` granted, `3` not identified, `4` pending), and serving `user_get_image.fcgi` / `face_create.fcgi`.

Where the emulator deliberately simplifies these behaviors, the difference is listed under [Documented divergences](#documented-divergences).

---

## License

Released under the [MIT License](./LICENSE).
