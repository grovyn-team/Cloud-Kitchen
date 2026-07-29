/**
 * P2-05 backend (2026-07-30) — real, DB-backed Inventory module routes:
 * manual item create/edit, Excel/CSV bulk import, the staff->admin stock
 * request flow, and branch-scoped list/detail. Thin: validate input shape,
 * enforce branch scope, call `inventoryManagementService.js`/
 * `inventoryImportService.js`, shape the response via `reply()` -- same
 * composition pattern as `routes/sales.js`
 * (`withTenantContext(pool)(async (req, db) => ...)`), never a bare
 * `(req, res, next)` handler that reaches for `res` directly.
 *
 * NAMING NOTE: this is a NEW file, distinct from the pre-existing
 * `routes/inventory.js` (legacy in-memory mock, `GET /api/v1/inventory` /
 * `/inventory-insights`) -- untouched by this task. This file's routes are
 * mounted under `/api/v1/inventory/items`, `/api/v1/inventory/import`,
 * `/api/v1/inventory/requests`, which do not collide with the legacy exact
 * paths.
 *
 * Every handler here composes with `requireSession(pool)` +
 * `requireRole(['ADMIN','STAFF'])` at the router level
 * (`routes/v1/index.js`) -- this file never trusts
 * `req.tenantId`/`req.userRole`/`req.branchIds` from anywhere except what
 * `requireSession` already verified server-side from the DB-backed session
 * row.
 *
 * Branch scope: `branchId` arrives via request BODY (`createItem`,
 * `importItems`, `createRequest`) or QUERY (`listItems`), never a route
 * `:param` -- same split `routes/sales.js` uses, via the same
 * `isBranchAllowed(req, branchId)` predicate.
 */

import crypto from 'crypto';
import { withTenantContext, reply } from '../middleware/tenantContext.js';
import { isBranchAllowed } from '../middleware/sessionAuth.js';
import { isValidUuid } from '../utils/validation.js';
import { branchExistsInTenant } from '../services/branchAccessService.js';
import * as inventoryManagementService from '../services/inventoryManagementService.js';
import {
  parseInventoryFile,
  validateAndBuildRows,
  insertInventoryImportBatch,
  InventoryImportStructureError,
  InventoryImportRowLimitError,
  InventoryImportFileTooLargeError,
} from '../services/inventoryImportService.js';
import { logAuditEvent } from '../services/auditService.js';
import { schema } from '../db/dal.js';
import { sanitizeCsvCell } from '../services/csvSanitize.js';

function badRequest(message, details) {
  return reply(400, { error: 'BadRequest', message, ...(details ? { details } : {}) });
}

function forbidden() {
  return reply(403, { error: 'Forbidden', message: 'Access to this branch is not permitted.' });
}

function notFound(message = 'Inventory item not found.') {
  return reply(404, { error: 'NotFound', message });
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Fetches the item (RLS-scoped, so a cross-tenant id already returns null)
 * and checks branch scope, returning either the item or a `reply()`
 * envelope to hand straight back -- shared by PATCH and GET :id so both
 * routes apply the identical no-existence-leak 404 posture
 * (`routes/sales.js`'s `getSale` uses the same pattern).
 */
async function loadItemOr404(req, db, id) {
  if (!isValidUuid(id)) return { error: notFound() };
  const item = await inventoryManagementService.getItemById(db, { id });
  if (!item) return { error: notFound() };
  if (req.userRole === 'STAFF' && !isBranchAllowed(req, item.branchId)) {
    return { error: notFound() };
  }
  return { item };
}

/**
 * POST /api/v1/inventory/items — manual entry, one item (+ optional initial
 * stock) in one DB transaction.
 * @param {import('pg').Pool} pool
 */
export function createItem(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const body = req.body || {};
    const branchId = typeof body.branchId === 'string' ? body.branchId.trim() : '';
    if (!isValidUuid(branchId)) {
      return badRequest('branchId is required and must be a valid UUID.');
    }
    if (!isBranchAllowed(req, branchId)) {
      return forbidden();
    }
    // Closes the same real schema gap `saleService.branchExistsInTenant`
    // documents (now shared via `branchAccessService.js`): confirms
    // branchId actually belongs to THIS tenant, for every role, not just
    // STAFF.
    if (!(await branchExistsInTenant(db, branchId))) {
      return forbidden();
    }

    const validation = inventoryManagementService.validateCreateItemInput(body);
    if (!validation.ok) {
      return badRequest('Invalid inventory item payload.', validation.errors);
    }

    const { item, movement } = await inventoryManagementService.createItem(db, {
      tenantId: req.tenantId,
      branchId,
      actorUserId: req.userId,
      ...validation.value,
    });

    await logAuditEvent(db, {
      tenantId: req.tenantId,
      actorUserId: req.userId,
      action: 'inventory.create',
      entityType: 'inventory_item',
      entityId: item.id,
      after: inventoryManagementService.serializeItem(item),
    });

    return reply(201, {
      ...inventoryManagementService.serializeItem(item),
      initialMovement: movement ? inventoryManagementService.serializeMovement(movement) : null,
    });
  });
}

/**
 * PATCH /api/v1/inventory/items/:id — edit (metadata and/or a stock
 * adjustment). Always writes an `audit_log` row (any changed field);
 * additionally writes an `inventory_movement` row ONLY when the request
 * includes a `stockAdjustment` -- see
 * `inventoryManagementService.updateItem`'s doc comment for the judgment
 * call and rationale.
 * @param {import('pg').Pool} pool
 */
export function updateItem(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const loaded = await loadItemOr404(req, db, req.params.id);
    if (loaded.error) return loaded.error;
    const { item } = loaded;

    const validation = inventoryManagementService.validatePatchItemInput(req.body);
    if (!validation.ok) {
      return badRequest('Invalid inventory item edit payload.', validation.errors);
    }
    const { changes, stockAdjustment } = validation.value;

    let result;
    try {
      result = await inventoryManagementService.updateItem(db, {
        tenantId: req.tenantId,
        actorUserId: req.userId,
        item,
        changes,
        stockAdjustment,
      });
    } catch (err) {
      if (err instanceof inventoryManagementService.InvalidStockAdjustmentError) {
        return badRequest(err.message);
      }
      throw err;
    }

    await logAuditEvent(db, {
      tenantId: req.tenantId,
      actorUserId: req.userId,
      action: 'inventory.update',
      entityType: 'inventory_item',
      entityId: item.id,
      before: inventoryManagementService.serializeItem(item),
      after: inventoryManagementService.serializeItem(result.item),
    });

    return {
      ...inventoryManagementService.serializeItem(result.item),
      movement: result.movement ? inventoryManagementService.serializeMovement(result.movement) : null,
    };
  });
}

/**
 * POST /api/v1/inventory/import — Excel/CSV upload. Validate-before-commit,
 * all-or-nothing: any invalid row means ZERO rows are written, and the
 * response lists every row error found, not just the first. `requireRole`/
 * `requireSession` run before this at the router level; `inventoryUpload.
 * single('file')` + `handleInventoryUploadError` (multer, memory storage)
 * run between those and this handler (see `routes/v1/index.js`).
 * @param {import('pg').Pool} pool
 */
export function importItems(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const body = req.body || {};
    const branchId = typeof body.branchId === 'string' ? body.branchId.trim() : '';
    if (!isValidUuid(branchId)) {
      return badRequest('branchId (form field) is required and must be a valid UUID.');
    }
    if (!isBranchAllowed(req, branchId)) {
      return forbidden();
    }
    if (!(await branchExistsInTenant(db, branchId))) {
      return forbidden();
    }
    if (!req.file || !req.file.buffer) {
      return badRequest('A .csv or .xlsx file is required (multipart field name "file").');
    }

    let records;
    try {
      records = await parseInventoryFile(req.file.buffer, req.file.originalname);
    } catch (err) {
      if (err instanceof InventoryImportFileTooLargeError || err instanceof InventoryImportRowLimitError) {
        return reply(413, { error: 'PayloadTooLarge', message: err.message });
      }
      if (err instanceof InventoryImportStructureError) {
        return badRequest(err.message);
      }
      throw err;
    }

    const { validRows, errors } = validateAndBuildRows(records);

    // All-or-nothing: any row error means zero rows are committed. Nothing
    // has touched the DB yet at this point (parse + validate are both pure
    // in-memory steps), so there is nothing to roll back.
    if (errors.length > 0) {
      return reply(422, { importedCount: 0, errors });
    }

    const importBatchRef = crypto.randomUUID();
    const { importedCount, createdCount, updatedCount } = await insertInventoryImportBatch(db, {
      rows: validRows,
      tenantId: req.tenantId,
      branchId,
      actorUserId: req.userId,
      importBatchRef,
    });

    await logAuditEvent(db, {
      tenantId: req.tenantId,
      actorUserId: req.userId,
      action: 'inventory.import',
      entityType: 'inventory_import_batch',
      entityId: importBatchRef,
      after: { branchId, importedCount, createdCount, updatedCount },
    });

    return reply(201, { importedCount, createdCount, updatedCount, errors: [], importBatchRef });
  });
}

/**
 * POST /api/v1/inventory/requests — staff (or admin) raises a stock
 * request; inserted directly as a `notification` row, no separate
 * approval-workflow state machine (per this task's explicit "keep this
 * minimal" instruction).
 *
 * Visibility choice (documented here, fast-mode -- no DECISIONS_LOG entry):
 * the notification is written branch-scoped (`branchId` = the requester's
 * own branch), matching every other row this table holds. Admin visibility
 * is still effectively tenant-wide: an ADMIN's own notification feed query
 * (not built in this task's scope) is expected to omit the branch filter
 * the same way `saleService.getRollup`'s "admin omitting branchId -> all
 * branches" pattern works and the same way `schema.js`'s own
 * `notification_tenant_status_idx` comment already documents ("Admin's
 * cross-branch notification feed (no branch filter)") -- so a real
 * branch_id here is the structurally correct choice, not a tenant-wide
 * NULL, which would break the branch-scoped feed a STAFF member (or a
 * future per-branch admin view) needs.
 * @param {import('pg').Pool} pool
 */
export function createRequest(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const body = req.body || {};
    const branchId = typeof body.branchId === 'string' ? body.branchId.trim() : '';
    if (!isValidUuid(branchId)) {
      return badRequest('branchId is required and must be a valid UUID.');
    }
    if (!isBranchAllowed(req, branchId)) {
      return forbidden();
    }
    if (!(await branchExistsInTenant(db, branchId))) {
      return forbidden();
    }

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      return badRequest('message is required.');
    }
    const itemName = typeof body.itemName === 'string' ? body.itemName.trim() : '';
    const inventoryItemId =
      typeof body.inventoryItemId === 'string' && isValidUuid(body.inventoryItemId) ? body.inventoryItemId : null;

    // If a real inventoryItemId was supplied, confirm it belongs to this
    // tenant+branch before linking it -- same no-cross-tenant-reference
    // discipline as everywhere else in this codebase; a mismatched id is
    // simply dropped (not an error), consistent with this endpoint's own
    // "keep this minimal" scope.
    let linkedItemId = null;
    if (inventoryItemId) {
      const item = await inventoryManagementService.getItemById(db, { id: inventoryItemId });
      if (item && item.branchId === branchId) linkedItemId = item.id;
    }

    const [notif] = await db
      .insert(schema.notification)
      .values({
        tenantId: req.tenantId,
        branchId,
        type: 'inventory_request',
        title: itemName ? `Stock request: ${sanitizeCsvCell(itemName)}` : 'Stock request',
        message: sanitizeCsvCell(message),
        actorUserId: req.userId,
        relatedEntityType: linkedItemId ? 'inventory_item' : null,
        relatedEntityId: linkedItemId,
        status: 'unread',
      })
      .returning();

    return reply(201, {
      id: notif.id,
      branchId: notif.branchId,
      type: notif.type,
      title: notif.title,
      message: notif.message,
      relatedEntityType: notif.relatedEntityType,
      relatedEntityId: notif.relatedEntityId,
      status: notif.status,
      createdAt: notif.createdAt,
    });
  });
}

/**
 * GET /api/v1/inventory/items?branchId=&lowStock=true&page=&pageSize= —
 * paginated, branch-scoped list.
 * @param {import('pg').Pool} pool
 */
export function listItems(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const query = req.query || {};
    const branchId = typeof query.branchId === 'string' ? query.branchId.trim() : '';
    if (branchId && !isValidUuid(branchId)) {
      return badRequest('branchId must be a valid UUID.');
    }
    if (branchId && !isBranchAllowed(req, branchId)) {
      return forbidden();
    }
    if (branchId && !(await branchExistsInTenant(db, branchId))) {
      return forbidden();
    }

    const lowStockOnly = query.lowStock === 'true' || query.lowStock === '1';
    const page = clampInt(query.page, 1, 1, 1_000_000);
    const pageSize = clampInt(query.pageSize, 20, 1, 100);

    return inventoryManagementService.listItems(db, {
      branchId: branchId || null,
      staffBranchIds: req.userRole === 'STAFF' ? req.branchIds : null,
      lowStockOnly,
      page,
      pageSize,
    });
  });
}

/**
 * GET /api/v1/inventory/items/:id — detail + recent movement history.
 * @param {import('pg').Pool} pool
 */
export function getItem(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const loaded = await loadItemOr404(req, db, req.params.id);
    if (loaded.error) return loaded.error;

    const recentMovements = await inventoryManagementService.getRecentMovements(db, { itemId: loaded.item.id });
    return inventoryManagementService.serializeItemDetail(loaded.item, recentMovements);
  });
}
