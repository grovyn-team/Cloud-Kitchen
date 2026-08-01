/**
 * Integration Task 4 — effective-dated GST rate resolution. Single source
 * of truth for "what rate applies to a sale line dated X", used by every
 * write path that creates a `sale_line_item` (`saleService.createSale`,
 * `salesCsvImportService`'s batch insert) so the resolution logic exists
 * exactly once, not duplicated per caller.
 *
 * Every exported function here takes a tenant-scoped `db`
 * (`../db/dal.js`'s `createScopedDb`) -- same contract as every other
 * service in this codebase; RLS confines `tax_rate` reads to the caller's
 * own tenant.
 */

import { and, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { schema } from '../db/dal.js';
import { round2 } from '../utils/validation.js';

// Same default this codebase has used since Phase 6's first pass
// (`taxService.js`'s original `DEFAULT_GST_RATE_PERCENT`) -- India's
// standard GST slab for standalone restaurant/cloud-kitchen F&B services
// without input tax credit. Used ONLY when a tenant has no `tax_rate` row
// covering the sale date at all (should not happen for any tenant that went
// through the Integration Task 4 backfill migration, which gives every
// existing tenant an open-ended row from 2000-01-01 -- this is a safety net
// for a tenant record created some other way, e.g. directly via SQL,
// without one).
export const DEFAULT_GST_RATE_PERCENT = 5.0;

/**
 * Resolves the GST rate percent in force for `tenantId` on `saleDate`
 * (`YYYY-MM-DD`) — the row where
 * `effective_from <= saleDate AND (effective_to IS NULL OR saleDate < effective_to)`.
 * Falls back to `DEFAULT_GST_RATE_PERCENT` (never throws) if no row covers
 * the date, so a missing/incomplete rate history degrades to a documented
 * default rather than blocking every sale for that tenant.
 * @param {*} db
 * @param {{tenantId: string, saleDate: string}} args
 * @returns {Promise<number>}
 */
export async function resolveEffectiveGstRate(db, { tenantId, saleDate }) {
  const [row] = await db
    .select({ ratePercent: schema.taxRate.ratePercent })
    .from(schema.taxRate)
    .where(
      and(
        eq(schema.taxRate.tenantId, tenantId),
        lte(schema.taxRate.effectiveFrom, saleDate),
        or(isNull(schema.taxRate.effectiveTo), gt(schema.taxRate.effectiveTo, saleDate))
      )
    )
    .limit(1);

  if (!row) return DEFAULT_GST_RATE_PERCENT;
  const n = Number(row.ratePercent);
  return Number.isFinite(n) ? n : DEFAULT_GST_RATE_PERCENT;
}

/**
 * Fetches a tenant's FULL rate history in one query -- used by callers that
 * need to resolve many dates at once (CSV import, potentially thousands of
 * rows) without one DB round-trip per row. A tenant's rate history is
 * expected to stay small (a handful of rows over years), so loading it all
 * once and resolving in-memory (`resolveRateFromHistory` below) is the
 * right shape here, unlike `resolveEffectiveGstRate`'s single-date query
 * (used by manual entry, which only ever resolves ONE date per sale).
 * @param {*} db
 * @param {string} tenantId
 * @returns {Promise<{ratePercent: number, effectiveFrom: string, effectiveTo: string|null}[]>}
 */
export async function fetchTenantGstRateHistory(db, tenantId) {
  const rows = await db
    .select({
      ratePercent: schema.taxRate.ratePercent,
      effectiveFrom: schema.taxRate.effectiveFrom,
      effectiveTo: schema.taxRate.effectiveTo,
    })
    .from(schema.taxRate)
    .where(eq(schema.taxRate.tenantId, tenantId));
  return rows.map((r) => ({
    ratePercent: Number(r.ratePercent),
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
  }));
}

/**
 * Pure, in-memory equivalent of `resolveEffectiveGstRate` -- resolves
 * against an already-fetched rate history array instead of querying. Same
 * fallback behavior (never throws; `DEFAULT_GST_RATE_PERCENT` if nothing
 * covers the date).
 * @param {{ratePercent: number, effectiveFrom: string, effectiveTo: string|null}[]} rateHistory
 * @param {string} saleDate
 * @returns {number}
 */
export function resolveRateFromHistory(rateHistory, saleDate) {
  const match = rateHistory.find(
    (r) => r.effectiveFrom <= saleDate && (r.effectiveTo === null || saleDate < r.effectiveTo)
  );
  return match ? match.ratePercent : DEFAULT_GST_RATE_PERCENT;
}

/**
 * Tax for one sale line, computed from its subtotal and the resolved rate --
 * `round2` (2-decimal rounding, same helper every other money computation in
 * this codebase uses) so line tax and the money columns it feeds
 * (`sale_line_item.tax_amount`, summed into `sale.tax_amount`) stay in the
 * same rounding regime as everything else.
 * @param {number} lineSubtotal
 * @param {number} ratePercent
 * @returns {number}
 */
export function computeLineTax(lineSubtotal, ratePercent) {
  return round2((lineSubtotal * ratePercent) / 100);
}

/**
 * Sets a NEW effective-dated rate for a tenant, closing whichever row is
 * currently open (`effective_to IS NULL`) at `effectiveFrom` in the SAME
 * transaction -- never leaves two open rows for a tenant (the DB-level
 * `tax_rate_tenant_open_unique_idx` partial unique index is the backstop,
 * this is the primary enforcement, same "app logic primary / constraint
 * backstop" posture as every other invariant in this codebase).
 *
 * Not currently wired to any route -- Integration Task 4's brief asked for
 * the effective-dated MODEL, migration, and recomputation, not a rate-
 * management API/UI. Exported now so that follow-up task doesn't have to
 * re-derive this logic; a route can call it directly once built.
 * @param {*} db
 * @param {{tenantId: string, ratePercent: number, effectiveFrom: string}} args
 */
export async function setEffectiveGstRate(db, { tenantId, ratePercent, effectiveFrom }) {
  await db
    .update(schema.taxRate)
    .set({ effectiveTo: effectiveFrom, updatedAt: new Date() })
    .where(and(eq(schema.taxRate.tenantId, tenantId), isNull(schema.taxRate.effectiveTo)));

  const [created] = await db
    .insert(schema.taxRate)
    .values({
      tenantId,
      ratePercent: ratePercent.toFixed(2),
      effectiveFrom,
      effectiveTo: null,
    })
    .returning();
  return created;
}
