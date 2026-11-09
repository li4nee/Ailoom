# SPDX-License-Identifier: AGPL-3.0-only
# Stage 1: Build the admin web app
FROM node:24-slim AS build
RUN corepack enable && corepack prepare pnpm@12.18.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY apps/admin/package.json ./apps/admin/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN pnpm fetch --filter @app/admin...
COPY . .
RUN pnpm install --offline --frozen-lockfile --filter @app/admin...
RUN pnpm --filter @app/admin build

# Stage 2: nginx runtime
FROM nginx:alpine AS runtime
COPY --from=build /app/apps/admin/dist /srv/admin
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
