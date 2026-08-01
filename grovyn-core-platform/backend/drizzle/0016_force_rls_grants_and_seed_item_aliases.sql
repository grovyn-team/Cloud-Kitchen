-- Integration Task 1 (round 3) — FORCE ROW LEVEL SECURITY + GRANT companion
-- for 0015's new `inventory_item_alias` table (drizzle-orm's pg-core has no
-- DSL for these, same reason every prior "force_rls_and_grants" migration in
-- this repo is hand-written), PLUS the one-time seed: every existing
-- inventory item gets itself as an alias, so exact-name-match keeps working
-- unchanged for any CSV that already used the item's real name.
--
-- Assumes `grovyn_migrator` / `grovyn_app` already exist (bootstrap-roles.sql)
-- and this migration runs as `grovyn_migrator` (BYPASSRLS), same as every
-- prior one.

-- Seed: one alias per existing active item, alias_name = the item's own
-- name. ON CONFLICT DO NOTHING guards the (branch_id, lower(alias_name))
-- unique index in case two items in the same branch already share a
-- case-insensitive name (pre-existing data quality issue, not this
-- migration's job to resolve) -- the first one wins, the rest are simply not
-- seeded an alias (they still have their own future alias-adding path via
-- the new admin UI).
INSERT INTO inventory_item_alias (tenant_id, branch_id, inventory_item_id, alias_name)
SELECT tenant_id, branch_id, id, name
FROM inventory_item
WHERE deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- FORCE RLS + GRANT, same pattern as every other table. SELECT, INSERT,
-- UPDATE, DELETE all granted -- unlike almost every other table in this
-- schema, an alias is ordinary lookup data, not a financial/audit record;
-- removing a wrong alias should actually remove it, not soft-delete it.
ALTER TABLE "inventory_item_alias" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "inventory_item_alias" TO grovyn_app;
