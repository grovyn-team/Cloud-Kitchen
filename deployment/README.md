# Deploying Grovyn

Self-hosted, Docker Compose, single host: Postgres + backend + frontend. No
PgBouncer or other external connection pooler — the backend's own `pg` pool
(tens of connections) talks directly to Postgres, against its default
100-connection limit. This replaces the Vercel/Netlify template residue
(`vercel.json`, `netlify.toml`, the old `DEPLOY.md`) this repo carried since
before Phase 0 — none of that was ever a real, exercised deployment path.

## 1. Set up environment

From the repo root:

```sh
cp .env.example .env
```

Edit `.env` and set real values for:

| Variable | What it is |
|---|---|
| `POSTGRES_SUPERUSER_PASSWORD` | Postgres superuser password (used only to create the database + bootstrap the two application roles). |
| `GROVYN_MIGRATOR_PASSWORD` | `grovyn_migrator` role password — BYPASSRLS, schema/migration-time only, never serves a request. |
| `GROVYN_APP_PASSWORD` | `grovyn_app` role password — the NOBYPASSRLS role every live request runs as. |
| `CORS_ORIGIN` | Your real public frontend URL (or `http://localhost:8080` for a local same-host test). |
| `FRONTEND_PORT` | Host port to publish the frontend on (default `8080`). |

Generate strong passwords, e.g.:

```sh
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

**Do not reuse `docker-compose.yml`'s defaults or the placeholder values in
`backend/drizzle/bootstrap-roles.sql` outside local dev.** The migrate step
below sets the roles' real passwords from your `.env` on every run, but only
if you actually put real values there.

**What the app requires to boot at all**: `DATABASE_APP_URL` (wired
automatically by compose from `GROVYN_APP_PASSWORD` above) — the backend
throws at import time without it. There is **no** `SESSION_SECRET`
requirement anymore; that gated the legacy demo-auth HMAC path, which was
retired (Integration Task 2, round 3) along with the check itself. If you
find a reference to `SESSION_SECRET` being required anywhere else in older
docs, it's stale — trust this file and the code over it.

## 2. Bring the stack up

```sh
docker compose up --build
```

Startup order (enforced by compose `depends_on`/healthchecks):

1. `postgres` starts, waits until `pg_isready` passes.
2. `migrate` runs once: creates the `grovyn` database, bootstraps the
   `grovyn_migrator`/`grovyn_app` roles (idempotent — safe to re-run),
   ALTERs both to your real `.env` passwords, then applies every migration
   in `backend/drizzle/*.sql` in order, as `grovyn_migrator` (so it owns the
   tables the GRANT statements target — running as any other role here
   produces `permission denied`, a real gap this task found and fixed in
   `bootstrap-roles.sql` itself: Postgres 15+ no longer grants `CREATE` on
   the `public` schema to non-superusers by default).
3. `backend` starts once `migrate` exits 0, waits for its own `/api/v1/health`
   healthcheck to pass.
4. `frontend` (nginx, serving the built SPA + reverse-proxying `/api/*` to
   `backend`) starts once `backend` is healthy.

Visit `http://localhost:${FRONTEND_PORT}` (default `8080`).

### Why not `npm run db:migrate` (drizzle-kit's own CLI)?

Reproduced locally, repeatedly, on a clean container while building this
task: `drizzle-kit migrate` hangs on its own progress spinner and exits 1
with no error output at all — untriaged, but consistently reproducible, so
it isn't used for the unattended `migrate` service. `backend/scripts/migrate.sh`
applies each migration file directly via `psql` instead — the same recipe
this repo's `*.pgtest.mjs` suites and CI workflow both already use
successfully.

## 3. Create your first tenant + admin

There is no self-serve tenant signup yet (a deliberately deferred decision,
D-015) — the first tenant and its admin user are provisioned directly in the
database:

```sh
docker compose exec postgres psql -U postgres -d grovyn -c "
INSERT INTO tenant (id, name, slug, branch_limit, seat_limit)
VALUES (gen_random_uuid(), 'Your Restaurant', 'your-restaurant', 10, 20);
"
```

Then hash a real password and insert the admin user + an initial GST rate
(every tenant needs one before it can record a sale — Integration Task 2,
round 3 made this fail closed, not a silent default):

```sh
docker compose exec backend node -e "
import('./src/services/passwordService.js').then(async ({ hashPassword }) => {
  console.log(await hashPassword('your-real-password'));
});
"
```

```sh
docker compose exec postgres psql -U postgres -d grovyn -c "
INSERT INTO \"user\" (tenant_id, email, name, password_hash, role)
SELECT id, 'admin@your-restaurant.example', 'Admin', '<paste hash here>', 'ADMIN'
FROM tenant WHERE slug = 'your-restaurant';

INSERT INTO tax_rate (tenant_id, rate_percent, effective_from)
SELECT id, 5.00, CURRENT_DATE
FROM tenant WHERE slug = 'your-restaurant';
"
```

Log in at the frontend with that email/password and tenant slug.

## 4. Health checks

- Backend: `GET /api/v1/health` (also the container's own Docker
  `HEALTHCHECK`).
- Frontend: `GET /` (container `HEALTHCHECK` via `wget`).
- Every tenant has a resolvable GST rate (operational diagnostic, not part
  of the request path — see "why this exists" in
  `backend/scripts/check-tenant-gst-rates.mjs`):

  ```sh
  docker compose exec backend sh -c \
    "DATABASE_MIGRATOR_URL=postgresql://grovyn_migrator:\$GROVYN_MIGRATOR_PASSWORD@postgres:5432/grovyn node scripts/check-tenant-gst-rates.mjs"
  ```

## 5. Backups

See the repo root's `deployment/backup.sh` and the "Backup and restore"
section there-adjacent (Integration Task 6, round 3) — scheduled `pg_dump`,
plus a proven restore, not just a configured job.

## 6. Bringing it down / resetting

```sh
docker compose down        # stop, keep data
docker compose down -v     # stop AND delete the postgres_data volume (all data)
```
