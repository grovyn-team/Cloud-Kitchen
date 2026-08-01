/**
 * Phase 6 — Tax (GST) module business logic. D-007 positioning (non-optional,
 * see `.claude/DECISIONS_LOG.md`): **India GST only**, and this module
 * *prepares and reconciles* sale data for the client's CA -- it is NOT an
 * audit, NOT a filing tool, and never generates tax advice/recommendations.
 * Every summary/export this module produces carries the
 * `CA_REVIEW_DISCLAIMER` below verbatim, not just in API docs.
 *
 * Every exported function here takes a tenant-scoped `db` (`../db/dal.js`'s
 * `createScopedDb`, always obtained via `withTenantContext(pool)` in
 * `../routes/tax.js`) -- same contract as `saleService.js`/
 * `financeManagementService.js`. `tenantId`/`branchId` are still passed
 * explicitly on writes because RLS's `WITH CHECK` validates the column
 * against the session GUC, it does not populate it (same reasoning as
 * every other service in this codebase).
 *
 * GST RATE MODELING -- Integration Task 4 (SEC-007), effective-dated:
 *   `sale_line_item` now carries `gst_rate_percent`/`tax_amount` PER LINE,
 *   resolved at write time (`saleService.createSale`/`salesCsvImportService`)
 *   against the `tax_rate` table's effective-dated history
 *   (`gstRateService.js`) -- the rate that was actually in force on that
 *   line's parent sale's `sale_date`, not whatever rate is current when a
 *   period is later summarized. This module's aggregation below is now a
 *   REAL `GROUP BY gst_rate_percent` over `sale_line_item` -- a mid-period
 *   rate change produces one `tax_period_summary` row PER distinct rate that
 *   was actually in force during the window, each with its own real
 *   `taxableAmount`/`taxAmount`/`saleCount`, not a single blended label
 *   applied after the fact. `tax_period_summary`'s
 *   `(tenant_id, branch_id, period_start, period_end, gst_rate)` unique
 *   index already supported this multi-row-per-period shape from the start
 *   (see `../db/schema.js`'s comment on that table) -- only the population
 *   logic needed to catch up to it, which is what this task does.
 *
 *   Superseded by this change: the old tenant-settings-level
 *   `resolveGstRate`/`getTenantTaxSettings`/single-row-per-period model,
 *   where `gstRate` was a DESCRIPTIVE LABEL only, never a real computation
 *   input (see git history for that version if needed) -- `tenant.settings
 *   .tax.gstRate` is no longer read anywhere; `gstRateService.js`'s
 *   `tax_rate` table is the one source of truth for rates now.
 */

import { isNull } from 'drizzle-orm';
import { schema } from '../db/dal.js';
import { round2 } from '../utils/validation.js';
import { sanitizeCsvCell } from './csvSanitize.js';

export const CA_REVIEW_DISCLAIMER =
  'Prepared for CA review - not a certified filing. This report reconciles recorded sales data for your Chartered Accountant; it is not a GST audit, not a filing document, and contains no tax advice.';

/**
 * Real SQL aggregation (not an in-memory reduce), `GROUP BY` the rate that
 * was actually in force on each line (`sale_line_item.gst_rate_percent`) --
 * a period spanning a rate change returns one row PER distinct rate, each
 * with its own real sums, not one blended figure. Runs on the already
 * tenant-scoped `db`, so RLS transparently confines this to the caller's own
 * tenant; `branchId` is a bound parameter, never string-interpolated.
 * `periodStart`/`periodEnd` are INCLUSIVE calendar-date bounds (caller-
 * supplied, already validated by the route as `YYYY-MM-DD` with
 * `periodStart <= periodEnd`) -- this matches how a CA thinks about a GST
 * return period (e.g. "1 July - 31 July"), unlike the rolling day/week/month
 * windows Dashboard/Finance use.
 *
 * `sale_line_item.line_subtotal` (not `sale.subtotal_amount`) is what's
 * summed into `taxableAmount` per bucket -- a sale's header total spans
 * every line, but a single sale CAN have lines taxed at different rates in
 * principle (a future multi-HSN-code line item would); bucketing at the
 * line level is the only way the per-rate totals are guaranteed to add up to
 * the sale-level totals. `saleCount` per bucket is a DISTINCT count of sale
 * ids (not line-item rows), so a sale with two lines at the same rate counts
 * once, matching what "how many sales fell under this rate" means to a CA.
 * @param {*} db
 * @param {{branchId: string, periodStart: string, periodEnd: string}} args
 * @returns {Promise<{gstRate:number, taxableAmount:number, taxAmount:number, saleCount:number}[]>}
 */
export async function computeGstFromSales(db, { branchId, periodStart, periodEnd }) {
  const result = await db.raw(
    `
      SELECT
        sli.gst_rate_percent AS "gstRate",
        COUNT(DISTINCT sli.sale_id)::int AS "saleCount",
        COALESCE(SUM(sli.line_subtotal), 0)::numeric(14,2) AS "taxableAmount",
        COALESCE(SUM(sli.tax_amount), 0)::numeric(14,2) AS "taxAmount"
      FROM sale_line_item sli
      JOIN sale s ON s.id = sli.sale_id
      WHERE sli.deleted_at IS NULL
        AND s.deleted_at IS NULL
        AND s.branch_id = $1
        AND s.sale_date >= $2
        AND s.sale_date <= $3
      GROUP BY sli.gst_rate_percent
      ORDER BY sli.gst_rate_percent
    `,
    [branchId, periodStart, periodEnd]
  );

  return result.rows.map((row) => ({
    gstRate: Number(row.gstRate),
    saleCount: Number(row.saleCount) || 0,
    taxableAmount: round2(Number(row.taxableAmount) || 0),
    taxAmount: round2(Number(row.taxAmount) || 0),
  }));
}

/**
 * Idempotent upsert into `tax_period_summary`, keyed on the partial unique
 * index `tax_period_summary_active_unique_idx`
 * (`tenant_id, branch_id, period_start, period_end, gst_rate WHERE deleted_at
 * IS NULL`, see `../db/schema.js`) -- calling this twice for the same
 * tenant/branch/period/rate UPDATES the same row (refreshing `taxableAmount`/
 * `taxAmount`/`saleCount`/`computedAt`) instead of inserting a duplicate.
 * `gstRate` is resolved server-side from tenant settings (never client
 * input), so the conflict target is deterministic across repeated calls for
 * the same tenant/period as long as tenant settings haven't changed.
 * @param {*} db
 * @param {{tenantId:string, branchId:string, periodStart:string, periodEnd:string, gstRate:number, taxableAmount:number, taxAmount:number, saleCount:number}} args
 */
export async function upsertPeriodSummary(
  db,
  { tenantId, branchId, periodStart, periodEnd, gstRate, taxableAmount, taxAmount, saleCount }
) {
  const values = {
    tenantId,
    branchId,
    periodStart,
    periodEnd,
    gstRate: gstRate.toFixed(2),
    taxableAmount: taxableAmount.toFixed(2),
    taxAmount: taxAmount.toFixed(2),
    saleCount,
    computedAt: new Date(),
    updatedAt: new Date(),
  };

  const [row] = await db
    .insert(schema.taxPeriodSummary)
    .values(values)
    .onConflictDoUpdate({
      target: [
        schema.taxPeriodSummary.tenantId,
        schema.taxPeriodSummary.branchId,
        schema.taxPeriodSummary.periodStart,
        schema.taxPeriodSummary.periodEnd,
        schema.taxPeriodSummary.gstRate,
      ],
      // Matches `tax_period_summary_active_unique_idx`'s own partial
      // predicate exactly -- ON CONFLICT can only infer a partial unique
      // index by repeating its WHERE clause verbatim (Postgres requirement,
      // not a Drizzle quirk).
      targetWhere: isNull(schema.taxPeriodSummary.deletedAt),
      set: {
        taxableAmount: values.taxableAmount,
        taxAmount: values.taxAmount,
        saleCount: values.saleCount,
        computedAt: values.computedAt,
        updatedAt: values.updatedAt,
      },
    })
    .returning();

  return row;
}

/**
 * Compute-on-demand + cache: always recomputes from live `sale_line_item`
 * data (so the numbers are always current/correct, never stale -- documented
 * choice, see `routes/tax.js`'s own doc comment for why this beats reading a
 * possibly-stale persisted row), then upserts ONE `tax_period_summary` row
 * PER distinct rate bucket `computeGstFromSales` returns -- a period with a
 * mid-window rate change produces multiple persisted rows, one per rate,
 * each independently idempotent (repeated calls update the same rows, never
 * duplicate them, same as the single-bucket case always was).
 * @param {*} db
 * @param {{tenantId:string, branchId:string, periodStart:string, periodEnd:string}} args
 * @returns {Promise<object[]>} one persisted `tax_period_summary` row per rate bucket (possibly empty).
 */
export async function getOrComputePeriodSummary(db, { tenantId, branchId, periodStart, periodEnd }) {
  const buckets = await computeGstFromSales(db, { branchId, periodStart, periodEnd });

  const persisted = [];
  for (const bucket of buckets) {
    const row = await upsertPeriodSummary(db, {
      tenantId,
      branchId,
      periodStart,
      periodEnd,
      gstRate: bucket.gstRate,
      taxableAmount: bucket.taxableAmount,
      taxAmount: bucket.taxAmount,
      saleCount: bucket.saleCount,
    });
    persisted.push(row);
  }
  return persisted;
}

/**
 * `rows` is the array `getOrComputePeriodSummary` returns -- one row per
 * distinct GST rate that was in force during the window (possibly empty, if
 * no sales fell in it). `rates` carries every bucket individually (what a CA
 * needs to reconcile against actual GST slabs); the `total*` fields are a
 * convenience sum across buckets for a single at-a-glance figure -- never
 * the ONLY figures shown, since collapsing multi-rate periods back into one
 * blended number is exactly what this task's effective-dated model replaces.
 */
export function serializeSummary(rows, { branchId, periodStart, periodEnd }) {
  const rates = rows.map((row) => ({
    gstRate: Number(row.gstRate),
    taxableAmount: row.taxableAmount,
    taxAmount: row.taxAmount,
    saleCount: row.saleCount ?? 0,
    computedAt: row.computedAt,
  }));
  return {
    branchId,
    periodStart,
    periodEnd,
    rates,
    totalTaxableAmount: round2(rates.reduce((sum, r) => sum + Number(r.taxableAmount), 0)),
    totalTaxAmount: round2(rates.reduce((sum, r) => sum + Number(r.taxAmount), 0)),
    totalSaleCount: rates.reduce((sum, r) => sum + r.saleCount, 0),
    disclaimer: CA_REVIEW_DISCLAIMER,
  };
}

function escapeCsvCell(value) {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Builds the CSV export body -- ONE ROW PER RATE BUCKET (`rows`, the array
 * `getOrComputePeriodSummary` returns), not a single blended row, so a CA
 * reconciling this against actual GST slabs sees exactly which sales fell
 * under which rate. The CA-review disclaimer (D-007, non-optional) is
 * printed as the FIRST line of the file itself (a leading comment-style
 * row), not only documented in the API -- it survives however the file is
 * saved/forwarded/reopened. `branchName` is passed through
 * `sanitizeCsvCell` (same formula-injection defense `saleService.js` applies
 * to free-text fields) since it's tenant-editable text that could contain a
 * leading `=`/`+`/`-`/`@`.
 * @param {{branchId:string, branchName:string, periodStart:string, periodEnd:string, rows: {gstRate:string|number, taxableAmount:string|number, taxAmount:string|number, saleCount:number}[]}} args
 */
export function buildCsvExport({ branchId, branchName, periodStart, periodEnd, rows }) {
  const lines = [];
  lines.push(escapeCsvCell(`# ${CA_REVIEW_DISCLAIMER}`));
  lines.push(
    ['Period Start', 'Period End', 'Branch ID', 'Branch Name', 'GST Rate (%)', 'Taxable Amount', 'Tax Amount', 'Sale Count']
      .map(escapeCsvCell)
      .join(',')
  );
  const safeBranchName = sanitizeCsvCell(branchName ?? '');
  for (const row of rows) {
    lines.push(
      [periodStart, periodEnd, branchId, safeBranchName, row.gstRate, row.taxableAmount, row.taxAmount, row.saleCount]
        .map(escapeCsvCell)
        .join(',')
    );
  }
  if (rows.length === 0) {
    lines.push([periodStart, periodEnd, branchId, safeBranchName, 0, '0.00', '0.00', 0].map(escapeCsvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
