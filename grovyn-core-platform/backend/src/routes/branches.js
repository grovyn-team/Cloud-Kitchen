/**
 * P1-06 backend — real, DB-backed Branch management module routes: ADMIN-only
 * create/edit/soft-delete, ADMIN-or-STAFF branch-scoped list/detail (STAFF
 * sees only branches they hold an active grant for). Thin: validate input
 * shape, enforce branch scope, call `branchManagementService.js`, shape the
 * response via `reply()` -- same composition pattern as `routes/customers.js`
 * (`withTenantContext(pool)(async (req, db) => ...)`), never a bare
 * `(req, res, next)` handler that reaches for `res` directly.
 *
 * SUPERSEDES the legacy in-memory `GET /api/v1/stores` mock
 * (`routes/v1/stores.js`, no longer mounted in `routes/v1/index.js`) -- every
 * frontend branch picker that used to call `apiPaths.stores` now calls
 * `GET /api/v1/branches` instead. `routes/v1/stores.js` and
 * `services/index.js`'s `storeService` are left in place, unmounted/unused,
 * as part of Integration Task 2's broader legacy-auth retirement (see
 * `routes/v1/index.js`'s top doc comment for the full list).
 *
 * Every handler here composes with `requireSession(pool)` at the router
 * level (`routes/v1/index.js`) -- write handlers (create/update/delete)
 * additionally require `requireRole(['ADMIN'])` there; list/detail allow
 * `['ADMIN','STAFF']`. This file never trusts `req.tenantId`/`req.userRole`/
 * `req.branchIds` from anywhere except what `requireSession` already
 * verified server-side from the DB-backed session row.
 */

import { withTenantContext, reply } from '../middleware/tenantContext.js';
import { isBranchAllowed } from '../middleware/sessionAuth.js';
import { isValidUuid } from '../utils/validation.js';
import * as branchManagementService from '../services/branchManagementService.js';
import { logAuditEvent } from '../services/auditService.js';

function badRequest(message, details) {
  return reply(400, { error: 'BadRequest', message, ...(details ? { details } : {}) });
}

function notFound(message = 'Branch not found.') {
  return reply(404, { error: 'NotFound', message });
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Fetches the branch (RLS-scoped, so a cross-tenant id already returns null)
 * and checks branch scope -- a STAFF request for a branch outside their
 * granted set returns 404, not 403, same no-existence-leak posture
 * `routes/customers.js`'s `loadCustomerOr404` uses. Here the branch id IS the
 * scope target (not a related field), so `isBranchAllowed(req, id)` applies
 * directly.
 */
async function loadBranchOr404(req, db, id) {
  if (!isValidUuid(id)) return { error: notFound() };
  const branch = await branchManagementService.getBranchById(db, { id });
  if (!branch) return { error: notFound() };
  if (!isBranchAllowed(req, branch.id)) return { error: notFound() };
  return { branch };
}

/**
 * POST /api/v1/branches — ADMIN-only create.
 * @param {import('pg').Pool} pool
 */
export function createBranch(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const validation = branchManagementService.validateCreateBranchInput(req.body);
    if (!validation.ok) {
      return badRequest('Invalid branch payload.', validation.errors);
    }

    const branch = await branchManagementService.createBranch(db, {
      tenantId: req.tenantId,
      ...validation.value,
    });

    await logAuditEvent(db, {
      tenantId: req.tenantId,
      actorUserId: req.userId,
      action: 'branch.create',
      entityType: 'branch',
      entityId: branch.id,
      after: branchManagementService.serializeBranch(branch),
    });

    return reply(201, branchManagementService.serializeBranch(branch));
  });
}

/**
 * PATCH /api/v1/branches/:id — ADMIN-only edit. Always writes an `audit_log`
 * row (before/after snapshot, actor-attributed).
 * @param {import('pg').Pool} pool
 */
export function updateBranch(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const loaded = await loadBranchOr404(req, db, req.params.id);
    if (loaded.error) return loaded.error;
    const { branch } = loaded;

    const validation = branchManagementService.validatePatchBranchInput(req.body);
    if (!validation.ok) {
      return badRequest('Invalid branch edit payload.', validation.errors);
    }
    const { changes } = validation.value;

    const updated = await branchManagementService.updateBranch(db, { branch, changes });

    await logAuditEvent(db, {
      tenantId: req.tenantId,
      actorUserId: req.userId,
      action: 'branch.update',
      entityType: 'branch',
      entityId: branch.id,
      before: branchManagementService.serializeBranch(branch),
      after: branchManagementService.serializeBranch(updated),
    });

    return branchManagementService.serializeBranch(updated);
  });
}

/**
 * DELETE /api/v1/branches/:id — ADMIN-only soft-delete. Also revokes every
 * active `staff_branch_access` grant for the branch in the SAME transaction
 * (a tombstoned branch shouldn't leave stale active grants pointing at it) --
 * same cascade pattern `staffManagementService.deactivateStaff` uses.
 * @param {import('pg').Pool} pool
 */
export function deleteBranch(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const loaded = await loadBranchOr404(req, db, req.params.id);
    if (loaded.error) return loaded.error;
    const { branch } = loaded;

    const deleted = await branchManagementService.softDeleteBranch(db, { id: branch.id });
    if (!deleted) return notFound();

    await branchManagementService.revokeAllBranchAccessForBranch(db, { branchId: branch.id });

    await logAuditEvent(db, {
      tenantId: req.tenantId,
      actorUserId: req.userId,
      action: 'branch.delete',
      entityType: 'branch',
      entityId: branch.id,
      before: branchManagementService.serializeBranch(branch),
      after: null,
    });

    // No explicit return value -- 204, same convention as
    // `routes/customers.js`'s `deleteCustomer`.
  });
}

/**
 * GET /api/v1/branches?page=&pageSize= — ADMIN sees every branch in the
 * tenant; STAFF sees only branches they hold an active grant for.
 * @param {import('pg').Pool} pool
 */
export function listBranches(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const query = req.query || {};
    const page = clampInt(query.page, 1, 1, 1_000_000);
    const pageSize = clampInt(query.pageSize, 20, 1, 100);

    return branchManagementService.listBranches(db, {
      staffBranchIds: req.userRole === 'STAFF' ? req.branchIds : null,
      page,
      pageSize,
    });
  });
}

/**
 * GET /api/v1/branches/:id — detail. A STAFF request for a branch outside
 * their granted set returns 404, same no-existence-leak posture as
 * `routes/customers.js`'s `getCustomer`.
 * @param {import('pg').Pool} pool
 */
export function getBranch(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const loaded = await loadBranchOr404(req, db, req.params.id);
    if (loaded.error) return loaded.error;
    return branchManagementService.serializeBranch(loaded.branch);
  });
}
