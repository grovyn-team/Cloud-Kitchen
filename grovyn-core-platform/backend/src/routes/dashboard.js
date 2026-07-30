/**
 * P2-03/P2-04/P2-06 backend — real, DB-backed Dashboard aggregation routes:
 *   - GET /api/v1/dashboard/summary — ADMIN or STAFF. Reachable by both, but
 *     the RESPONSE SHAPE differs by role (see `dashboardService.serializeSummary`):
 *     STAFF never receives `revenue`/`aov` keys at all, only operational
 *     figures (`orderCount`, `lowStockCount`, `unresolvedNotificationCount`)
 *     for their own branch scope. This is enforced HERE (server-side), not
 *     left to the frontend to hide.
 *   - GET /api/v1/dashboard/by-branch — ADMIN-only (enforced at the ROUTER
 *     level in `routes/v1/index.js` via an extra `requireRole(['ADMIN'])`,
 *     same composition style as `resolveNotification`/`staffManagement`) --
 *     per-branch revenue/orders/AOV across every branch in the tenant.
 *
 * Thin: validate input shape, enforce branch scope, call
 * `dashboardService.js`, shape the response via `reply()` -- same
 * `withTenantContext(pool)(async (req, db) => ...)` composition pattern as
 * `routes/sales.js`/`routes/notifications.js`, never a bare
 * `(req, res, next)` handler that reaches for `res` directly.
 *
 * Every handler here composes with `requireSession(pool)` + `requireRole`
 * at the router level -- this file never trusts
 * `req.tenantId`/`req.userRole`/`req.branchIds` from anywhere except what
 * `requireSession` already verified server-side from the DB-backed session
 * row.
 *
 * Branch scope: `branchId` arrives via a QUERY param (`getSummary` only --
 * `getByBranch` has no `branchId` param at all, it is inherently
 * cross-branch), never a route `:param` -- same split every other module in
 * this codebase uses, via the same `isBranchAllowed(req, branchId)` +
 * `branchExistsInTenant` check.
 */

import { withTenantContext, reply } from '../middleware/tenantContext.js';
import { isBranchAllowed } from '../middleware/sessionAuth.js';
import { isValidUuid } from '../utils/validation.js';
import { branchExistsInTenant } from '../services/branchAccessService.js';
import * as dashboardService from '../services/dashboardService.js';

function badRequest(message, details) {
  return reply(400, { error: 'BadRequest', message, ...(details ? { details } : {}) });
}

function forbidden() {
  return reply(403, { error: 'Forbidden', message: 'Access to this branch is not permitted.' });
}

/**
 * GET /api/v1/dashboard/summary?branchId=&period=day|week|month
 * @param {import('pg').Pool} pool
 */
export function getSummary(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const query = req.query || {};
    const period = typeof query.period === 'string' ? query.period.trim() : '';
    if (!dashboardService.PERIODS.includes(period)) {
      return badRequest(`period is required and must be one of: ${dashboardService.PERIODS.join(', ')}.`);
    }

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

    // STAFF is always confined to their own branch(es) regardless of
    // whether/what `branchId` was passed, same split as
    // `saleService.listSales`/`saleService.getRollup`.
    const restrictBranchIds = req.userRole === 'STAFF' ? req.branchIds : null;

    const data = await dashboardService.getSummaryData(db, {
      period,
      branchId: branchId || null,
      restrictBranchIds,
    });

    return {
      period,
      branchId: branchId || null,
      ...dashboardService.serializeSummary(data, { role: req.userRole }),
    };
  });
}

/**
 * GET /api/v1/dashboard/by-branch?period=day|week|month — ADMIN-only role
 * gate enforced at the router level (`routes/v1/index.js`), not here.
 * @param {import('pg').Pool} pool
 */
export function getByBranch(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const query = req.query || {};
    const period = typeof query.period === 'string' ? query.period.trim() : '';
    if (!dashboardService.PERIODS.includes(period)) {
      return badRequest(`period is required and must be one of: ${dashboardService.PERIODS.join(', ')}.`);
    }

    const data = await dashboardService.getByBranchData(db, { period });
    return { period, data };
  });
}
