# SPDX-License-Identifier: AGPL-3.0-only
# Stage 1: Install dependencies (offline-ready)
FROM node:24-slim AS deps
RUN corepack enable && corepack prepare pnpm@12.18.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/admin/package.json ./apps/admin/package.json 2>/dev/null || true
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/eslint-config/package.json ./packages/eslint-config/package.json
COPY packages/tsconfig/package.json ./packages/tsconfig/package.json
RUN pnpm fetch --filter @app/api...

# Stage 2: Build the application
FROM node:24-slim AS build
RUN corepack enable && corepack prepare pnpm@12.18.0 --activate
WORKDIR /app
COPY --from=deps /app /app
COPY . .
RUN pnpm install --offline --frozen-lockfile --filter @app/api...
RUN pnpm --filter @app/api build
RUN pnpm --filter @app/api fetch-model
RUN pnpm deploy --filter @app/api --prod /out

# Stage 3: Runtime image
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app/dist
COPY --from=build /app/models /app/models
EXPOSE 3000
USER node
CMD ["node", "dist/main.js"]
