# SPDX-License-Identifier: AGPL-3.0-only
# Production image for the web tier: Caddy serving the admin SPA and proxying /api and the
# widget to the api service (single origin). Build from the repo root:
#   docker build -f deploy/web.Dockerfile .

# --- build: compile the admin SPA ------------------------------------------------------------
FROM node:24-slim AS build
ENV PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN corepack enable && corepack install
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile --filter '@app/admin...'
RUN pnpm --filter '@app/admin...' run build

# --- runtime: Caddy ----------------------------------------------------------------------------
FROM caddy:2-alpine AS runtime
COPY --from=build /repo/apps/admin/dist /srv/admin
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY LICENSE /usr/share/licenses/ailoom/LICENSE
# Build-time syntax check; the real site address comes from PUBLIC_URL at run time.
RUN PUBLIC_URL=http://localhost caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
