/**
 * P2-03/P2-04/P2-06 backend — real, DB-backed Dashboard aggregation for
 * `GET /api/v1/dashboard/summary` and `GET /api/v1/dashboard/by-branch`.
 *
 * This is a THIN composition layer over three already-tenant-scoped domain
 * services, not a new business-logic owner: `sale`-domain aggregation stays
 * in `saleService.js` (`getCurrentPeriodSummary`/`getBranchBreakdown`,
 * reusing `getRollup`'s real-SQL-aggregation style), inventory low-stock
 * counting stays in `inventoryManagementService.js`, notification counting
 * stays in `notificationService.js`. Dashboard-specific work here is limited
 * to (1) fanning out to those three calls and (2) the role-aware response
 * SHAPE (`serializeSummary`) -- everything else is delegated, matching this
 * codebase's loose-coupling convention (business logic lives in the owning
 * service, not duplicated in a cross-cutting aggregator).
 *
 * Every exported function here takes a tenant-scoped `db` (same contract as
 * every other service in this codebase) -- there is no code path here that
 * runs a query without RLS already active on the connection, because every
 * downstream call (`saleService`/`inventoryManagementService`/
 * `notificationService`) already carries that same guarantee.
 */

export { PERIODS } from './saleService.js';

import * as saleService from './saleService.js';
import * as inventoryManagementService from './inventoryManagementService.js';
import * as notificationService from './notificationService.js';

/**
 * Fetches the FULL picture (financial + operational figures) regardless of
 * caller role -- role-based shaping happens ONLY in `serializeSummary`
 * below, never here. Keeping the fetch role-agnostic means there is exactly
 * one code path that computes these numbers (no "STAFF query" vs "ADMIN
 * query" duplication to keep in sync), and exactly one place
 * (`serializeSummary`) that decides what a STAFF caller is allowed to see --
 * easier to audit/verify than if the omission were scattered across
 * multiple query variants.
 */
export async function getSummaryData(db, { period, branchId, restrictBranchIds }) {
  const { revenue, orderCount, aov } = await saleService.getCurrentPeriodSummary(db, {
    period,
    branchId,
    restrictBranchIds,
  });
  const lowStockCount = await inventoryManagementService.getLowStockCount(db, {
    branchId,
    staffBranchIds: restrictBranchIds,
  });
  const unresolvedNotificationCount = await notificationService.getUnresolvedCount(db, {
    branchId,
    staffBranchIds: restrictBranchIds,
  });

  return { revenue, orderCount, aov, lowStockCount, unresolvedNotificationCount };
}

/**
 * Role-aware response SHAPE -- the actual access-control enforcement this
 * task calls for ("the response shape itself should omit financial fields
 * for a STAFF caller, not just a smaller number"). A STAFF caller's returned
 * object structurally has no `revenue`/`aov` KEYS at all (not `null`, not
 * `0`, not omitted-but-documented) -- `JSON.stringify`/`res.json()` never
 * serializes a property this function never assigned. `orderCount` is
 * intentionally included for STAFF (an operational figure -- "how many
 * orders came in" is not itself a money figure) alongside
 * `lowStockCount`/`unresolvedNotificationCount`.
 * @param {{revenue:number, orderCount:number, aov:number, lowStockCount:number, unresolvedNotificationCount:number}} data
 * @param {{role: 'ADMIN'|'STAFF'}} caller
 */
export function serializeSummary(data, { role }) {
  const operational = {
    orderCount: data.orderCount,
    lowStockCount: data.lowStockCount,
    unresolvedNotificationCount: data.unresolvedNotificationCount,
  };
  if (role === 'STAFF') return operational;
  return { ...operational, revenue: data.revenue, aov: data.aov };
}

/**
 * ADMIN-only cross-branch view (enforced at the ROUTER level, same
 * composition style `routes/v1/index.js` already uses for
 * `resolveNotification`/`staffManagement` -- see `routes/dashboard.js`).
 * Thin pass-through to `saleService.getBranchBreakdown` -- no
 * dashboard-specific transformation needed, every branch's revenue/orders/
 * AOV is already financial-by-definition for an admin-only endpoint (no
 * STAFF shape to reconcile here, unlike `getSummaryData`/`serializeSummary`
 * above).
 */
export async function getByBranchData(db, { period }) {
  return saleService.getBranchBreakdown(db, { period });
}
