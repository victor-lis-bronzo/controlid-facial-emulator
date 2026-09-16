# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Control-iD Facial Emulator - API Image
#
# Focuses exclusively on the Fastify/TS API.
# Stages:
#   1. api-build  : compile the Fastify/TS API (tsc)       -> api/dist
#   2. prod-deps  : install production-only deps on Alpine so the native
#                   better-sqlite3 binding is compiled against musl
#   3. runner     : slim node:22-alpine image, non-root, single exposed port
# ---------------------------------------------------------------------------

# ---------- Stage 1: api build ----------
FROM node:22-alpine AS api-build
RUN apk add --no-cache python3 make g++
WORKDIR /repo
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
RUN npm ci
COPY api ./api
RUN npm run -w api build

# ---------- Stage 2: production dependencies ----------
FROM node:22-alpine AS prod-deps
RUN apk add --no-cache python3 make g++
WORKDIR /repo
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
RUN npm ci --omit=dev --workspace api --include-workspace-root

# Trim build artifacts and unused UI packages
RUN set -eux; \
    rm -rf node_modules/better-sqlite3/deps \
           node_modules/better-sqlite3/src \
           node_modules/better-sqlite3/build/Release/obj \
           node_modules/better-sqlite3/build/Release/.deps \
           node_modules/better-sqlite3/build/Release/*.a \
           node_modules/better-sqlite3/build/Release/*.o; \
    find node_modules -type f \( \
         -name '*.md' -o -name '*.markdown' -o -name '*.map' -o -name '*.ts' \
         -o -name 'LICENSE*' -o -name 'license*' -o -name '*.d.ts' \
      \) -delete 2>/dev/null || true; \
    find node_modules -type d \( \
         -name 'test' -o -name 'tests' -o -name '__tests__' -o -name 'docs' -o -name 'example' -o -name 'examples' \
      \) -prune -exec rm -rf {} + 2>/dev/null || true

# ---------- Stage 3: runner ----------
FROM node:22-alpine AS runner
ENV NODE_ENV=production \
    EMULATOR_PORT=8080
WORKDIR /app

RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/bin/corepack /usr/local/lib/node_modules/corepack \
           /opt/yarn* 2>/dev/null || true; \
    addgroup -S emulator && adduser -S emulator -G emulator

RUN mkdir -p /data && chown emulator:emulator /data

COPY --chown=emulator:emulator package.json ./package.json
COPY --chown=emulator:emulator api/package.json ./api/package.json

COPY --chown=emulator:emulator --from=prod-deps /repo/node_modules ./node_modules
COPY --chown=emulator:emulator --from=api-build /repo/api/dist ./api/dist

USER emulator

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.EMULATOR_PORT||8080)+'/login.fcgi', {method:'POST', body:'{}'}).then(r=>process.exit(r.status===400?0:1)).catch(()=>process.exit(1))"

CMD ["node", "api/dist/main.js"]
