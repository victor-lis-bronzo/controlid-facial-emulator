# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Control-iD Facial Emulator — multi-stage image (Req 10.1, 10.2, 10.3).
#
# Stages:
#   1. web-build  : build the React + Vite control panel  -> web/dist
#   2. api-build  : compile the Fastify/TS API (tsc)       -> api/dist
#   3. prod-deps  : install production-only deps on Alpine so the native
#                   better-sqlite3 binding is compiled against musl
#   4. runner     : slim node:22-alpine image, non-root, single exposed port
#
# The final image copies only compiled output, production node_modules, and the
# built SPA — no source, tests, dev deps, or build toolchain — to stay well
# under the 200 MB budget (Req 10.2).
# ---------------------------------------------------------------------------

# ---------- Stage 1: web build ----------
FROM node:22-alpine AS web-build
WORKDIR /repo
# Manifests first for cached dependency installs across the workspace.
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY web/package.json ./web/package.json
# Install the full workspace (web needs its dev deps: vite, tsc, plugins).
RUN npm ci
# Build only the web workspace.
COPY web ./web
RUN npm run -w web build

# ---------- Stage 2: api build ----------
FROM node:22-alpine AS api-build
# Build toolchain for native modules (better-sqlite3) during the full install.
RUN apk add --no-cache python3 make g++
WORKDIR /repo
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY web/package.json ./web/package.json
RUN npm ci
# Compile the API (tsc -> api/dist).
COPY api ./api
RUN npm run -w api build

# ---------- Stage 3: production dependencies ----------
# A clean production install on Alpine guarantees the better-sqlite3 native
# binding is built against musl for the SAME platform as the runner.
#
# Only the API workspace's production dependencies are installed here — the
# web workspace's runtime deps (react, react-dom, scheduler) and any @types
# packages are build/UI-only and are never loaded by the API at runtime, so
# excluding them keeps the final image small (Req 10.2). The compiled SPA is
# copied separately from the web-build stage.
FROM node:22-alpine AS prod-deps
RUN apk add --no-cache python3 make g++
WORKDIR /repo
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY web/package.json ./web/package.json
# Install prod deps for the API workspace only (root-hoisted layout preserved),
# so better-sqlite3 compiles against musl but web/UI deps are excluded.
RUN npm ci --omit=dev --workspace api --include-workspace-root
# Strip build-time-only artifacts from the native module and other cruft that is
# not needed to run the compiled binding.
RUN set -eux; \
    # better-sqlite3: keep the compiled .node + JS lib; drop C sources & objects.
    rm -rf node_modules/better-sqlite3/deps \
           node_modules/better-sqlite3/src \
           node_modules/better-sqlite3/build/Release/obj \
           node_modules/better-sqlite3/build/Release/.deps \
           node_modules/better-sqlite3/build/Release/*.a \
           node_modules/better-sqlite3/build/Release/*.o; \
    # Remove any web/UI deps that may have hoisted in and are unused by the API.
    rm -rf node_modules/react node_modules/react-dom node_modules/scheduler \
           node_modules/@types node_modules/csstype; \
    # Trim docs / maps / TS sources across all deps to shrink the layer.
    find node_modules -type f \( \
         -name '*.md' -o -name '*.markdown' -o -name '*.map' -o -name '*.ts' \
         -o -name 'LICENSE*' -o -name 'license*' -o -name '*.d.ts' \
      \) -delete 2>/dev/null || true; \
    find node_modules -type d \( \
         -name 'test' -o -name 'tests' -o -name '__tests__' -o -name 'docs' -o -name 'example' -o -name 'examples' \
      \) -prune -exec rm -rf {} + 2>/dev/null || true

# ---------- Stage 4: runner ----------
FROM node:22-alpine AS runner
ENV NODE_ENV=production \
    EMULATOR_WEB_DIR=/app/web/dist \
    EMULATOR_PORT=8080
WORKDIR /app

# The runtime only invokes `node`; remove the bundled npm/npx tooling and the
# corepack shims to trim the image (Req 10.2). Also create the non-root user.
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/bin/corepack /usr/local/lib/node_modules/corepack \
           /opt/yarn* 2>/dev/null || true; \
    addgroup -S emulator && adduser -S emulator -G emulator

# Workspace manifests so Node resolves the workspace package layout.
COPY --chown=emulator:emulator package.json ./package.json
COPY --chown=emulator:emulator api/package.json ./api/package.json
COPY --chown=emulator:emulator web/package.json ./web/package.json

# Production dependencies (root-hoisted node_modules incl. musl-built
# better-sqlite3) and any workspace-local node_modules.
COPY --chown=emulator:emulator --from=prod-deps /repo/node_modules ./node_modules

# Compiled API and built SPA.
COPY --chown=emulator:emulator --from=api-build /repo/api/dist ./api/dist
COPY --chown=emulator:emulator --from=web-build /repo/web/dist ./web/dist

USER emulator

EXPOSE 8080

# Lightweight readiness check — the control panel is served once the app listens.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.EMULATOR_PORT||8080)+'/admin').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "api/dist/main.js"]
