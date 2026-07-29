-- Custom SQL migration file, put your code below! --

-- Hand-written on purpose (parity with the P1-00 spike finding): drizzle-orm's
-- pg-core has no DSL for `FORCE ROW LEVEL SECURITY` or table-level `GRANT`
-- statements — only `ENABLE ROW LEVEL SECURITY` and `CREATE POLICY` (the
-- load-bearing tenant-isolation predicate) are auto-generated in 0000. This
-- is not a regression of the D-002 decision: FORCE/GRANT being equally manual
-- in both Prisma and Drizzle was explicitly not a differentiator in the
-- spike (SPIKE.md gate 7) — `CREATE POLICY` being auto-generated in one and
-- 100%-manual in the other was.
--
-- Assumes `grovyn_migrator` / `grovyn_app` already exist (see
-- `drizzle/bootstrap-roles.sql`, run once per cluster before this migration).

-- FORCE ROW LEVEL SECURITY: makes RLS apply even to the table owner
-- (normally the owner bypasses RLS by default). Belt-and-suspenders here
-- since `grovyn_app` is not the table owner and RLS already applies to any
-- non-owner, non-BYPASSRLS role without FORCE — included anyway so table
-- ownership can never silently become a bypass path if it changes later.
ALTER TABLE "tenant" FORCE ROW LEVEL SECURITY;
ALTER TABLE "user" FORCE ROW LEVEL SECURITY;
ALTER TABLE "session" FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO grovyn_app;

-- tenant / user / session: SELECT, INSERT, UPDATE only — no DELETE grant at
-- all. D-008 is soft-delete-only for these tables (tombstone via
-- `deleted_at`/`revoked_at`, never a real row delete); withholding the
-- DELETE privilege from the runtime role enforces that at the privilege
-- layer, not just application discipline, so a future application bug
-- issuing a real DELETE is refused by Postgres before RLS is even
-- evaluated.
GRANT SELECT, INSERT, UPDATE ON "tenant" TO grovyn_app;
GRANT SELECT, INSERT, UPDATE ON "user" TO grovyn_app;
GRANT SELECT, INSERT, UPDATE ON "session" TO grovyn_app;

-- audit_log: SELECT, INSERT only — no UPDATE, no DELETE. Append-only by
-- nature (task scope: "you can't un-audit"); this is stricter than
-- tenant/user/session on purpose, matching the schema-level comment in
-- `src/db/schema.js`. Even a compromised or buggy application identity
-- authenticated as `grovyn_app` cannot alter or remove an existing audit
-- row — only add new ones.
GRANT SELECT, INSERT ON "audit_log" TO grovyn_app;
