# Cloud Kitchen (Grovyn Autopilot)

Cloud Kitchen Operations Intelligence — a template-driven, multi-tenant-ready application.
The same codebase deploys as many independent client instances (e.g. Restaurant A, Restaurant B)
with **zero source changes**; only environment variables, branding, and secrets differ per client.

A Node/Express **backend** (Core Data Service, in-memory seeded data) and a React/Vite
**frontend** (ops dashboard), deployed as two containers via Docker / Dokploy.

## Repository Structure

```
Cloud-Kitchen/                          # repo root
├── grovyn.config.json                  # deployment-platform manifest (services, ports, env contract)
├── .env.example                        # consolidated env reference
├── docker-compose.yml                  # local/single-host reference deployment
├── deployment/README.md                # ports, env vars, reverse proxy, SSL, onboarding
├── backend/                            # Core Data Service (Node.js + Express)
│   ├── Dockerfile, .dockerignore
│   ├── .env.example
│   └── src/
│       ├── config/                     # Central config: port, CORS, auth, seed options, service name/version
│       ├── models/                     # City, Store, Brand, SKU, Customer, Order (plain JS)
│       ├── services/                   # Data access + business logic (in-memory; seeded at boot)
│       ├── routes/                     # Request/response only; v1 under /api/v1, plus /health alias
│       ├── middleware/                 # Auth (stateless signed tokens) + RBAC
│       ├── seed/                       # Deterministic synthetic data generator
│       └── app.js, server.js, bootstrap.js
├── frontend/                           # React + Vite ops dashboard
│   ├── Dockerfile, .dockerignore, nginx.conf, docker-entrypoint.sh
│   ├── .env.example
│   ├── public/runtime-config.js        # default (empty) runtime branding config
│   └── src/
│       ├── config/site.ts              # centralized branding/config — components read from here
│       └── auth/, components/, pages/, services/api.ts
├── HOW-TO-RUN.md                       # plain-language local run guide
└── WALKTHROUGH.md                      # feature walkthrough (non-technical)
```

## Data Models (Core Contract)

| Entity   | Key fields |
|----------|------------|
| **City** | id, name, country, timezone |
| **Store**| id, cityId, name, status (active/paused/maintenance), operatingHours |
| **Brand**| id, storeId, name, commissionRate |
| **SKU**  | id, brandId, name, price, cost |
| **Customer** | id, phone, createdAt |
| **Order**| id, storeId, brandId, customerId, totalAmount, commissionAmount, createdAt |

Relationships are explicit: Store → City, Brand → Store, SKU → Brand, Order → Store/Brand/Customer.

## Seeded Data (Deterministic)

On backend start, the seed runs with a **fixed random seed** so every run and every API call returns the same data:

- 2 cities
- 3 stores per city (6 stores)
- 2 brands per store (12 brands)
- ~30 SKUs per brand (~360 SKUs)
- ~4,000 customers
- ~5,000 orders

Data is stored **in memory** (no database yet — see Technical Debt notes in `deployment/README.md`).

## Internal API (v1)

All endpoints are under **`/api/v1/`**. Response shape: `{ data: [...], meta: { count } }`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/health` | Service status and timestamp |
| GET | `/api/v1/cities` | All cities |
| GET | `/api/v1/stores` | All stores |
| GET | `/api/v1/brands` | All brands |
| GET | `/api/v1/skus` | All SKUs |
| GET | `/api/v1/customers` | All customers |
| GET | `/api/v1/orders` | All orders |

Use **Postman** (or any HTTP client) to hit `http://localhost:3001/api/v1/...` once the backend is running.

## Running the platform locally (without Docker)

### Backend

```bash
cd backend
npm install
npm start
```

Server runs on **port 3001** by default (override with `PORT`). On boot it logs seed counts and exits with code 1 if seed generation fails.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on **port 5173** (Vite dev server) and shows the full ops dashboard (auth, stores, finance, alerts, simulator).

## Quick start with Docker

```bash
cp .env.example .env   # set SESSION_SECRET at minimum
docker compose --env-file .env up --build
```

Frontend: http://localhost:8080 · Backend: http://localhost:3001/api/v1/health

## Required Environment Variables

See [`backend/.env.example`](backend/.env.example) and [`frontend/.env.example`](frontend/.env.example)
for full templates, or the consolidated [`.env.example`](.env.example). Summary:

| Service  | Variable | Required | Purpose |
|----------|----------|----------|---------|
| backend  | `CORS_ORIGIN` | yes (prod) | allowed frontend origin(s) |
| backend  | `SESSION_SECRET` | yes (prod) | signs stateless session tokens |
| backend  | `PORT`, `NODE_ENV`, `AUTH_DEMO_PASSWORD`, `AUTH_DEMO_ENABLED`, `SERVICE_NAME` | no | see `.env.example` |
| frontend | `VITE_API_BASE_URL` | yes (prod) | backend origin, no trailing slash |
| frontend | `VITE_BRAND_*`, `VITE_SUPPORT_*`, `VITE_COMPANY_ADDRESS`, `VITE_SHOW_DEMO_CREDENTIALS` | no | branding/config, see below |

Nothing else needs to change per client — see [`grovyn.config.json`](grovyn.config.json) for
the full machine-readable environment contract.

## Configuration & Branding

All UI branding is centralized in [`frontend/src/config/site.ts`](frontend/src/config/site.ts)
(`siteConfig`) — components read from it instead of hardcoding names/colors/contact info.
It resolves values in this order so the same built image can serve multiple clients:

1. `window.__RUNTIME_CONFIG__` — injected into `public/runtime-config.js` by
   `frontend/docker-entrypoint.sh` from container environment variables at container start.
2. `import.meta.env.VITE_*` — baked in at build time (local dev, or a per-client build).
3. Hardcoded defaults matching the original Grovyn Autopilot branding.

This covers product/company name, logo, favicon, primary/secondary theme colors (as CSS custom
properties), support email/phone/address, and whether the demo-login hint is shown. To onboard a
new client, set the `VITE_*` environment variables described above — no component changes needed.

The backend has no UI branding; its only per-client identity value is `SERVICE_NAME`, reported by
the health endpoint.

## Health Endpoint

`GET /api/v1/health` (and the unversioned alias `GET /health`) returns:

```json
{ "status": "ok", "service": "grovyn-autopilot", "timestamp": "2026-01-01T00:00:00.000Z", "version": "1.0.0" }
```

`service` and `version` come from `SERVICE_NAME` and `backend/package.json` respectively, so they
stay accurate per client/build without manual edits.

## Docker

Each service has its own multi-stage, non-root, healthchecked Dockerfile:

- `backend/Dockerfile` — `node:20-alpine`, production deps only, runs as the built-in `node` user.
- `frontend/Dockerfile` — builds the Vite bundle, serves it via `nginxinc/nginx-unprivileged`
  (non-root by default), with `docker-entrypoint.sh` regenerating `runtime-config.js` from env
  vars on container start.

From the repo root: `docker compose up --build`.

## Deployment (Dokploy / self-hosted)

This repo is deployed on a self-hosted Oracle server via **Dokploy**. See
[`grovyn.config.json`](grovyn.config.json) for the machine-readable service/build/env manifest,
and [`deployment/README.md`](deployment/README.md) for prose deployment docs — ports, required env
vars, reverse proxy, SSL, health checks, and how to onboard a new client instance (each client is
its own Dokploy application/compose project pointed at this same repo, differing only in env vars).

## Milestone notes

The backend started as a "Core Data Service" milestone (unified models, deterministic seeded
data, versioned internal APIs) and has since grown auth, RBAC, finance/inventory/staff insights,
and the AI Autopilot/expansion-simulator features on top of that foundation. There is still no
database — everything is in-memory and reseeded on every boot; see `deployment/README.md` for
what that means for persistence.
