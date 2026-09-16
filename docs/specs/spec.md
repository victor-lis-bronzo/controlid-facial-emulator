## Problem Statement

When running the emulator via Docker with persistent state, it aborts startup with: `[controlid-facial-emulator] startup failed: Persistent mode requires a writable storage volume, but the directory "/data" is missing or not writable.` This occurs because the Node.js application runs as the unprivileged `emulator` user, but the `/data` directory is created by Docker with `root` ownership when mounting the volume.

## Solution

Create the `/data` directory and transfer ownership to the `emulator` user in the `api.Dockerfile` before switching users (`USER emulator`), ensuring the emulator process has write permissions to initialize the persistent SQLite database.

## User Stories

1. As a developer using Docker Compose, I want the emulator to successfully initialize persistent state, so that my intercepted events and configurations survive container restarts.
2. As a developer building the emulator from source, I want the Docker setup to work out-of-the-box, so that I don't have to manually tweak container volume permissions.

## Implementation Decisions

- The module modified will be `api.Dockerfile`.
- In the runner stage, before the `USER emulator` instruction, we will add the directory creation and ownership assignment: `mkdir -p /data && chown emulator:emulator /data`.
- This ensures that when the Docker daemon mounts the volume `emulator-data:/data` without an existing host path, the directory inside the container already exists and has the correct ownership.

## Testing Decisions

- Since this is a container infrastructure fix, automated integration testing inside the existing test suite isn't applicable.
- Verification is done by running `docker compose up --build` and observing that the emulator starts in persistent mode without crashing and successfully creates `emulator.sqlite`.

## Out of Scope

- Changing the default `EMULATOR_DB_PATH`.
- Implementing rootless Docker setup across the whole repo.

## Further Notes
None.
