# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Control-iD Facial Emulator - Web Image
#
# Focuses exclusively on the React Frontend served via Nginx.
# Stages:
#   1. web-build  : compile the React SPA (Vite)
#   2. runner     : Nginx alpine image serving static files and reverse proxying
#                   API requests to ${API_HOST}
# ---------------------------------------------------------------------------

# ---------- Stage 1: web build ----------
FROM node:22-alpine AS web-build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY web/package.json ./web/package.json
RUN npm ci

COPY web ./web
RUN npm run -w web build

# ---------- Stage 2: runner (Nginx) ----------
FROM nginx:alpine AS runner

# We define API_HOST here so envsubst has a fallback if not provided
ENV API_HOST=http://api:8080

# Clean default Nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx template (nginx image auto-processes templates in this dir)
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Copy built SPA into the /admin subdirectory since vite.config.ts uses base: '/admin/'
COPY --from=web-build /repo/web/dist /usr/share/nginx/html/admin

EXPOSE 80

# The standard nginx:alpine image entrypoint automatically runs envsubst
# on /etc/nginx/templates/*.template and starts nginx.
CMD ["nginx", "-g", "daemon off;"]
