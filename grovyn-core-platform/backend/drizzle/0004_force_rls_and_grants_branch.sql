-- P1-04 — FORCE ROW LEVEL SECURITY + GRANT companion for 0003's new tables
-- (`branch`, `staff_branch_access`), mirroring 0001_force_rls_and_grants.sql
-- exactly for the two P1-01 root tables. Hand-written for the same reason
-- 0001 was: drizzle-orm's pg-core has no DSL for `FORCE ROW LEVEL SECURITY`
-- or table-level `GRANT` — only `ENABLE ROW LEVEL SECURITY` and
-- `CREATE POLICY` are auto-generated (see 0003).
--
-- Assumes `grovyn_migrator` / `grovyn_app` already exist (bootstrap-roles.sql)
-- and this migration runs as `grovyn_migrator`, same as every prior one.

ALTER TABLE "branch" FORCE ROW LEVEL SECURITY;
ALTER TABLE "staff_branch_access" FORCE ROW LEVEL SECURITY;

-- branch: SELECT, INSERT, UPDATE only — no DELETE. Same soft-delete-only
-- discipline as tenant/user/session (D-008): a branch is tombstoned via
-- `deleted_at`, never really deleted, because later phases' sales/inventory
-- rows will FK to it.
GRANT SELECT, INSERT, UPDATE ON "branch" TO grovyn_app;

-- staff_branch_access: SELECT, INSERT, UPDATE only — no DELETE. Grants are
-- soft-revoked via `revoked_at` (see schema.js), never hard-deleted, so a
-- past access grant stays reconstructable for audit/forensics.
GRANT SELECT, INSERT, UPDATE ON "staff_branch_access" TO grovyn_app;
