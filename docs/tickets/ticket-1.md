## Parent
Part of #31

## What to build
Update `api.Dockerfile` so that the `/data` directory is explicitly created and chowned to the `emulator` user before the `USER emulator` instruction. This prevents Docker from creating the volume mount point as `root` and fixes the startup crash when using persistent mode.

## Acceptance criteria
- [x] `api.Dockerfile` creates `/data` and sets ownership to `emulator:emulator`.
- [x] Running `docker compose up --build` works without permission denied on `/data`.

## Blocked by
- None (can start immediately).

## Status
Closed — fix already present in `api.Dockerfile` (`mkdir -p /data && chown emulator:emulator /data` before `USER emulator`, lines 60 and 68).
