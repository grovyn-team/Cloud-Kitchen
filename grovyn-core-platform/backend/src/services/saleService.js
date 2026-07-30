/**
 * P2-02/P2-03 — Sales module business logic (manual entry, list, detail,
 * revenue rollup). CSV import has its own service
 * (`salesCsvImportService.js`) that reuses `PAYMENT_METHODS`/serialization
 * helpers from here rather than duplicating them.
 *
 * Every exported function here takes a tenant-scoped `db`
 * (`../db/dal.js`'s `createScopedDb`, always obtained via
 * `withTenantContext(pool)` in `../routes/sales.js`) -- there is no code
 * path in this module that runs a query without RLS already active on the
 * connection. `tenantId` is still passed explicitly on writes because RLS's
 * `WITH CHECK` validates the column against the session GUC, it does not
 * populate it (same reasoning as `auditService.js`).
 */

import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { schema } from '../db/dal.js';
import { isValidUuid, round2 } from '../utils/validation.js';
import { sanitizeCsvCell } from './csvSanitize.js';
import { branchExistsInTenant } from './branchAccessService.js';
import { decrementForSaleLineItems } from './inventoryManagementService.js';

export const PAYMENT_METHODS = ['cash', 'card', 'upi', 'netbanking', 'other', 'mixed'];
export const PERIODS = ['day', 'week', 'month'];

// Sane upper bound on a single manual-entry sale's line-item count. Not a
// schema constraint -- just keeps one request from constructing an
// unbounded insert. No stated requirement drove this exact number; documented
// here as a judgment call, revisit if a real menu size needs more.
export const MAX_MANUAL_LINE_ITEMS = 500;

function normalizePaymentMethod(value) {
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'string' ? value.trim().toLowerCase() : null;
}

/**
 * Validate + normalize a `POST /api/v1/sales` request body. Never trusts a
 * client-sent subtotal/tax/total or a client-sent line subtotal -- those are
 * always computed server-side in `createSale()` below.
 * @param {unknown} body
 * @returns {{ok:true, value:object}|{ok:false, errors:string[]}}
 */
export function validateManualSaleInput(body) {
  const errors = [];
  const b = body && typeof body === 'object' ? body : {};

  const saleDate = typeof b.saleDate === 'string' ? b.saleDate.trim() : '';
  if (!saleDate || !/^\d{4}-\d{2}-\d{2}$/.test(saleDate) || Number.isNaN(new Date(`${saleDate}T00:00:00Z`).getTime())) {
    errors.push('saleDate is required and must be YYYY-MM-DD.');
  }

  const paymentMethod = normalizePaymentMethod(b.paymentMethod);
  if (paymentMethod !== null && !PAYMENT_METHODS.includes(paymentMethod)) {
    errors.push(`paymentMethod must be one of: ${PAYMENT_METHODS.join(', ')}.`);
  }

  let taxAmount = 0;
  if (b.taxAmount !== undefined && b.taxAmount !== null && b.taxAmount !== '') {
    taxAmount = Number(b.taxAmount);
    if (!Number.isFinite(taxAmount) || taxAmount < 0) {
      errors.push('taxAmount must be a non-negative number.');
    }
  }

  const rawLineItems = Array.isArray(b.lineItems) ? b.lineItems : null;
  if (!rawLineItems || rawLineItems.length === 0) {
    errors.push('lineItems is required and must be a non-empty array.');
  } else if (rawLineItems.length > MAX_MANUAL_LINE_ITEMS) {
    errors.push(`lineItems exceeds the maximum of ${MAX_MANUAL_LINE_ITEMS} per sale.`);
  }

  const lineItems = [];
  if (rawLineItems) {
    rawLineItems.forEach((li, idx) => {
      const itemNameRaw = typeof li?.itemName === 'string' ? li.itemName.trim() : '';
      if (!itemNameRaw) {
        errors.push(`lineItems[${idx}].itemName is required.`);
        return;
      }
      const quantity = Number(li?.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        errors.push(`lineItems[${idx}].quantity must be a positive number.`);
        return;
      }
      const unitPrice = Number(li?.unitPrice);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        errors.push(`lineItems[${idx}].unitPrice must be a non-negative number.`);
        return;
      }
      const skuRaw = typeof li?.sku === 'string' && li.sku.trim() ? li.sku.trim() : null;
      const inventoryItemId =
        typeof li?.inventoryItemId === 'string' && isValidUuid(li.inventoryItemId) ? li.inventoryItemId : null;

      // Formula-injection defense-in-depth (see csvSanitize.js doc) applied
      // on the manual-entry path too, not just CSV import -- this data can
      // still be re-exported later regardless of how it was entered.
      lineItems.push({
        itemName: sanitizeCsvCell(itemNameRaw),
        sku: skuRaw ? sanitizeCsvCell(skuRaw) : null,
        quantity,
        unitPrice,
        inventoryItemId,
      });
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, value: { saleDate, paymentMethod, taxAmount, lineItems } };
}

/**
 * Insert one sale header + its line items in the CURRENT request
 * transaction (every handler in `routes/sales.js` runs inside
 * `withTenantContext(pool)`, which already wraps the whole handler in
 * BEGIN...COMMIT -- see `middleware/tenantContext.js` -- so this needs no
 * separate `db.transaction()` call to be atomic; a throw anywhere in here
 * rolls back everything the request has done so far).
 *
 * The header total is ALWAYS computed here from `lineItems`, never taken
 * from caller input -- callers only ever pass `taxAmount` (there is no GST
 * rate/line-tax model yet; Phase 6 owns that) plus the already-validated
 * line items from `validateManualSaleInput`.
 *
 * P2-05 backend addition (2026-07-30): after the line items are inserted,
 * this calls `inventoryManagementService.decrementForSaleLineItems` in the
 * SAME transaction (no separate `db.transaction()`, same reasoning as the
 * rest of this function) for any line carrying a real `inventoryItemId` --
 * see that function's own doc comment for the full wiring rationale
 * (why here, not a DB trigger; why CSV-imported sales don't go through
 * this; why a decrement never blocks/fails the sale).
 */
export async function createSale(db, { tenantId, branchId, createdByUserId, saleDate, paymentMethod, taxAmount, lineItems }) {
  const computedLines = lineItems.map((li) => ({
    ...li,
    lineSubtotal: round2(li.quantity * li.unitPrice),
  }));
  const subtotalAmount = round2(computedLines.reduce((sum, l) => sum + l.lineSubtotal, 0));
  const tax = round2(taxAmount || 0);
  const totalAmount = round2(subtotalAmount + tax);

  const [saleRow] = await db
    .insert(schema.sale)
    .values({
      tenantId,
      branchId,
      saleDate,
      source: 'manual',
      paymentMethod,
      subtotalAmount: subtotalAmount.toFixed(2),
      taxAmount: tax.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
      createdByUserId,
    })
    .returning();

  const lineRows = await db
    .insert(schema.saleLineItem)
    .values(
      computedLines.map((l) => ({
        tenantId,
        saleId: saleRow.id,
        inventoryItemId: l.inventoryItemId,
        itemName: l.itemName,
        sku: l.sku,
        quantity: l.quantity.toFixed(3),
        unitPrice: l.unitPrice.toFixed(2),
        lineSubtotal: l.lineSubtotal.toFixed(2),
      }))
    )
    .returning();

  await decrementForSaleLineItems(db, {
    tenantId,
    branchId,
    lineItems: lineRows,
    actorUserId: createdByUserId,
    relatedSaleId: saleRow.id,
  });

  return { ...saleRow, lineItems: lineRows };
}

export function serializeSale(sale) {
  return {
    id: sale.id,
    branchId: sale.branchId,
    saleDate: sale.saleDate,
    source: sale.source,
    importBatchRef: sale.importBatchRef ?? null,
    paymentMethod: sale.paymentMethod,
    subtotalAmount: sale.subtotalAmount,
    taxAmount: sale.taxAmount,
    totalAmount: sale.totalAmount,
    createdByUserId: sale.createdByUserId ?? null,
    createdAt: sale.createdAt,
  };
}

export function serializeSaleDetail(sale) {
  return {
    ...serializeSale(sale),
    lineItems: (sale.lineItems || []).map((li) => ({
      id: li.id,
      inventoryItemId: li.inventoryItemId ?? null,
      itemName: li.itemName,
      sku: li.sku ?? null,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      lineSubtotal: li.lineSubtotal,
    })),
  };
}

/**
 * Branch-scoped, paginated sale list. `staffBranchIds` restricts the result
 * set for STAFF regardless of whether `branchId` was supplied (route handler
 * already 403s a STAFF-supplied branchId outside their scope before calling
 * this -- this function's own restriction is the data-access-layer half of
 * that same guarantee, not the only one).
 */
export async function listSales(db, { branchId, staffBranchIds, page, pageSize, dateFrom, dateTo }) {
  const conditions = [isNull(schema.sale.deletedAt)];
  if (branchId) {
    conditions.push(eq(schema.sale.branchId, branchId));
  } else if (Array.isArray(staffBranchIds)) {
    if (staffBranchIds.length === 0) {
      return { data: [], meta: { page, pageSize, total: 0 } };
    }
    conditions.push(inArray(schema.sale.branchId, staffBranchIds));
  }
  if (dateFrom) conditions.push(gte(schema.sale.saleDate, dateFrom));
  if (dateTo) conditions.push(lte(schema.sale.saleDate, dateTo));

  const whereExpr = and(...conditions);

  const [{ count }] = await db.select({ count: sql`count(*)::int` }).from(schema.sale).where(whereExpr);

  const rows = await db
    .select()
    .from(schema.sale)
    .where(whereExpr)
    .orderBy(desc(schema.sale.saleDate), desc(schema.sale.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { data: rows.map(serializeSale), meta: { page, pageSize, total: count } };
}

// `branchExistsInTenant` moved to `./branchAccessService.js` (P2-05 backend,
// 2026-07-30) so the Inventory module can reuse the exact same tenant-
// ownership check instead of duplicating it -- see that file's doc comment
// for the full rationale (unchanged, this is a pure relocation). Re-exported
// here so every existing call site in this file/`routes/sales.js`/
// `tests/sales.pgtest.mjs` (`saleService.branchExistsInTenant(...)`) keeps
// working unmodified.
export { branchExistsInTenant };

export async function getSaleById(db, { id }) {
  const [sale] = await db
    .select()
    .from(schema.sale)
    .where(and(eq(schema.sale.id, id), isNull(schema.sale.deletedAt)))
    .limit(1);
  if (!sale) return null;

  const lineItems = await db
    .select()
    .from(schema.saleLineItem)
    .where(and(eq(schema.saleLineItem.saleId, id), isNull(schema.saleLineItem.deletedAt)))
    .orderBy(schema.saleLineItem.createdAt);

  return { ...sale, lineItems };
}

/**
 * Revenue/order-count/AOV rollup, aggregated by branch + period bucket, via
 * a real SQL aggregation (`GROUP BY branch_id, date_trunc(...)`) run through
 * the DAL's `.raw()` escape hatch -- not an in-memory reduce over fetched
 * rows -- so it can actually use the `(tenant_id, branch_id, sale_date)` /
 * `(tenant_id, sale_date)` composite indexes P2-01 built. `db.raw()` runs on
 * the SAME already tenant-scoped client `db` is bound to (see `db/dal.js`),
 * so RLS still transparently confines this to the caller's tenant -- no
 * hand-written `tenant_id = ...` predicate is needed or added, consistent
 * with how every other query in this codebase relies on RLS rather than an
 * app-layer tenant filter.
 *
 * `period` MUST already be validated against `PERIODS` by the caller before
 * this runs (it still goes in as a bound parameter either way, defense in
 * depth, not the primary control).
 *
 * NOTE: `periodStart` is cast to `text` in the SQL below, not left as a bare
 * `::date`. `db.raw()` returns whatever the underlying `pg` driver's default
 * type parser produces for a `date`-typed column, and `pg`'s default date
 * parser builds a JS `Date` using LOCAL-timezone semantics (`new
 * Date(year, month, day)`, not `Date.UTC(...)`) -- `JSON.stringify`/`res.json()`
 * then renders that as a UTC ISO string, which silently shifts by a day
 * whenever the server process's timezone isn't UTC (a well-known `pg`
 * gotcha, found by this task's own real-Postgres verification, not a
 * hypothetical). Casting to `text` in SQL sidesteps the driver's date type
 * parser entirely -- the value is a plain 'YYYY-MM-DD' string on the wire,
 * unambiguous regardless of the server process's `TZ`.
 */
/**
 * P2-03/P2-04/P2-06 (dashboard/finance aggregation) — a single CURRENT-period
 * revenue/order-count/AOV figure (e.g. "today's revenue", "this week's
 * revenue"), NOT the full historical per-bucket breakdown `getRollup` above
 * returns. A dashboard/finance summary tile wants one number for the
 * period the caller selected, not every bucket back to the start of time --
 * `getRollup` already computes exactly this shape (branch_id, periodStart,
 * orderCount, revenue, aov) but GROUPs over ALL history, which is the wrong
 * tool for a tile. This reuses `getRollup`'s exact technique (real SQL
 * aggregation via `db.raw()`, same `$1`-bound `period`, same
 * branchId/restrictBranchIds filter shape, same revenue/orderCount/aov
 * derivation) rather than reinventing it, just with a WHERE window instead
 * of an unbounded GROUP BY.
 *
 * Window: `[date_trunc(period, today), date_trunc(period, today) + 1 period)`
 * -- half-open, computed entirely in SQL from `CURRENT_DATE` (the DB
 * server's own clock/timezone, not Node's) so "today"/"this week"/
 * "this month" is judged consistently regardless of which process computed
 * it. No `date`-typed column is SELECTed back (only aggregates), so this
 * does not hit the `pg` driver's local-timezone date-parsing gotcha
 * `getRollup`'s own doc comment above documents -- nothing here needs the
 * `::text` cast workaround for that reason.
 *
 * `period` MUST already be validated against `PERIODS` by the caller (same
 * caveat as `getRollup`) -- it is still a bound parameter either way.
 */
export async function getCurrentPeriodSummary(db, { period, branchId, restrictBranchIds }) {
  const params = [period];
  let branchFilterSql = '';
  if (branchId) {
    branchFilterSql = 'AND branch_id = $2';
    params.push(branchId);
  } else if (Array.isArray(restrictBranchIds)) {
    if (restrictBranchIds.length === 0) return { revenue: 0, orderCount: 0, aov: 0 };
    branchFilterSql = 'AND branch_id = ANY($2::uuid[])';
    params.push(restrictBranchIds);
  }

  const result = await db.raw(
    `
      SELECT
        COUNT(*)::int AS "orderCount",
        COALESCE(SUM(total_amount), 0)::numeric(14,2) AS "revenue"
      FROM sale
      WHERE deleted_at IS NULL
        AND sale_date >= date_trunc($1, CURRENT_DATE::timestamp)::date
        AND sale_date < (date_trunc($1, CURRENT_DATE::timestamp) + ('1 ' || $1)::interval)::date
      ${branchFilterSql}
    `,
    params
  );

  const row = result.rows[0] || {};
  const revenue = Number(row.revenue) || 0;
  const orderCount = Number(row.orderCount) || 0;
  return { revenue, orderCount, aov: orderCount > 0 ? round2(revenue / orderCount) : 0 };
}

/**
 * P2-03/P2-04 admin "by-branch" dashboard view -- CURRENT-period
 * revenue/orderCount/AOV for EVERY branch in the tenant, including branches
 * with ZERO sales in the window (a zero-order branch is still a real row an
 * admin's cross-branch view should show, not silently drop). This is why
 * this is a fresh query rather than literally calling `getRollup` (which
 * only emits rows for branches that HAVE at least one matching sale --
 * `GROUP BY branch_id` over `sale` alone has nothing to group for a branch
 * with no orders in the window) or `getCurrentPeriodSummary` per-branch in a
 * loop (N+1 queries). Same real-SQL-aggregation style as both of those
 * (window predicate identical to `getCurrentPeriodSummary` above): a
 * `branch LEFT JOIN sale` with the period window pushed into the JOIN's
 * `FILTER` clause (not a plain WHERE, which would turn the LEFT JOIN into an
 * inner join and drop the zero-order branches it exists to keep) is the
 * standard SQL idiom for "every row on the left, aggregated matches from the
 * right." Both `branch` and `sale` are RLS-scoped tables under this
 * already-tenant-scoped connection, so the join is tenant-confined the same
 * way every other query in this module is -- no hand-written tenant_id
 * predicate needed.
 *
 * ADMIN-only by construction of the route that calls this (an ADMIN has
 * implicit all-branch access within their own tenant) -- no
 * `restrictBranchIds` parameter here, unlike `getRollup`/
 * `getCurrentPeriodSummary`; a STAFF-scoped version isn't a requirement this
 * task states, and bolting on an unused filter would be speculative.
 */
export async function getBranchBreakdown(db, { period }) {
  const result = await db.raw(
    `
      SELECT
        b.id AS "branchId",
        b.name AS "branchName",
        COUNT(s.id) FILTER (
          WHERE s.deleted_at IS NULL
            AND s.sale_date >= date_trunc($1, CURRENT_DATE::timestamp)::date
            AND s.sale_date < (date_trunc($1, CURRENT_DATE::timestamp) + ('1 ' || $1)::interval)::date
        )::int AS "orderCount",
        COALESCE(
          SUM(s.total_amount) FILTER (
            WHERE s.deleted_at IS NULL
              AND s.sale_date >= date_trunc($1, CURRENT_DATE::timestamp)::date
              AND s.sale_date < (date_trunc($1, CURRENT_DATE::timestamp) + ('1 ' || $1)::interval)::date
          ),
          0
        )::numeric(14,2) AS "revenue"
      FROM branch b
      LEFT JOIN sale s ON s.branch_id = b.id
      WHERE b.deleted_at IS NULL
      GROUP BY b.id, b.name
      ORDER BY b.name
    `,
    [period]
  );

  return result.rows.map((row) => {
    const revenue = Number(row.revenue) || 0;
    const orderCount = Number(row.orderCount) || 0;
    return {
      branchId: row.branchId,
      branchName: row.branchName,
      revenue,
      orderCount,
      aov: orderCount > 0 ? round2(revenue / orderCount) : 0,
    };
  });
}

export async function getRollup(db, { period, branchId, restrictBranchIds }) {
  const params = [period];
  let branchFilterSql = '';
  if (branchId) {
    branchFilterSql = 'AND branch_id = $2';
    params.push(branchId);
  } else if (Array.isArray(restrictBranchIds)) {
    if (restrictBranchIds.length === 0) return [];
    branchFilterSql = 'AND branch_id = ANY($2::uuid[])';
    params.push(restrictBranchIds);
  }

  const result = await db.raw(
    `
      SELECT
        branch_id AS "branchId",
        (date_trunc($1, sale_date::timestamp)::date)::text AS "periodStart",
        COUNT(*)::int AS "orderCount",
        COALESCE(SUM(total_amount), 0)::numeric(14,2) AS "revenue"
      FROM sale
      WHERE deleted_at IS NULL
      ${branchFilterSql}
      GROUP BY branch_id, "periodStart"
      ORDER BY branch_id, "periodStart"
    `,
    params
  );

  return result.rows.map((row) => {
    const revenue = Number(row.revenue);
    const orderCount = Number(row.orderCount);
    return {
      branchId: row.branchId,
      periodStart: row.periodStart,
      revenue,
      orderCount,
      aov: orderCount > 0 ? round2(revenue / orderCount) : 0,
    };
  });
}
