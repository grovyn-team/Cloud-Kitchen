-- P2/P3/P3.5/P6 — FORCE ROW LEVEL SECURITY + GRANT companion for 0006's new
-- tables (`sale`, `sale_line_item`, `inventory_item`, `inventory_movement`,
-- `customer`, `notification`, `tax_period_summary`), mirroring
-- 0001_force_rls_and_grants.sql / 0004_force_rls_and_grants_branch.sql
-- exactly. Hand-written for the same reason those were: drizzle-orm's
-- pg-core has no DSL for `FORCE ROW LEVEL SECURITY` or table-level `GRANT`
-- — only `ENABLE ROW LEVEL SECURITY` and `CREATE POLICY` are auto-generated
-- (see 0006).
--
-- `branch`'s new columns (0006) need no new GRANT — GRANT is table-level in
-- Postgres, not column-level, and `branch` was already granted
-- SELECT/INSERT/UPDATE in 0004_force_rls_and_grants_branch.sql; the new
-- columns are automatically covered.
--
-- Assumes `grovyn_migrator` / `grovyn_app` already exist (bootstrap-roles.sql)
-- and this migration runs as `grovyn_migrator`, same as every prior one.

ALTER TABLE "sale" FORCE ROW LEVEL SECURITY;
ALTER TABLE "sale_line_item" FORCE ROW LEVEL SECURITY;
ALTER TABLE "inventory_item" FORCE ROW LEVEL SECURITY;
ALTER TABLE "inventory_movement" FORCE ROW LEVEL SECURITY;
ALTER TABLE "customer" FORCE ROW LEVEL SECURITY;
ALTER TABLE "notification" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tax_period_summary" FORCE ROW LEVEL SECURITY;

-- sale / sale_line_item / inventory_item / customer / notification /
-- tax_period_summary: SELECT, INSERT, UPDATE only — no DELETE. Same
-- soft-delete-only discipline as every table before this one (D-008): a
-- correction sets `deleted_at` (or, for `notification`, updates `status`/
-- `resolved_at`), it never issues a real row DELETE. Withholding the DELETE
-- privilege from the runtime role enforces that at the privilege layer, not
-- just application discipline.
GRANT SELECT, INSERT, UPDATE ON "sale" TO grovyn_app;
GRANT SELECT, INSERT, UPDATE ON "sale_line_item" TO grovyn_app;
GRANT SELECT, INSERT, UPDATE ON "inventory_item" TO grovyn_app;
GRANT SELECT, INSERT, UPDATE ON "customer" TO grovyn_app;
GRANT SELECT, INSERT, UPDATE ON "notification" TO grovyn_app;
GRANT SELECT, INSERT, UPDATE ON "tax_period_summary" TO grovyn_app;

-- inventory_movement: SELECT, INSERT only — no UPDATE, no DELETE. Append-
-- only by design (this task's own instructions: "append-only similar to
-- audit_log"), same stricter treatment as `audit_log` itself
-- (0001_force_rls_and_grants.sql) — even a compromised or buggy application
-- identity authenticated as `grovyn_app` cannot alter or remove an existing
-- movement row, only add new ones.
GRANT SELECT, INSERT ON "inventory_movement" TO grovyn_app;
