/**
 * P2-03/P2-06 backend — real, DB-backed Finance summary for
 * `GET /api/v1/finance/summary`. NAMING NOTE: this is deliberately NOT named
 * `financeService.js` -- that name is already taken by the pre-existing
 * in-memory/mock module (`./financeService.js`, consumed by `profitEngine.js`
 * / `financeInsightService.js` / `routes/finance.js`'s legacy
 * `GET /api/v1/finance/summary` mock). This module supersedes that ROUTE
 * (`routes/v1/index.js` no longer mounts the legacy `getFinanceSummary` at
 * this path -- see that file's own comment), same collision-supersede
 * pattern P3's `customerManagementService.js`/`routes/customers.js` already
 * established for `GET /api/v1/customers`. `financeService.js` itself is
 * left in place, untouched.
 *
 * Two figures, explicitly scoped per this task's own instructions:
 *   - revenue / order count / tax collected: a straight rollup of
 *     `sale.total_amount`/`sale.tax_amount` -- NOT the Tax/GST module's own
 *     `tax_period_summary`-table computation (separate, GST-compliance-grade
 *     feature; out of scope here).
 *   - COGS: a best-effort, PARTIAL figure -- only sale line items with a
 *     real `inventoryItemId` link to an `inventory_item` row that itself has
 *     a recorded `costPerUnit` contribute to it. Every sale allows
 *     free-text/uncatalogued line items (see `schema.js`'s `sale_line_item`
 *     doc comment), and even a catalogued item may not have `costPerUnit`
 *     set yet -- so this NEVER claims to be a complete/authoritative margin
 *     figure. The response carries `cogs.isPartial` +
 *     `costedLineItemCount`/`totalLineItemCount` + a human-readable `note`
 *     so a consumer cannot mistake this for a GST-compliance-grade number
 *     (per this task's explicit instruction not to present an incomplete
 *     figure as authoritative).
 *
 * Every exported function here takes a tenant-scoped `db` (same DAL contract
 * as every other service in this codebase) -- RLS is already active on the
 * connection for every query this module issues, same as
 * `saleService.js`/`inventoryManagementService.js`.
 */

import { round2 } from '../utils/validation.js';

export { PERIODS } from './saleService.js';

/**
 * Window predicate identical to `saleService.getCurrentPeriodSummary`'s
 * (same `date_trunc(period, CURRENT_DATE)` half-open window, same reasoning
 * for using the DB server's own clock rather than Node's) -- duplicated
 * inline here rather than imported as a shared string constant because it's
 * a single SQL fragment embedded in two structurally different queries
 * below (a flat `sale` scan vs. a `sale JOIN sale_line_item`, where the
 * window applies to different table aliases); a shared constant would still
 * need per-call-site editing to retarget the table prefix, so it buys
 * nothing over just writing it twice with a clear comment tying the two
 * together.
 */
export async function getFinanceSummary(db, { period, branchId }) {
  const revenueParams = [period];
  let saleBranchFilterSql = '';
  if (branchId) {
    saleBranchFilterSql = 'AND branch_id = $2';
    revenueParams.push(branchId);
  }

  const revenueResult = await db.raw(
    `
      SELECT
        COUNT(*)::int AS "orderCount",
        COALESCE(SUM(total_amount), 0)::numeric(14,2) AS "revenue",
        COALESCE(SUM(tax_amount), 0)::numeric(14,2) AS "taxCollected"
      FROM sale
      WHERE deleted_at IS NULL
        AND sale_date >= date_trunc($1, CURRENT_DATE::timestamp)::date
        AND sale_date < (date_trunc($1, CURRENT_DATE::timestamp) + ('1 ' || $1)::interval)::date
        ${saleBranchFilterSql}
    `,
    revenueParams
  );

  const cogsParams = [period];
  let cogsBranchFilterSql = '';
  if (branchId) {
    cogsBranchFilterSql = 'AND s.branch_id = $2';
    cogsParams.push(branchId);
  }

  // JOIN sale_line_item -> inventory_item (LEFT, so a line with no
  // inventoryItemId or an item with no costPerUnit still counts toward
  // `totalLineItemCount`, just not `costedLineItemCount`/the summed cogs).
  const cogsResult = await db.raw(
    `
      SELECT
        COUNT(*)::int AS "totalLineItemCount",
        COUNT(*) FILTER (WHERE sli.inventory_item_id IS NOT NULL AND ii.cost_per_unit IS NOT NULL)::int AS "costedLineItemCount",
        COALESCE(
          SUM(sli.quantity * ii.cost_per_unit) FILTER (WHERE sli.inventory_item_id IS NOT NULL AND ii.cost_per_unit IS NOT NULL),
          0
        )::numeric(14,2) AS "cogs"
      FROM sale s
      JOIN sale_line_item sli ON sli.sale_id = s.id AND sli.deleted_at IS NULL
      LEFT JOIN inventory_item ii ON ii.id = sli.inventory_item_id
      WHERE s.deleted_at IS NULL
        AND s.sale_date >= date_trunc($1, CURRENT_DATE::timestamp)::date
        AND s.sale_date < (date_trunc($1, CURRENT_DATE::timestamp) + ('1 ' || $1)::interval)::date
        ${cogsBranchFilterSql}
    `,
    cogsParams
  );

  const revRow = revenueResult.rows[0] || {};
  const cogsRow = cogsResult.rows[0] || {};

  const revenue = Number(revRow.revenue) || 0;
  const orderCount = Number(revRow.orderCount) || 0;
  const taxCollected = Number(revRow.taxCollected) || 0;
  const totalLineItemCount = Number(cogsRow.totalLineItemCount) || 0;
  const costedLineItemCount = Number(cogsRow.costedLineItemCount) || 0;
  const cogsValue = round2(Number(cogsRow.cogs) || 0);

  return {
    period,
    branchId: branchId || null,
    revenue,
    orderCount,
    taxCollected,
    cogs: {
      value: cogsValue,
      // true whenever at least one line item in the window is NOT reflected
      // in `value` -- the caller must treat `value`/`grossMarginEstimate` as
      // a floor, not a complete figure, whenever this is true.
      isPartial: totalLineItemCount > 0 && costedLineItemCount < totalLineItemCount,
      costedLineItemCount,
      totalLineItemCount,
      note:
        'COGS is best-effort: only sale line items linked to an inventory item with a recorded cost per unit are included. Not every sale line has this link, so this figure may understate true cost of goods sold and must not be treated as an authoritative/complete margin number.',
    },
    // Always revenue - cogs.value, INCLUDING when cogs.isPartial is true --
    // the partial-ness is communicated via `cogs.isPartial`/the counts
    // above, not by withholding this field. A consumer that ignores
    // `cogs.isPartial` and treats this as exact is a caller-side misuse this
    // response actively warns against, not something this endpoint can
    // prevent by omitting the number outright (revenue/tax are still exact
    // and useful even when COGS is incomplete).
    grossMarginEstimate: round2(revenue - cogsValue),
  };
}
