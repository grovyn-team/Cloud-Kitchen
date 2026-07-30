/**
 * P2-05 backend (2026-07-30) — real, DB-backed Inventory module business
 * logic: manual item create/edit, list/detail, low-stock notification
 * trigger, and the sale-triggered decrement hook `saleService.createSale`
 * calls into.
 *
 * NAMING NOTE: this is deliberately NOT named `inventoryService.js` --
 * that name is already taken by the pre-existing in-memory/mock module
 * (`./inventoryService.js`, consumed by `routes/inventory.js`,
 * `consumptionService.js`, `inventoryInsightService.js`, `profitEngine.js`
 * for the legacy `GET /api/v1/inventory` / `/inventory-insights` mock
 * endpoints). That module is untouched by this task -- this is a new,
 * separate, real-Postgres-backed module for `POST /api/v1/inventory/items`
 * etc. (`routes/inventoryManagement.js`). Reconciling/retiring the legacy
 * mock module in favor of this one is a follow-up, not this task's call.
 *
 * Bulk Excel/CSV import has its own service (`inventoryImportService.js`),
 * same split as Sales (`saleService.js` vs `salesCsvImportService.js`).
 *
 * Every exported function here takes a tenant-scoped `db`
 * (`../db/dal.js`'s `createScopedDb`, always obtained via
 * `withTenantContext(pool)` in `../routes/inventoryManagement.js` or, for
 * the sale-triggered decrement, whatever transaction `saleService.createSale`
 * is already running in) -- there is no code path in this module that runs
 * a query without RLS already active on the connection. `tenantId` is still
 * passed explicitly on writes because RLS's `WITH CHECK` validates the
 * column against the session GUC, it does not populate it (same reasoning
 * as `auditService.js`/`saleService.js`).
 */

import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { schema } from '../db/dal.js';
import { sanitizeCsvCell } from './csvSanitize.js';

export const MOVEMENT_TYPES = ['sale_deduction', 'manual_adjustment', 'excel_import', 'restock', 'correction'];

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN; // NaN signals "present but invalid"
}

/**
 * Validate + normalize a `POST /api/v1/inventory/items` request body.
 * `branchId` is validated separately by the route (same split
 * `validateManualSaleInput` uses) since branch-scope/tenant-ownership checks
 * need `req`/`db`, not just the body.
 * @returns {{ok:true, value:object}|{ok:false, errors:string[]}}
 */
export function validateCreateItemInput(body) {
  const errors = [];
  const b = body && typeof body === 'object' ? body : {};

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) errors.push('name is required.');

  const unit = typeof b.unit === 'string' ? b.unit.trim() : '';
  if (!unit) errors.push('unit is required.');

  const skuRaw = typeof b.sku === 'string' && b.sku.trim() ? b.sku.trim() : null;

  let lowStockThreshold = null;
  if (b.lowStockThreshold !== undefined && b.lowStockThreshold !== null && b.lowStockThreshold !== '') {
    lowStockThreshold = Number(b.lowStockThreshold);
    if (!Number.isFinite(lowStockThreshold) || lowStockThreshold < 0) {
      errors.push('lowStockThreshold must be a non-negative number.');
    }
  }

  let costPerUnit = null;
  if (b.costPerUnit !== undefined && b.costPerUnit !== null && b.costPerUnit !== '') {
    costPerUnit = Number(b.costPerUnit);
    if (!Number.isFinite(costPerUnit) || costPerUnit < 0) {
      errors.push('costPerUnit must be a non-negative number.');
    }
  }

  let initialStock = 0;
  if (b.initialStock !== undefined && b.initialStock !== null && b.initialStock !== '') {
    initialStock = Number(b.initialStock);
    if (!Number.isFinite(initialStock) || initialStock < 0) {
      errors.push('initialStock must be a non-negative number.');
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name: sanitizeCsvCell(name),
      sku: skuRaw ? sanitizeCsvCell(skuRaw) : null,
      unit: sanitizeCsvCell(unit),
      lowStockThreshold,
      costPerUnit,
      initialStock,
    },
  };
}

/**
 * Validate + normalize a `PATCH /api/v1/inventory/items/:id` request body.
 * Every field is optional, but at least one of the metadata fields OR
 * `stockAdjustment` must be present -- an empty PATCH is a 400, not a no-op
 * 200. `null` is a valid, meaningful value for `sku`/`lowStockThreshold`/
 * `costPerUnit` (explicitly clearing them), so this uses
 * `hasOwnProperty`-style presence checks rather than truthiness.
 * @returns {{ok:true, value:{changes:object, stockAdjustment:object|null}}|{ok:false, errors:string[]}}
 */
export function validatePatchItemInput(body) {
  const errors = [];
  const b = body && typeof body === 'object' ? body : {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const changes = {};

  if (has('name')) {
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) errors.push('name, if provided, must be a non-empty string.');
    else changes.name = sanitizeCsvCell(name);
  }

  if (has('unit')) {
    const unit = typeof b.unit === 'string' ? b.unit.trim() : '';
    if (!unit) errors.push('unit, if provided, must be a non-empty string.');
    else changes.unit = sanitizeCsvCell(unit);
  }

  if (has('sku')) {
    if (b.sku === null) {
      changes.sku = null;
    } else if (typeof b.sku === 'string' && b.sku.trim()) {
      changes.sku = sanitizeCsvCell(b.sku.trim());
    } else {
      errors.push('sku, if provided, must be a non-empty string or null.');
    }
  }

  if (has('lowStockThreshold')) {
    if (b.lowStockThreshold === null) {
      changes.lowStockThreshold = null;
    } else {
      const n = toNumberOrNull(b.lowStockThreshold);
      if (n === null || Number.isNaN(n) || n < 0) {
        errors.push('lowStockThreshold, if provided, must be a non-negative number or null.');
      } else {
        changes.lowStockThreshold = n;
      }
    }
  }

  if (has('costPerUnit')) {
    if (b.costPerUnit === null) {
      changes.costPerUnit = null;
    } else {
      const n = toNumberOrNull(b.costPerUnit);
      if (n === null || Number.isNaN(n) || n < 0) {
        errors.push('costPerUnit, if provided, must be a non-negative number or null.');
      } else {
        changes.costPerUnit = n;
      }
    }
  }

  let stockAdjustment = null;
  if (has('stockAdjustment') && b.stockAdjustment !== null) {
    const sa = b.stockAdjustment && typeof b.stockAdjustment === 'object' ? b.stockAdjustment : {};
    const quantityDelta = Number(sa.quantityDelta);
    if (!Number.isFinite(quantityDelta) || quantityDelta === 0) {
      errors.push('stockAdjustment.quantityDelta is required and must be a non-zero number.');
    } else {
      const reasonRaw = typeof sa.reason === 'string' && sa.reason.trim() ? sa.reason.trim() : null;
      stockAdjustment = { quantityDelta, reason: reasonRaw ? sanitizeCsvCell(reasonRaw) : null };
    }
  }

  if (Object.keys(changes).length === 0 && !stockAdjustment) {
    errors.push('At least one field (name/sku/unit/lowStockThreshold/costPerUnit) or stockAdjustment is required.');
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { changes, stockAdjustment } };
}

/**
 * De-dupe rule (documented here, fast-mode -- no DECISIONS_LOG entry):
 * skip creating a new `low_stock` notification for this item if an
 * UNRESOLVED one (`status` != 'resolved') already exists for it. This is
 * intentionally simple -- no time-window/re-trigger-on-further-drop logic --
 * an admin resolving (or a future UI marking read/resolved) the existing
 * notification is what re-arms the trigger for that item. Runs after EVERY
 * movement insert (manual adjustment, Excel import row, or sale-triggered
 * decrement), not just decrements -- a threshold breach is a threshold
 * breach regardless of which direction the movement went.
 */
export async function maybeCreateLowStockNotification(db, { tenantId, item, resultingStock }) {
  if (item.lowStockThreshold === null || item.lowStockThreshold === undefined) return null;
  if (Number(resultingStock) > Number(item.lowStockThreshold)) return null;

  const [existing] = await db
    .select({ id: schema.notification.id })
    .from(schema.notification)
    .where(
      and(
        eq(schema.notification.type, 'low_stock'),
        eq(schema.notification.relatedEntityType, 'inventory_item'),
        eq(schema.notification.relatedEntityId, item.id),
        ne(schema.notification.status, 'resolved')
      )
    )
    .limit(1);
  if (existing) return null;

  const [row] = await db
    .insert(schema.notification)
    .values({
      tenantId,
      branchId: item.branchId,
      type: 'low_stock',
      title: `Low stock: ${item.name}`,
      message: `${item.name} is at ${resultingStock} ${item.unit}, at or below the low-stock threshold of ${item.lowStockThreshold} ${item.unit}.`,
      actorUserId: null,
      relatedEntityType: 'inventory_item',
      relatedEntityId: item.id,
      status: 'unread',
    })
    .returning();
  return row;
}

/**
 * Insert one `inventory_item` row (+ an initial `restock` movement if
 * `initialStock > 0`) in the CURRENT request transaction -- same reasoning
 * as `saleService.createSale`: `withTenantContext(pool)` already wraps the
 * whole handler in BEGIN...COMMIT, so no separate `db.transaction()` call is
 * needed for this to be atomic. A zero `initialStock` writes no movement row
 * (nothing moved) -- movements record actual stock changes, not a creation
 * event with nothing to log (the creation itself is covered by the route's
 * own `audit_log` write).
 */
export async function createItem(db, { tenantId, branchId, actorUserId, name, sku, unit, lowStockThreshold, costPerUnit, initialStock }) {
  const stockStr = initialStock.toFixed(3);
  const [item] = await db
    .insert(schema.inventoryItem)
    .values({
      tenantId,
      branchId,
      name,
      sku,
      unit,
      currentStock: stockStr,
      lowStockThreshold: lowStockThreshold === null ? null : lowStockThreshold.toFixed(3),
      costPerUnit: costPerUnit === null ? null : costPerUnit.toFixed(2),
    })
    .returning();

  let movement = null;
  if (initialStock > 0) {
    [movement] = await db
      .insert(schema.inventoryMovement)
      .values({
        tenantId,
        branchId,
        itemId: item.id,
        movementType: 'restock',
        quantityDelta: stockStr,
        resultingStock: stockStr,
        reason: 'Initial stock on item creation',
        actorUserId,
      })
      .returning();
    await maybeCreateLowStockNotification(db, { tenantId, item, resultingStock: stockStr });
  }

  return { item, movement };
}

export async function getItemById(db, { id }) {
  const [item] = await db
    .select()
    .from(schema.inventoryItem)
    .where(and(eq(schema.inventoryItem.id, id), isNull(schema.inventoryItem.deletedAt)))
    .limit(1);
  return item || null;
}

/**
 * Apply a PATCH edit (metadata changes and/or a stock adjustment) to an
 * already-fetched `item` in the CURRENT request transaction. Judgment call
 * (documented here, fast-mode): an `inventory_movement` row is written ONLY
 * when `stockAdjustment` is present -- `inventory_movement` is a stock-
 * quantity ledger (`quantityDelta`/`resultingStock` are NOT NULL columns
 * with real numeric meaning), so a pure rename/threshold-tweak edit has
 * nothing meaningful to log there. The route ALWAYS writes an `audit_log`
 * row for any PATCH (metadata-only or stock-adjusting) via
 * `logAuditEvent` -- that is the "every edit is attributed" guarantee this
 * task asks for; `inventory_movement` is the stricter "every STOCK CHANGE
 * is attributed" guarantee layered on top when stock actually moves.
 * Rejects (throws `InvalidStockAdjustmentError`) a `stockAdjustment` that
 * would drive `currentStock` negative -- unlike the sale-triggered
 * decrement (see `decrementForSaleLineItems` below), a manual PATCH is a
 * deliberate human action and a negative result here is far more likely to
 * be a typo than a real oversell.
 */
export class InvalidStockAdjustmentError extends Error {}

export async function updateItem(db, { tenantId, actorUserId, item, changes, stockAdjustment }) {
  const updateValues = { ...changes, updatedAt: new Date() };
  if (changes.lowStockThreshold !== undefined) {
    updateValues.lowStockThreshold = changes.lowStockThreshold === null ? null : Number(changes.lowStockThreshold).toFixed(3);
  }
  if (changes.costPerUnit !== undefined) {
    updateValues.costPerUnit = changes.costPerUnit === null ? null : Number(changes.costPerUnit).toFixed(2);
  }

  let resultingStock = null;
  let movement = null;

  if (stockAdjustment) {
    resultingStock = Number(item.currentStock) + stockAdjustment.quantityDelta;
    if (resultingStock < 0) {
      throw new InvalidStockAdjustmentError('Resulting stock cannot be negative.');
    }
    updateValues.currentStock = resultingStock.toFixed(3);
  }

  const [updated] = await db
    .update(schema.inventoryItem)
    .set(updateValues)
    .where(and(eq(schema.inventoryItem.id, item.id), isNull(schema.inventoryItem.deletedAt)))
    .returning();

  if (stockAdjustment) {
    const resultingStockStr = resultingStock.toFixed(3);
    [movement] = await db
      .insert(schema.inventoryMovement)
      .values({
        tenantId,
        branchId: item.branchId,
        itemId: item.id,
        movementType: stockAdjustment.quantityDelta >= 0 ? 'restock' : 'correction',
        quantityDelta: stockAdjustment.quantityDelta.toFixed(3),
        resultingStock: resultingStockStr,
        reason: stockAdjustment.reason,
        actorUserId,
      })
      .returning();
    await maybeCreateLowStockNotification(db, { tenantId, item: updated, resultingStock: resultingStockStr });
  }

  return { item: updated, movement };
}

/**
 * Sale-triggered decrement (P2-05 item 3). Called by `saleService.createSale`
 * with the just-inserted `sale_line_item` rows, in the SAME transaction as
 * the sale insert (`saleService.createSale` runs inside whatever
 * `withTenantContext(pool)` transaction the route opened -- no separate
 * `db.transaction()` needed, same reasoning as everywhere else in this
 * codebase).
 *
 * Wiring choice (documented here, fast-mode): the call site is
 * `saleService.createSale`, not the route handler and not a DB
 * trigger -- keeps the route thin (matches this module's own layering
 * convention) and keeps the atomicity guarantee structural (a throw here
 * rolls back the sale too, since it is the same transaction) without
 * reaching for a Postgres trigger, which would hide this business rule
 * outside the application layer where the rest of this codebase's logic
 * lives. CSV-imported sales (`salesCsvImportService.js`) do NOT go through
 * this: the sales CSV schema has no `inventoryItemId` column (only
 * `saleDate,itemName,quantity,unitPrice,paymentMethod,sku,taxAmount`), so
 * there is nothing to decrement against for that path -- flagged, not
 * silently ignored.
 *
 * Judgment call: a decrement NEVER blocks the sale from completing.
 * `resultingStock` is allowed to go negative (an oversell/unsynced-stock
 * signal, not an error) -- unlike a manual PATCH stock adjustment (see
 * `updateItem`'s `InvalidStockAdjustmentError`), a POS-style sale write
 * must not fail because inventory bookkeeping is behind reality; recording
 * the sale (the tenant's revenue/tax source of truth) takes priority. A
 * negative `resultingStock` is still `<= lowStockThreshold` for any
 * non-negative threshold, so the low-stock notification still fires.
 *
 * A line item's `inventoryItemId` is silently skipped (no decrement, no
 * error) if: it's null, the item can't be found under the caller's own
 * tenant (RLS-scoped lookup -- covers both "doesn't exist" and "belongs to
 * a different tenant", never distinguished to the caller, same
 * no-existence-leak posture as the rest of this codebase), or the item's
 * `branchId` doesn't match the sale's `branchId` (a menu/catalog item
 * linked to the wrong branch's stock is a data-entry mismatch, not
 * something this function guesses how to resolve -- it does not fail the
 * whole sale over it either).
 */
export async function decrementForSaleLineItems(db, { tenantId, branchId, lineItems, actorUserId, relatedSaleId }) {
  const results = [];
  for (const line of lineItems) {
    if (!line.inventoryItemId) continue;

    const item = await getItemById(db, { id: line.inventoryItemId });
    if (!item) continue;
    if (item.branchId !== branchId) continue;

    const quantityDelta = -Number(line.quantity);
    const resultingStock = Number(item.currentStock) + quantityDelta;
    const resultingStockStr = resultingStock.toFixed(3);

    await db
      .update(schema.inventoryItem)
      .set({ currentStock: resultingStockStr, updatedAt: new Date() })
      .where(eq(schema.inventoryItem.id, item.id));

    const [movement] = await db
      .insert(schema.inventoryMovement)
      .values({
        tenantId,
        branchId,
        itemId: item.id,
        movementType: 'sale_deduction',
        quantityDelta: quantityDelta.toFixed(3),
        resultingStock: resultingStockStr,
        reason: null,
        actorUserId,
        relatedSaleId,
      })
      .returning();

    await maybeCreateLowStockNotification(db, { tenantId, item: { ...item, currentStock: resultingStockStr }, resultingStock: resultingStockStr });
    results.push(movement);
  }
  return results;
}

/**
 * Branch-scoped, paginated item list. `staffBranchIds` restricts the result
 * set for STAFF regardless of whether `branchId` was supplied (same split
 * as `saleService.listSales`: the route already 403s a STAFF-supplied
 * `branchId` outside their scope before calling this).
 */
export async function listItems(db, { branchId, staffBranchIds, lowStockOnly, page, pageSize }) {
  const conditions = [isNull(schema.inventoryItem.deletedAt)];
  if (branchId) {
    conditions.push(eq(schema.inventoryItem.branchId, branchId));
  } else if (Array.isArray(staffBranchIds)) {
    if (staffBranchIds.length === 0) {
      return { data: [], meta: { page, pageSize, total: 0 } };
    }
    conditions.push(inArray(schema.inventoryItem.branchId, staffBranchIds));
  }
  if (lowStockOnly) {
    conditions.push(sql`${schema.inventoryItem.lowStockThreshold} IS NOT NULL`);
    conditions.push(sql`${schema.inventoryItem.currentStock} <= ${schema.inventoryItem.lowStockThreshold}`);
  }

  const whereExpr = and(...conditions);

  const [{ count }] = await db.select({ count: sql`count(*)::int` }).from(schema.inventoryItem).where(whereExpr);

  const rows = await db
    .select()
    .from(schema.inventoryItem)
    .where(whereExpr)
    .orderBy(schema.inventoryItem.name)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { data: rows.map(serializeItem), meta: { page, pageSize, total: count } };
}

/**
 * Dashboard/finance aggregation support (P2-03/P2-04/P2-06) -- a lightweight
 * COUNT of items currently at/below their own `lowStockThreshold`, same
 * branch-scope split (`branchId` else `staffBranchIds`) as `listItems`
 * above. Deliberately a separate COUNT-only query rather than
 * `listItems({ lowStockOnly: true }).meta.total` -- that call also fetches
 * and serializes a page of item rows the caller doesn't want for a single
 * dashboard tile number.
 */
export async function getLowStockCount(db, { branchId, staffBranchIds }) {
  const conditions = [
    isNull(schema.inventoryItem.deletedAt),
    sql`${schema.inventoryItem.lowStockThreshold} IS NOT NULL`,
    sql`${schema.inventoryItem.currentStock} <= ${schema.inventoryItem.lowStockThreshold}`,
  ];
  if (branchId) {
    conditions.push(eq(schema.inventoryItem.branchId, branchId));
  } else if (Array.isArray(staffBranchIds)) {
    if (staffBranchIds.length === 0) return 0;
    conditions.push(inArray(schema.inventoryItem.branchId, staffBranchIds));
  }

  const [{ count }] = await db
    .select({ count: sql`count(*)::int` })
    .from(schema.inventoryItem)
    .where(and(...conditions));
  return count;
}

export async function getRecentMovements(db, { itemId, limit = 20 }) {
  return db
    .select()
    .from(schema.inventoryMovement)
    .where(eq(schema.inventoryMovement.itemId, itemId))
    .orderBy(desc(schema.inventoryMovement.createdAt))
    .limit(limit);
}

export function serializeItem(item) {
  return {
    id: item.id,
    branchId: item.branchId,
    name: item.name,
    sku: item.sku ?? null,
    unit: item.unit,
    currentStock: item.currentStock,
    lowStockThreshold: item.lowStockThreshold ?? null,
    costPerUnit: item.costPerUnit ?? null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function serializeMovement(m) {
  return {
    id: m.id,
    itemId: m.itemId,
    branchId: m.branchId,
    movementType: m.movementType,
    quantityDelta: m.quantityDelta,
    resultingStock: m.resultingStock,
    reason: m.reason ?? null,
    actorUserId: m.actorUserId ?? null,
    relatedSaleId: m.relatedSaleId ?? null,
    importBatchRef: m.importBatchRef ?? null,
    createdAt: m.createdAt,
  };
}

export function serializeItemDetail(item, recentMovements) {
  return { ...serializeItem(item), recentMovements: recentMovements.map(serializeMovement) };
}
