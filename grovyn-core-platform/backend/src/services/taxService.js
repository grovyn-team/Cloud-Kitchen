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
 * GST RATE MODELING -- READ BEFORE CHANGING (documented simplification, per
 * this task's explicit instruction to check the schema first rather than
 * invent a multi-rate system the data doesn't support):
 *   `sale`/`sale_line_item` (see `../db/schema.js`) carry ONE `tax_amount`
 *   per sale header, computed at write time (`saleService.createSale`) from a
 *   caller-supplied lump `taxAmount` -- there is NO per-line-item GST rate
 *   field anywhere in the schema (`sale_line_item` has no `gst_rate`/
 *   `hsn_code` column). So this module CANNOT bucket a period's sales into
 *   multiple real GST slabs (5%/12%/18%/28%) the way `tax_period_summary`'s
 *   `gst_rate` column shape would structurally allow -- the data to do that
 *   doesn't exist yet. Building a fake multi-rate breakdown by guessing which
 *   line belongs to which slab would fabricate figures a CA could not trust,
 *   which is exactly what D-007 forbids.
 *
 *   Instead: ONE blended/configurable rate per (tenant, branch, period) row,
 *   used only as a DESCRIPTIVE LABEL on the summary -- it is NEVER used to
 *   recompute `taxableAmount`/`taxAmount` from a formula. Those two figures
 *   are always the real, already-recorded `sale.subtotal_amount`/
 *   `sale.tax_amount` sums for the window -- the actual money a CA needs to
 *   reconcile, not a rate-derived estimate that could drift from what was
 *   really collected. `gstRate` is resolved per tenant (`tenant.settings.tax
 *   .gstRate`, same override-precedence pattern `expansionService.js`
 *   established for `tenant.settings.expansion`) falling back to
 *   `DEFAULT_GST_RATE_PERCENT` -- 5% is India's standard GST slab for
 *   standalone (non-hotel-attached) restaurant/cloud-kitchen F&B services
 *   without input tax credit, the most common bracket for Grovyn's target
 *   segment, but any tenant on a different slab can override it. If/when a
 *   real per-line GST-rate field is added to `sale_line_item` (a schema
 *   change database-administrator would own), this module's aggregation
 *   changes to a real `GROUP BY gst_rate` -- not invented here.
 */

import { eq, isNull } from 'drizzle-orm';
import { schema } from '../db/dal.js';
import { round2 } from '../utils/validation.js';
import { sanitizeCsvCell } from './csvSanitize.js';

export const CA_REVIEW_DISCLAIMER =
  'Prepared for CA review - not a certified filing. This report reconciles recorded sales data for your Chartered Accountant; it is not a GST audit, not a filing document, and contains no tax advice.';

// India's standard GST slab for standalone restaurant/cloud-kitchen F&B
// services (non-AC/non-hotel-attached, no ITC) -- see module doc above for
// why this is a label, not a computation input, and how a tenant overrides
// it via `tenant.settings.tax.gstRate`.
export const DEFAULT_GST_RATE_PERCENT = 5.0;

/**
 * Reads THIS tenant's own `settings.tax` object (RLS confines the row this
 * selects to the caller's own tenant regardless -- same pattern/rationale as
 * `expansionService.js`'s `gatherRealInputs` reading `settings.expansion`).
 * @param {*} db
 * @param {string} tenantId
 */
async function getTenantTaxSettings(db, tenantId) {
  const [row] = await db
    .select({ settings: schema.tenant.settings })
    .from(schema.tenant)
    .where(eq(schema.tenant.id, tenantId))
    .limit(1);
  const settings = row?.settings && typeof row.settings === 'object' ? row.settings : {};
  return settings.tax && typeof settings.tax === 'object' ? settings.tax : {};
}

/**
 * @param {object} taxSettings result of `getTenantTaxSettings`
 * @returns {number} a validated GST rate percent (0-100), never NaN/Infinity.
 */
export function resolveGstRate(taxSettings) {
  const raw = taxSettings && typeof taxSettings === 'object' ? taxSettings.gstRate : undefined;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
  return DEFAULT_GST_RATE_PERCENT;
}

/**
 * Real SQL aggregation (not an in-memory reduce), same style as
 * `saleService.getCurrentPeriodSummary`/`financeManagementService
 * .getFinanceSummary` -- runs on the already tenant-scoped `db`, so RLS
 * transparently confines this to the caller's own tenant; `branchId` is a
 * bound parameter, never string-interpolated. `periodStart`/`periodEnd` are
 * INCLUSIVE calendar-date bounds (caller-supplied, already validated by the
 * route as `YYYY-MM-DD` with `periodStart <= periodEnd`) -- this matches how
 * a CA thinks about a GST return period (e.g. "1 July - 31 July"), unlike the
 * rolling day/week/month windows Dashboard/Finance use.
 * @param {*} db
 * @param {{branchId: string, periodStart: string, periodEnd: string}} args
 */
export async function computeGstFromSales(db, { branchId, periodStart, periodEnd }) {
  const result = await db.raw(
    `
      SELECT
        COUNT(*)::int AS "saleCount",
        COALESCE(SUM(subtotal_amount), 0)::numeric(14,2) AS "taxableAmount",
        COALESCE(SUM(tax_amount), 0)::numeric(14,2) AS "taxAmount"
      FROM sale
      WHERE deleted_at IS NULL
        AND branch_id = $1
        AND sale_date >= $2
        AND sale_date <= $3
    `,
    [branchId, periodStart, periodEnd]
  );

  const row = result.rows[0] || {};
  return {
    saleCount: Number(row.saleCount) || 0,
    taxableAmount: round2(Number(row.taxableAmount) || 0),
    taxAmount: round2(Number(row.taxAmount) || 0),
  };
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
 * Compute-on-demand + cache: always recomputes from live `sale` data (so the
 * number is always current/correct, never stale -- documented choice, see
 * `routes/tax.js`'s own doc comment for why this beats reading a possibly-
 * stale persisted row), then upserts the result into `tax_period_summary` so
 * a persisted, exportable/auditable row always exists for the period. This
 * is what makes repeated calls to `GET /tax/summary` for the same window
 * idempotent (no duplicate `tax_period_summary` rows) while still always
 * reflecting the latest sale data.
 * @param {*} db
 * @param {{tenantId:string, branchId:string, periodStart:string, periodEnd:string}} args
 */
export async function getOrComputePeriodSummary(db, { tenantId, branchId, periodStart, periodEnd }) {
  const taxSettings = await getTenantTaxSettings(db, tenantId);
  const gstRate = resolveGstRate(taxSettings);

  const { saleCount, taxableAmount, taxAmount } = await computeGstFromSales(db, {
    branchId,
    periodStart,
    periodEnd,
  });

  const persisted = await upsertPeriodSummary(db, {
    tenantId,
    branchId,
    periodStart,
    periodEnd,
    gstRate,
    taxableAmount,
    taxAmount,
    saleCount,
  });

  return persisted;
}

export function serializeSummary(row, { branchId, periodStart, periodEnd }) {
  return {
    branchId,
    periodStart,
    periodEnd,
    gstRate: row.gstRate,
    taxableAmount: row.taxableAmount,
    taxAmount: row.taxAmount,
    saleCount: row.saleCount ?? 0,
    computedAt: row.computedAt,
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
 * Builds the CSV export body. The CA-review disclaimer (D-007, non-optional)
 * is printed as the FIRST line of the file itself (a leading comment-style
 * row), not only documented in the API -- it survives however the file is
 * saved/forwarded/reopened. `branchName` is passed through
 * `sanitizeCsvCell` (same formula-injection defense `saleService.js` applies
 * to free-text fields) since it's tenant-editable text that could contain a
 * leading `=`/`+`/`-`/`@`.
 * @param {{branchId:string, branchName:string, periodStart:string, periodEnd:string, gstRate:string|number, taxableAmount:string|number, taxAmount:string|number, saleCount:number}} row
 */
export function buildCsvExport(row) {
  const lines = [];
  lines.push(escapeCsvCell(`# ${CA_REVIEW_DISCLAIMER}`));
  lines.push(
    ['Period Start', 'Period End', 'Branch ID', 'Branch Name', 'GST Rate (%)', 'Taxable Amount', 'Tax Amount', 'Sale Count']
      .map(escapeCsvCell)
      .join(',')
  );
  lines.push(
    [
      row.periodStart,
      row.periodEnd,
      row.branchId,
      sanitizeCsvCell(row.branchName ?? ''),
      row.gstRate,
      row.taxableAmount,
      row.taxAmount,
      row.saleCount,
    ]
      .map(escapeCsvCell)
      .join(',')
  );
  return lines.join('\r\n') + '\r\n';
}
