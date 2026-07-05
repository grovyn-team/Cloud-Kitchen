# Deployment Guide

How to run this repository as a client instance on the self-hosted **Oracle server via Dokploy**
(or any other Docker-capable host/PaaS). The repository is template-driven: **one codebase, many
clients** — only environment variables change per client. See
[`grovyn.config.json`](../grovyn.config.json) for the machine-readable version of everything below.

## Services

This repo builds **two independent containers** from the repo root (`backend/` and `frontend/`):

| Service  | Path       | Dockerfile             | Port | Health check  |
|----------|------------|-------------------------|------|---------------|
| backend  | `backend`  | `backend/Dockerfile`   | 3001 | `GET /health` |
| frontend | `frontend` | `frontend/Dockerfile`  | 8080 | `GET /`       |

Each client gets its own pair of containers (its own Dokploy application(s) or compose project),
configured entirely through environment variables — no source changes required.

## Dokploy setup

Recommended: one **Compose** application in Dokploy pointed at this repo's
[`docker-compose.yml`](../docker-compose.yml), with the env vars below set in Dokploy's
environment editor for that application. Repeat per client (new Dokploy project/app, same repo
and compose file, different env vars and different domain).

Alternative: two separate Dokploy **Application** entries (Dockerfile-based), one per service:
- Backend: build context `backend/`, Dockerfile `backend/Dockerfile`, internal port `3001`.
- Frontend: build context `frontend/`, Dockerfile `frontend/Dockerfile`, internal port `8080`.

Either way, point Dokploy's domain/reverse-proxy config at the frontend for the client's main
domain, and at the backend for the API subdomain (see **Reverse proxy** below), and let Dokploy
handle SSL (it provisions Let's Encrypt certs automatically per domain).

## Quick start (local / single host)

```bash
cp .env.example .env      # fill in SESSION_SECRET at minimum
docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file .env up --build
```

Frontend: http://localhost:8080 · Backend: http://localhost:3001

## Required environment variables

### Backend

| Variable             | Required | Notes |
|-----------------------|----------|-------|
| `NODE_ENV`            | no       | `production` in deployment |
| `PORT`                | no       | default `3001` |
| `CORS_ORIGIN`         | **yes**  | comma-separated list of this client's frontend origin(s) |
| `SESSION_SECRET`      | **yes**  | HMAC secret for session tokens; unique per client, keep private |
| `AUTH_DEMO_PASSWORD`  | no       | demo login password; override or rotate per client |
| `AUTH_DEMO_ENABLED`   | no       | set `false` to disable the built-in demo login for a real client |
| `SERVICE_NAME`        | no       | reported by the health endpoint; set to identify the client in logs/monitoring |

### Frontend

| Variable                       | Required | Notes |
|----------------------------------|----------|-------|
| `VITE_API_BASE_URL`             | **yes**  | this client's backend origin, no trailing slash |
| `VITE_BRAND_NAME`               | no       | product/company name shown in the UI |
| `VITE_BRAND_SHORT_NAME`         | no       | short form used in compact UI copy |
| `VITE_BRAND_LOGO_URL`           | no       | client logo |
| `VITE_BRAND_FAVICON_URL`        | no       | client favicon |
| `VITE_BRAND_PRIMARY_COLOR`      | no       | HSL triplet, e.g. `221 83% 53%` |
| `VITE_BRAND_SECONDARY_COLOR`    | no       | HSL triplet |
| `VITE_SUPPORT_EMAIL`            | no       | shown in the UI if set |
| `VITE_SUPPORT_PHONE`            | no       | shown in the UI if set |
| `VITE_COMPANY_ADDRESS`          | no       | shown in the UI if set |
| `VITE_SHOW_DEMO_CREDENTIALS`    | no       | set `false` to hide the demo login hint for real clients |

The frontend variables can be supplied **either** at build time (`docker build --build-arg …`,
one image per client) **or** at container runtime (plain `docker run -e …` / compose
`environment:`, one image for every client). Runtime values win — see
[`frontend/docker-entrypoint.sh`](../frontend/docker-entrypoint.sh)
and `src/config/site.ts`. Runtime injection is the recommended path for the deployment
platform: build the image once, deploy it many times with different env vars.

## Ports

- Backend container listens on **3001** (internal), configurable via `PORT`.
- Frontend container listens on **8080** (internal, nginx-unprivileged default).
- Map these to whatever host ports / platform routing your environment uses; nothing in the
  application assumes a specific external port.

## Volumes / persistent storage

**None required.** Both services are stateless:
- The backend generates deterministic in-memory seed data on boot (no database, no disk writes).
- The frontend is a static build served by nginx.

If a future milestone adds a real database, document its volume/connection requirements here
and in `grovyn.config.json`; today there is nothing to persist or back up.

## Reverse proxy

Put a reverse proxy (the deployment platform's router, Traefik, nginx, Caddy, etc.) in front of
both containers per client:

```
https://<client>.grovyn.in           -> frontend:8080
https://api.<client>.grovyn.in       -> backend:3001
```

Example bare nginx upstream snippet:

```nginx
location / {
  proxy_pass http://frontend:8080;
  proxy_set_header Host $host;
}
location /api/ {
  proxy_pass http://backend:3001;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

Set the frontend's `VITE_API_BASE_URL` to the public API URL (`https://api.<client>.grovyn.in`),
and the backend's `CORS_ORIGIN` to the public frontend URL.

## SSL / TLS

Both containers serve plain HTTP internally. Terminate TLS at the reverse proxy / platform
edge (Let's Encrypt via the platform, or your load balancer) — the application does not manage
certificates itself. There is no hardcoded requirement for HTTPS internally, but production
`CORS_ORIGIN` values should always be `https://`.

## Health checks

- Backend: `GET /health` and `GET /api/v1/health` → `{ status, service, timestamp, version }`.
- Frontend: `GET /` → `200` from nginx once the static bundle is served.
- Both Dockerfiles declare a `HEALTHCHECK`; the deployment platform can also probe these paths
  directly for readiness/liveness.

## Onboarding a new client (e.g. "Restaurant B")

1. Provision a backend + frontend container pair from this same image/repo — no code changes.
2. Set backend env vars: `CORS_ORIGIN`, `SESSION_SECRET` (unique), `SERVICE_NAME`.
3. Set frontend env vars: `VITE_API_BASE_URL` (pointing at the new backend), branding vars
   (`VITE_BRAND_NAME`, colors, logo, support contact), `VITE_SHOW_DEMO_CREDENTIALS=false`.
4. Point DNS/reverse proxy at the new containers.
5. Verify `GET /health` on the backend and `GET /` on the frontend before cutting traffic over.

## Deployment platform integration (current: Dokploy, future: Grovyn platform)

- `grovyn.config.json` at the repo root is the machine-readable manifest a platform (Dokploy today,
  a future in-house Grovyn platform tomorrow) can parse to discover services, ports, build/start
  commands, Dockerfiles, and the environment variable contract (including which are `required`,
  `public`, or `secret`).
- The frontend's runtime-config mechanism (`public/runtime-config.js`, regenerated by
  `docker-entrypoint.sh`) means the platform can reuse **one built frontend image** across every
  client and only vary environment variables — no per-client build step is required unless the
  platform prefers baked-in build args for immutability.
- The backend currently has no database; if/when one is introduced, extend
  `grovyn.config.json`'s backend `environment` array and this document with connection string,
  volume, and migration requirements before onboarding clients that need persistence.
