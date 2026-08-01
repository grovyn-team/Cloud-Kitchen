# Integration Task 5, round 3 — production backend image. Multi-stage:
# `deps` installs production-only dependencies once (cached across builds
# unless package*.json changes), `runtime` copies just node_modules + source
# into a slim final image. No build step needed (plain Node ESM, no bundler).

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY drizzle ./drizzle
COPY scripts ./scripts

# Runs as the unprivileged `node` user the base image already provides --
# never root in the running container.
USER node

EXPOSE 3001

# Uses Node's own global fetch (no curl in this base image) against the
# existing, pre-real-auth-dependency `/api/v1/health` endpoint.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3001)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]

# ---------------------------------------------------------------------------
# `migrate` target -- the one-shot compose service that applies migrations
# before `backend` starts (see `docker-compose.yml`, `scripts/migrate.sh`).
# Separate target (not the runtime image) because it needs the `psql` CLI,
# which the request-serving image has no reason to carry.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS migrate
RUN apk add --no-cache postgresql-client
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY drizzle ./drizzle
COPY scripts ./scripts
RUN chmod +x scripts/migrate.sh
CMD ["sh", "scripts/migrate.sh"]
