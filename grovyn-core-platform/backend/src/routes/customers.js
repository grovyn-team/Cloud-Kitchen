/**
 * P3 backend (2026-07-30) — real, DB-backed Customers module routes: manual
 * create/edit, soft-delete (also the customer-erasure-request path per the
 * resolved D-008 amendment -- see `customerManagementService.js`'s doc
 * comment), and branch-scoped list/detail. Thin: validate input shape,
 * enforce branch scope, call `customerManagementService.js`, shape the
 * response via `reply()` -- same composition pattern as `routes/sales.js` /
 * `routes/inventoryManagement.js` (`withTenantContext(pool)(async (req, db)
 * => ...)`), never a bare `(req, res, next)` handler that reaches for `res`
 * directly.
 *
 * NAMING/MOUNT NOTE: this is a NEW file, distinct from the pre-existing
 * `routes/v1/customers.js` (legacy in-memory mock, single `GET
 * /api/v1/customers` handler backed by seeded data via
 * `services/customerService.js`). This task's brief names the real module's
 * list endpoint at the SAME path (`GET /api/v1/customers`) the legacy mock
 * already occupies -- unlike Sales (no path collision existed) or Inventory
 * (deliberately mounted under `/inventory/items` to avoid one), there is no
 * sub-path available here that still matches the brief's literal spec. The
 * legacy mock is superseded: `routes/v1/index.js` no longer mounts
 * `getCustomers` at `GET /api/v1/customers` (this file's `listCustomers`
 * replaces it there); `services/customerService.js` and
 * `routes/v1/customers.js` themselves are left in place, untouched, in case
 * another still-legacy consumer (e.g. `services/index.js`'s seed wiring)
 * needs them, but the real HTTP path is no longer routed through them.
 * Frontend does not call the legacy list endpoint directly (only the
 * unrelated `/api/v1/customers/segments` intelligence route, a distinct
 * path, unaffected) -- confirmed by grep before making this change.
 *
 * Every handler here composes with `requireSession(pool)` +
 * `requireRole(['ADMIN','STAFF'])` at the router level
 * (`routes/v1/index.js`) -- this file never trusts
 * `req.tenantId`/`req.userRole`/`req.branchIds` from anywhere except what
 * `requireSession` already verified server-side from the DB-backed session
 * row.
 *
 * Branch scope: `branchId` arrives via request BODY (`createCustomer`) or
 * QUERY (`listCustomers`), never a route `:param` -- same split
 * `routes/sales.js`/`routes/inventoryManagement.js` use, via the same
 * `isBranchAllowed(req, branchId)` predicate + `branchExistsInTenant` check.
 */

import { withTenantContext, reply } from '../middleware/tenantContext.js';
import { isBranchAllowed } from '../middleware/sessionAuth.js';
import { isValidUuid } from '../utils/validation.js';
import { branchExistsInTenant } from '../services/branchAccessService.js';
import * as customerManagementService from '../services/customerManagementService.js';
import { logAuditEvent } from '../services/auditService.js';

function badRequest(message, details) {
  return reply(400, { error: 'BadRequest', message, ...(details ? { details } : {}) });
}

function forbidden() {
  return reply(403, { error: 'Forbidden', message: 'Access to this branch is not permitted.' });
}

function notFound(message = 'Customer not found.') {
  return reply(404, { error: 'NotFound', message });
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Fetches the customer (RLS-scoped, so a cross-tenant id already returns
 * null) and checks branch scope, returning either the customer or a
 * `reply()` envelope to hand straight back -- shared by PATCH/DELETE/GET :id
 * so all three apply the identical no-existence-leak 404 posture
 * (`routes/inventoryManagement.js`'s `loadItemOr404` uses the same pattern).
 */
async function loadCustomerOr404(req, db, id) {
  if (!isValidUuid(id)) return { error: notFound() };
  const customer = await customerManagementService.getCustomerById(db, { id });
  if (!customer) return { error: notFound() };
  if (req.userRole === 'STAFF' && !isBranchAllowed(req, customer.branchId)) {
    return { error: notFound() };
  }
  return { customer };
}

/**
 * POST /api/v1/customers — manual create, one row, one DB transaction.
 * @param {import('pg').Pool} pool
 */
export function createCustomer(pool) {
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
    // documents (shared via `branchAccessService.js`): confirms branchId
    // actually belongs to THIS tenant, for every role, not just STAFF.
    if (!(await branchExistsInTenant(db, branchId))) {
      return forbidden();
    }

    const validation = customerManagementService.validateCreateCustomerInput(body);
    if (!validation.ok) {
      return badRequest('Invalid customer payload.', validation.errors);
    }

    const customer = await customerManagementService.createCustomer(db, {
      tenantId: req.tenantId,
      branchId,
      ...validation.value,
    });

    await logAuditEvent(db, {
      tenantId: req.tenantId,
      actorUserId: req.userId,
      action: 'customer.create',
      entityType: 'customer',
      entityId: customer.id,
      after: customerManagementService.serializeCustomer(customer),
    });

    return reply(201, customerManagementService.serializeCustomer(customer));
  });
}

/**
 * PATCH /api/v1/customers/:id — edit. Always writes an `audit_log` row
 * (before/after snapshot, actor-attributed) -- name/contact changes are
 * worth an audit trail per this task's own instruction, same as Inventory's
 * metadata edits.
 * @param {import('pg').Pool} pool
 */
export function updateCustomer(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const loaded = await loadCustomerOr404(req, db, req.params.id);
    if (loaded.error) return loaded.error;
    const { customer } = loaded;

    const validation = customerManagementService.validatePatchCustomerInput(req.body);
    if (!validation.ok) {
      return badRequest('Invalid customer edit payload.', validation.errors);
    }
    const { changes } = validation.value;

    const updated = await customerManagementService.updateCustomer(db, { customer, changes });

    await logAuditEvent(db, {
      tenantId: req.tenantId,
      actorUserId: req.userId,
      action: 'customer.update',
      entityType: 'customer',
      entityId: customer.id,
      before: customerManagementService.serializeCustomer(customer),
      after: customerManagementService.serializeCustomer(updated),
    });

    return customerManagementService.serializeCustomer(updated);
  });
}

/**
 * DELETE /api/v1/customers/:id — soft-delete only (`deleted_at` = now); no
 * hard delete, matches every other table's D-008 pattern. Also the
 * customer-erasure-request path per the resolved D-008 amendment --
 * satisfied by this soft-delete plus the deployment's backup-expiry window
 * (P7-02 deployment config, not this handler's concern). Writes an
 * `audit_log` row so "who erased this customer, and when" is itself
 * reconstructable.
 * @param {import('pg').Pool} pool
 */
export function deleteCustomer(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const loaded = await loadCustomerOr404(req, db, req.params.id);
    if (loaded.error) return loaded.error;
    const { customer } = loaded;

    const deleted = await customerManagementService.softDeleteCustomer(db, { id: customer.id });
    // Can only be null here if the row was concurrently deleted between the
    // load above and this update in the same transaction -- vanishingly
    // unlikely, but handled the same no-existence-leak way as everywhere
    // else rather than assuming it can't happen.
    if (!deleted) return notFound();

    await logAuditEvent(db, {
      tenantId: req.tenantId,
      actorUserId: req.userId,
      action: 'customer.delete',
      entityType: 'customer',
      entityId: customer.id,
      before: customerManagementService.serializeCustomer(customer),
      after: null,
    });

    // No explicit return value -- `withTenantContext`'s wrapper treats an
    // `undefined` handler result as "send 204 with no body" (see
    // `middleware/tenantContext.js`'s doc comment), which is the correct
    // shape for a successful DELETE with nothing to return.
  });
}

/**
 * GET /api/v1/customers?branchId=&category=&page=&pageSize= — paginated,
 * branch-scoped list, optional `category` exact-match filter.
 * @param {import('pg').Pool} pool
 */
export function listCustomers(pool) {
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

    const category = typeof query.category === 'string' && query.category.trim() ? query.category.trim() : null;
    const page = clampInt(query.page, 1, 1, 1_000_000);
    const pageSize = clampInt(query.pageSize, 20, 1, 100);

    return customerManagementService.listCustomers(db, {
      branchId: branchId || null,
      staffBranchIds: req.userRole === 'STAFF' ? req.branchIds : null,
      category,
      page,
      pageSize,
    });
  });
}

/**
 * GET /api/v1/customers/:id — detail. A STAFF request for a customer outside
 * their branch scope returns 404 (not 403), same don't-leak-cross-scope-
 * existence posture the rest of this codebase uses.
 * @param {import('pg').Pool} pool
 */
export function getCustomer(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const loaded = await loadCustomerOr404(req, db, req.params.id);
    if (loaded.error) return loaded.error;
    return customerManagementService.serializeCustomer(loaded.customer);
  });
}
