/**
 * Integration Task 4 (round 2) / hardened in round 3 — effective-dated GST
 * rate resolution. Single source of truth for "what rate applies to a sale
 * line dated X", used by every write path that creates a `sale_line_item`
 * (`saleService.createSale`, `salesCsvImportService`'s batch insert) so the
 * resolution logic exists exactly once, not duplicated per caller.
 *
 * Integration Task 2, round 3 (fail-closed, not a silent default): round 2
 * shipped this with a silent `DEFAULT_GST_RATE_PERCENT` fallback when a
 * tenant had no covering rate row -- flagged in that round's own security
 * self-review as wrong for money (an incorrect tax figure computed
 * invisibly, that then reaches a CA, is worse than a loud failure). That
 * fallback is REMOVED: `resolveEffectiveGstRate` now throws
 * `NoGstRateConfiguredError` and `resolveRateFromHistory` returns `null` --
 * a sale cannot be written without a resolvable rate, full stop. Callers
 * (`saleService.createSale`, `salesCsvImportService.validateAndBuildRows`,
 * and their routes) are responsible for turning that into a clear error,
 * not swallowing it.
 *
 * Every exported function here takes a tenant-scoped `db`
 * (`../db/dal.js`'s `createScopedDb`) -- same contract as every other
 * service in this codebase; RLS confines `tax_rate` reads to the caller's
 * own tenant.
 */

import { and, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { schema } from '../db/dal.js';
import { round2 } from '../utils/validation.js';

export class NoGstRateConfiguredError extends Error {}
export class NonMonotonicGstRateError extends Error {}

/**
 * Resolves the GST rate percent in force for `tenantId` on `saleDate`
 * (`YYYY-MM-DD`) — the row where
 * `effective_from <= saleDate AND (effective_to IS NULL OR saleDate < effective_to)`.
 * Throws `NoGstRateConfiguredError` if no row covers the date -- there is no
 * default to fall back to; a sale cannot be recorded without a real,
 * resolvable rate (Integration Task 2, round 3).
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

  if (!row) {
    throw new NoGstRateConfiguredError(`No GST rate is configured for this tenant covering ${saleDate}.`);
  }
  const n = Number(row.ratePercent);
  if (!Number.isFinite(n)) {
    throw new NoGstRateConfiguredError(`The GST rate configured for this tenant covering ${saleDate} is invalid.`);
  }
  return n;
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
 * against an already-fetched rate history array instead of querying.
 * Returns `null` (never a default) if nothing covers the date -- a pure
 * function can't itself decide "throw vs. collect as a row error", so it
 * hands the caller a signal instead: `salesCsvImportService
 * .validateAndBuildRows` turns a `null` here into a per-row import error
 * (same shape as an unmatched item name), which is more useful to a bulk
 * importer than one exception aborting the whole request with no row
 * context.
 * @param {{ratePercent: number, effectiveFrom: string, effectiveTo: string|null}[]} rateHistory
 * @param {string} saleDate
 * @returns {number|null}
 */
export function resolveRateFromHistory(rateHistory, saleDate) {
  const match = rateHistory.find(
    (r) => r.effectiveFrom <= saleDate && (r.effectiveTo === null || saleDate < r.effectiveTo)
  );
  return match ? match.ratePercent : null;
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
 * transaction -- never leaves two open rows for a tenant.
 *
 * Integration Task 2, round 3: wrapped in `pg_advisory_xact_lock`, keyed on
 * a hash of `tenantId`, held for the rest of the CURRENT transaction (auto-
 * released on COMMIT/ROLLBACK, no separate unlock call needed) -- two
 * concurrent calls for the SAME tenant now serialize instead of racing the
 * `tax_rate_tenant_open_unique_idx` partial unique index (which was the
 * only thing preventing corruption before this, and only by making the
 * SECOND caller's insert fail with a raw constraint-violation 500, not by
 * actually preventing the race). A different tenant's call is entirely
 * unaffected -- the lock key is tenant-specific, not global. `hashtext()`
 * returns a 32-bit int; cast to bigint for `pg_advisory_xact_lock`'s
 * single-key overload (the alternative two-int32-key overload would work
 * too, this is simpler for one key).
 *
 * Wired to `POST /api/v1/tax/rates` (`routes/tax.js`) as of round 3 --
 * previously exported but unreachable by any route (round 2 built the
 * model without a way for a user to actually use it).
 *
 * Monotonicity check (found by ACTUALLY firing 5 concurrent calls with
 * out-of-order `effectiveFrom` dates against a real container during this
 * task's verification, not reasoned about in the abstract): the advisory
 * lock alone serializes the writes -- no crash, no duplicate open row -- but
 * does NOT stop the SECOND-to-acquire-the-lock call from closing a row with
 * an `effectiveFrom` EARLIER than the one already open, which produces a
 * logically inverted interval (`effective_to < effective_from`) that no
 * date can ever resolve into. Closed here: once the lock is held, re-read
 * the current open row and reject (`NonMonotonicGstRateError`) if the new
 * `effectiveFrom` does not strictly exceed it -- turns a silent, permanent,
 * unreachable-rate data-integrity gap into a clear rejection the caller can
 * retry with a later date.
 * @param {*} db
 * @param {{tenantId: string, ratePercent: number, effectiveFrom: string}} args
 */
export async function setEffectiveGstRate(db, { tenantId, ratePercent, effectiveFrom }) {
  await db.raw('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [tenantId]);

  const [currentOpen] = await db
    .select({ effectiveFrom: schema.taxRate.effectiveFrom })
    .from(schema.taxRate)
    .where(and(eq(schema.taxRate.tenantId, tenantId), isNull(schema.taxRate.effectiveTo)));

  if (currentOpen && effectiveFrom <= currentOpen.effectiveFrom) {
    throw new NonMonotonicGstRateError(
      `effectiveFrom (${effectiveFrom}) must be after the currently open rate's effectiveFrom (${currentOpen.effectiveFrom}).`
    );
  }

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
