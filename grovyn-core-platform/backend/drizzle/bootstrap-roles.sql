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

CREATE ROLE grovyn_migrator LOGIN PASSWORD 'CHANGE_ME_MIGRATOR' BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE grovyn_app LOGIN PASSWORD 'CHANGE_ME_APP' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
