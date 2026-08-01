-- Grovyn Postgres role bootstrap — RUN ONCE PER CLUSTER, MANUALLY, BEFORE
-- `npm run db:migrate` — this is deliberately NOT a drizzle-kit-tracked
-- migration (drizzle/0000, drizzle/0001, ...) because `CREATE ROLE` is a
-- cluster-wide object in Postgres, not a per-database one. If this were a
-- normal versioned migration, running it against a second database in the
-- same cluster (e.g. staging and prod sharing one Postgres instance, or a
-- fresh review-app database) would fail with "role already exists" on the
-- second run. This mirrors the P1-00 spike's approach exactly
-- (`spikes/p1-00-rls-pooling/sql/00-bootstrap-databases.sql` created
-- `grovyn_app` the same way, outside the migration chain).
--
-- Two roles, matching the spike's privilege-separation pattern (D-001,
-- verified in spike gate 5):
--   - `grovyn_migrator`: LOGIN + BYPASSRLS. Used ONLY for running migrations
--     (`db:migrate`) and any future cross-tenant seed script (P1-08). This is
--     the "infrastructure for this task" BYPASSRLS role the P1-01 task
--     explicitly allows — it is NOT the per-request runtime role and must
--     never serve an HTTP request.
--   - `grovyn_app`: LOGIN + NOBYPASSRLS. The runtime role every application
--     query runs as (wiring is P1-02/P1-03, not this task). RLS is a real
--     backstop for this role from the moment these tables exist.
--
-- Change both passwords before using outside local dev; in review/prod these
-- come from a secrets manager, never committed. This file has no secrets of
-- its own beyond local-dev placeholders.
--
-- Integration Task 4, round 3 — two real gaps found by actually running
-- migrations AS `grovyn_migrator` for the first time (every prior
-- verification this project has done, this session included, took the
-- shortcut of applying migrations as the `postgres` superuser, which
-- silently masked both of these):
--   1. IDEMPOTENCY: bare `CREATE ROLE` fails "role already exists" on a
--      second run against the same cluster (flagged as a known follow-up
--      since P1-10's notes, never actually done until now) -- wrapped in
--      `DO $$ ... IF NOT EXISTS ... $$` so review-apps/CI can re-run this
--      file safely.
--   2. SCHEMA PRIVILEGE: Postgres 15+ no longer grants CREATE on the
--      `public` schema to PUBLIC by default (a Postgres-version default
--      change, not a Grovyn-specific choice) -- without an explicit GRANT,
--      `grovyn_migrator` gets `permission denied for schema public` on the
--      very first `CREATE TABLE`, despite BYPASSRLS (BYPASSRLS is a row-
--      security attribute, not a schema-level privilege; the two are
--      unrelated). Reproduced locally against a real `postgres:16-alpine`
--      container while building this task's CI workflow.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grovyn_migrator') THEN
    CREATE ROLE grovyn_migrator LOGIN PASSWORD 'CHANGE_ME_MIGRATOR' BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grovyn_app') THEN
    CREATE ROLE grovyn_app LOGIN PASSWORD 'CHANGE_ME_APP' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT CREATE ON SCHEMA public TO grovyn_migrator;
