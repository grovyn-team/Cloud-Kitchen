-- Integration Task 4 — FORCE ROW LEVEL SECURITY + GRANT companion for
-- 0013's new `tax_rate` table (drizzle-orm's pg-core has no DSL for these,
-- same reason every prior "force_rls_and_grants" migration is hand-written)
-- PLUS the one-time data backfill for the two new `sale_line_item` columns
-- (`gst_rate_percent`/`tax_amount`, added nullable in 0013 specifically so
-- this backfill could run before any NOT NULL constraint) and the
-- consequent recompute of `sale.tax_amount`/`sale.total_amount` from real
-- line-item sums instead of the old caller-supplied lump value.
--
-- Assumes `grovyn_migrator` / `grovyn_app` already exist (bootstrap-roles.sql)
-- and this migration runs as `grovyn_migrator` (BYPASSRLS), same as every
-- prior one — the backfill below intentionally touches every tenant's rows
-- in one pass, which is exactly what a migrator-run migration is for.

-- Step 1: give every existing tenant ONE open-ended historical rate row.
-- Before this migration there was structurally only ever one rate in effect
-- per tenant (the old single `tenant.settings.tax.gstRate` label, or the
-- 5.00 default) — so a single row covering all of recorded history to date,
-- still open (`effective_to IS NULL`), is the accurate historical record,
-- not an approximation. `effective_from` is a sentinel date safely before
-- this template's demo data or any real tenant's onboarding date.
INSERT INTO tax_rate (tenant_id, rate_percent, effective_from, effective_to)
SELECT
  t.id,
  COALESCE(NULLIF((t.settings -> 'tax' ->> 'gstRate'), '')::numeric(5, 2), 5.00),
  DATE '2000-01-01',
  NULL
FROM tenant t;

-- Step 2: backfill every existing sale_line_item against the rate that was
-- (per Step 1) in force on its parent sale's sale_date — for all pre-
-- existing rows this resolves to the single row Step 1 just created, but the
-- query is written as a real effective-dated range lookup (not a flat
-- per-tenant join) so it is exactly the same resolution logic
-- `taxService`'s runtime resolver uses, not a one-off shortcut.
UPDATE sale_line_item sli
SET
  gst_rate_percent = tr.rate_percent,
  tax_amount = ROUND(sli.line_subtotal * tr.rate_percent / 100, 2)
FROM sale s, tax_rate tr
WHERE sli.sale_id = s.id
  AND tr.tenant_id = sli.tenant_id
  AND tr.effective_from <= s.sale_date
  AND (tr.effective_to IS NULL OR s.sale_date < tr.effective_to)
  AND sli.gst_rate_percent IS NULL;

-- Step 3: recompute each sale header's tax_amount/total_amount from the
-- REAL sum of its (now-backfilled) line items, replacing the old
-- caller-supplied lump tax_amount. subtotal_amount is untouched (line
-- subtotals didn't change, only how tax is derived from them).
UPDATE sale s
SET
  tax_amount = sub.total_tax,
  total_amount = s.subtotal_amount + sub.total_tax,
  updated_at = now()
FROM (
  SELECT sale_id, COALESCE(SUM(tax_amount), 0) AS total_tax
  FROM sale_line_item
  WHERE deleted_at IS NULL
  GROUP BY sale_id
) sub
WHERE s.id = sub.sale_id
  AND s.tax_amount IS DISTINCT FROM sub.total_tax;

-- Step 4: FORCE RLS + GRANT for tax_rate, same pattern as every other table.
-- SELECT, INSERT, UPDATE only — no DELETE (a rate row is closed via
-- `effective_to`, never removed; see schema.js's doc comment on this table).
ALTER TABLE "tax_rate" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON "tax_rate" TO grovyn_app;
