# syntax = docker/dockerfile:1

ARG NODE_VERSION=24.14.1

FROM node:${NODE_VERSION}-slim AS base

ARG PORT=3000

ENV NODE_ENV=production

WORKDIR /app

# Build
FROM base AS build

# Install Git if package.json or package-lock.json contains dependencies that require it (e.g., dependencies with 'git+' URLs)
RUN apt-get update && apt-get install -y git

COPY --link package.json .
# ERROR  Cannot find native binding. npm has a bug related to optional dependencies (https://github.com/npm/cli/issues/4828). Please try npm i again after removing both package-lock.json and node_modules directory.
# COPY package-lock.json .

RUN npm install --production=false

COPY --link . .

RUN npm run build
RUN npm prune

# Run
FROM base

ENV PORT=$PORT
#ENV HOST 0.0.0.0

# SQLite lives on the persisted /data volume; server and CLI share this default.
ENV DATABASE_PATH=/data/srvkit.db

COPY --from=build /app/.output /app/.output
COPY package.json /app
# Optional, only needed if you rely on unbundled dependencies
# COPY --from=build /app/node_modules /app/node_modules

# `srvkit` on PATH so `docker exec srvkit srvkit change-password "..."` works.
# The CLI is bundled self-contained into .output/bin by `npm run build`.
RUN printf '#!/bin/sh\nexec node /app/.output/bin/srvkit.mjs "$@"\n' > /usr/local/bin/srvkit \
    && chmod +x /usr/local/bin/srvkit

CMD [ "node", ".output/server/index.mjs" ]
