# SPDX-License-Identifier: AGPL-3.0-only
# Production image for the api: one image, three entrypoints
#   node dist/main.js       HTTP api (default)
#   node dist/worker.js     background jobs
#   node dist/migrate.js    applies pending migrations, then exits
# Build from the repo root: docker build -f apps/api/Dockerfile .
# glibc base (node:24-slim, not alpine): onnxruntime-node ships glibc binaries only.

ARG NODE_IMAGE=node:24-slim

# --- deps: download every package in the lockfile into the pnpm store --------------------
FROM ${NODE_IMAGE} AS deps
ENV PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN corepack enable && corepack install
RUN pnpm fetch

# --- build: install offline, compile @app/shared + @app/api, fetch models, deploy -----------
FROM deps AS build
COPY . .
RUN pnpm install --offline --frozen-lockfile --filter '@app/api...' --filter '@app/widget...'
RUN pnpm --filter '@app/api...' --filter '@app/widget...' run build
RUN pnpm --filter @app/api fetch-model
# Production node_modules plus the package (dist/, package.json) in /out. Deploy reuses the
# workspace lockfile, which needs injected workspace packages (@app/shared is copied in, not
# linked). Not --offline: the supply-chain policy check reads registry metadata.
RUN pnpm --filter @app/api deploy --prod --config.inject-workspace-packages=true /out

# --- runtime --------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
# The runtime only runs `node dist/*.js`; the base image's bundled npm is dead weight and
# carries its own dependency tree (undici, brace-expansion) into every CVE scan.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
# /app/package.json sits beside /app/dist: the config loader reads the version from it.
COPY --from=build --chown=root:root /out/package.json ./package.json
COPY --from=build --chown=root:root /out/node_modules ./node_modules
COPY --from=build --chown=root:root /out/dist ./dist
# DEFAULT_MODELS_DIR resolves to <dist>/../models = /app/models.
COPY --from=build --chown=root:root /repo/apps/api/models ./models
# Served at /widget.js and /widget/<version>/* by WidgetAssetsController.
COPY --from=build --chown=root:root /repo/packages/widget/dist ./widget-dist
COPY --chown=root:root LICENSE ./LICENSE
# Uploaded files (STORAGE_DIR default); a fresh named volume inherits this ownership.
RUN mkdir -p /data/files && chown node:node /data/files
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
