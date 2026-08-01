/**
 * Integration Task 1 (round 3) — real, DB-backed Inventory Alias routes:
 * ADMIN-only create, so a failed CSV import (unmatched item name) is one
 * click from working -- the whole reason this endpoint exists is the error
 * screen `routes/sales.js`'s `importSales` returns on an unmatched name.
 *
 * Thin: validate input shape, enforce branch scope, call
 * `inventoryAliasService.js`, shape the response via `reply()` -- same
 * composition pattern as every other real module (`withTenantContext(pool)
 * (async (req, db) => ...)`).
 */

import { withTenantContext, reply } from '../middleware/tenantContext.js';
import { isBranchAllowed } from '../middleware/sessionAuth.js';
import { isValidUuid } from '../utils/validation.js';
import { branchExistsInTenant } from '../services/branchAccessService.js';
import { getItemById } from '../services/inventoryManagementService.js';
import * as inventoryAliasService from '../services/inventoryAliasService.js';

function badRequest(message, details) {
  return reply(400, { error: 'BadRequest', message, ...(details ? { details } : {}) });
}

function forbidden() {
  return reply(403, { error: 'Forbidden', message: 'Access to this branch is not permitted.' });
}

function conflict(message) {
  return reply(409, { error: 'Conflict', message });
}

/**
 * POST /api/v1/inventory/aliases — ADMIN-only create. Body:
 * `{ branchId, inventoryItemId, aliasName }`.
 * @param {import('pg').Pool} pool
 */
export function createAlias(pool) {
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

    const inventoryItemId = typeof body.inventoryItemId === 'string' ? body.inventoryItemId.trim() : '';
    if (!isValidUuid(inventoryItemId)) {
      return badRequest('inventoryItemId is required and must be a valid UUID.');
    }
    const item = await getItemById(db, { id: inventoryItemId });
    if (!item || item.branchId !== branchId) {
      return badRequest('inventoryItemId must reference a real item in this branch.');
    }

    const validation = inventoryAliasService.validateCreateAliasInput(body);
    if (!validation.ok) {
      return badRequest('Invalid alias payload.', validation.errors);
    }
    const { aliasName } = validation.value;

    const existing = await inventoryAliasService.findAliasByBranchAndName(db, { branchId, aliasName });
    if (existing) {
      return conflict(`"${aliasName}" is already mapped to an item in this branch.`);
    }

    const alias = await inventoryAliasService.createAlias(db, {
      tenantId: req.tenantId,
      branchId,
      inventoryItemId,
      aliasName,
    });

    return reply(201, inventoryAliasService.serializeAlias(alias));
  });
}
