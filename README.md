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

> **Fidelity source.** Endpoint paths, methods, request field names, response shapes, and
> webhook payloads are grounded in the official
> [Control-iD Access API documentation](https://www.controlid.com.br/docs/access-api-pt/).
> That documentation is the single source of truth for behavior; see
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

Open the control panel at <http://localhost:8080/admin>. It provides three controls:

- **Authorized access** — pick an identity (the selector lists the enrolled users), then
  trigger the event. The emulator dispatches an authorized-identification webhook
  (`event=7`) that includes the selected identity.
- **Denied access** — dispatches a denied-identification webhook (`event=6`).
- **Keep-alive** — dispatches a `device_is_alive` keep-alive webhook.

Each action runs through the **Push/webhook engine**, which reads the configured push
target and POSTs the grounded payload to it. Every inbound request and every outbound
webhook (with its dispatch outcome) appears in the interception log, newest-first, with an
explicit empty state when there is nothing recorded yet.

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

## Documented divergences

The emulator intentionally simplifies some hardware behavior. Wherever it diverges from the
[official documentation](https://www.controlid.com.br/docs/access-api-pt/), the difference
is called out here so you can distinguish emulated behavior from the reference:

- **No real biometric matching.** The emulator performs no face detection, template
  extraction, or 1:N matching. "Authorized" vs. "denied" is a **developer-selected outcome**
  in the control panel, not the result of a biometric comparison.
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

## License

Released under the [MIT License](./LICENSE).
