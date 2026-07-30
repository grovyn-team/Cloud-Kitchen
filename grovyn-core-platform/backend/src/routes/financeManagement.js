/**
 * P2-03/P2-06 backend — real, DB-backed Finance summary route:
 *   - GET /api/v1/finance/summary?branchId=&period=day|week|month —
 *     ADMIN-only (enforced at the ROUTER level in `routes/v1/index.js`, same
 *     `requireRole(['ADMIN'])` composition style as `staffManagement.js`/
 *     `dashboard.js`'s `by-branch`). Explicitly financial (revenue, COGS,
 *     tax collected) -- never reachable by STAFF at all, unlike
 *     `dashboard/summary` which STAFF can reach with a reduced shape.
 *
 * NAMING/MOUNT NOTE: this SUPERSEDES the legacy in-memory mock previously
 * mounted at this exact path (`routes/finance.js`'s `getFinanceSummary`,
 * backed by `profitEngine.js`/`financeService.js`'s seeded mock data,
 * ADMIN-only via the legacy `authMiddleware.js` HMAC scheme) --
 * `routes/v1/index.js` no longer mounts that handler at
 * `GET /api/v1/finance/summary`; this real DB-backed one replaces it, same
 * collision-supersede pattern P3's `routes/customers.js` already
 * established for `GET /api/v1/customers`. `routes/finance.js`'s other
 * routes (`/finance/stores`, `/finance/brands`, `/finance/skus`) and the
 * `getFinanceSummary` function itself are left in place, untouched --
 * out of this task's scope. **Frontend impact (flagged, not fixed here --
 * out of this backend task's lane per its own scope):** `Finance.tsx`
 * currently consumes the LEGACY response shape at this path
 * (`apiPaths.financeSummary`); this new shape is different (see
 * `financeManagementService.getFinanceSummary`'s doc comment) --
 * frontend-developer needs to rewire that page, same follow-up
 * Customers/Notifications/Inventory already needed after their own
 * supersedes.
 *
 * Thin: validate input shape, verify (not just trust) a client-supplied
 * `branchId`, call `financeManagementService.js`, shape the response via
 * `reply()` -- same `withTenantContext(pool)(async (req, db) => ...)`
 * composition pattern as every other real module in this codebase.
 */

import { withTenantContext, reply } from '../middleware/tenantContext.js';
import { isBranchAllowed } from '../middleware/sessionAuth.js';
import { isValidUuid } from '../utils/validation.js';
import { branchExistsInTenant } from '../services/branchAccessService.js';
import * as financeManagementService from '../services/financeManagementService.js';

function badRequest(message, details) {
  return reply(400, { error: 'BadRequest', message, ...(details ? { details } : {}) });
}

function forbidden() {
  return reply(403, { error: 'Forbidden', message: 'Access to this branch is not permitted.' });
}

/**
 * GET /api/v1/finance/summary?branchId=&period=day|week|month
 * @param {import('pg').Pool} pool
 */
export function getSummary(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const query = req.query || {};
    const period = typeof query.period === 'string' ? query.period.trim() : '';
    if (!financeManagementService.PERIODS.includes(period)) {
      return badRequest(`period is required and must be one of: ${financeManagementService.PERIODS.join(', ')}.`);
    }

    const branchId = typeof query.branchId === 'string' ? query.branchId.trim() : '';
    if (branchId && !isValidUuid(branchId)) {
      return badRequest('branchId must be a valid UUID.');
    }
    // The route is ADMIN-only (router-level gate), so `isBranchAllowed`
    // always returns true here -- called anyway for the same reason
    // `branchAccessService.js`'s own doc comment states: "every handler that
    // accepts a client-supplied branchId calls this in addition to
    // isBranchAllowed, for every role, not just STAFF." `branchExistsInTenant`
    // is the check that actually matters here (rejects a real branch id that
    // belongs to a different tenant).
    if (branchId && !isBranchAllowed(req, branchId)) {
      return forbidden();
    }
    if (branchId && !(await branchExistsInTenant(db, branchId))) {
      return forbidden();
    }

    return financeManagementService.getFinanceSummary(db, { period, branchId: branchId || null });
  });
}
