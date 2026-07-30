/**
 * API v1 router. All internal APIs are versioned under /api/v1.
 * RBAC: authOptional runs first; protected routes use requireAuth + requireRole.
 */

import { Router } from 'express';
import { authOptional, requireAuth, requireRole, requireStoreAccess } from '../../middleware/authMiddleware.js';
import { requireSession, requireRole as requireSessionRole } from '../../middleware/sessionAuth.js';
import { csvUpload, handleUploadError } from '../../middleware/csvUpload.js';
import { inventoryUpload, handleInventoryUploadError } from '../../middleware/inventoryUpload.js';
import { pool } from '../../db/pool.js';
import { getHealth } from '../health.js';
import { login, refresh, logout, me, demoLogin, getDemoStoreOptions } from '../auth.js';
import { createSale, importSales, getRollup, listSales, getSale } from '../sales.js';
import {
  createItem as createInventoryItem,
  updateItem as updateInventoryItem,
  importItems as importInventoryItems,
  createRequest as createInventoryRequest,
  listItems as listInventoryItems,
  getItem as getInventoryItem,
} from '../inventoryManagement.js';
import {
  createCustomer,
  updateCustomer,
  deleteCustomer,
  listCustomers,
  getCustomer,
} from '../customers.js';
import {
  createStaff,
  listStaff,
  getStaffDetail,
  updateStaff,
  deactivateStaff,
  grantStaffBranchAccess,
  revokeStaffBranchAccess,
} from '../staffManagement.js';
import {
  listNotifications,
  unreadCount as getUnreadNotificationCount,
  markRead as markNotificationRead,
  resolveNotification,
} from '../notifications.js';
import { getSummary as getDashboardSummary, getByBranch as getDashboardByBranch } from '../dashboard.js';
import { getSummary as getRealFinanceSummary } from '../financeManagement.js';
import { getSummary as getTaxSummary, getExport as getTaxExport } from '../tax.js';
import { getExpansionPlan as getRealExpansionPlan } from '../expansion.js';
import { getCities } from './cities.js';
import { getStores } from './stores.js';
import { getBrands } from './brands.js';
import { getSkus } from './skus.js';
import { getOrders } from './orders.js';
import { getAllStoreHealth, getStoreHealthById } from '../storeHealth.js';
import { getAggregators, getAggregatorInsights } from '../aggregators.js';
import { getInventory, getInventoryInsights } from '../inventory.js';
import { getStaff, getWorkforceInsights } from '../staff.js';
import {
  getStoreProfitability,
  getBrandProfitability,
  getSkuMargins,
  getFinanceInsights,
} from '../finance.js';
import {
  getAutopilotStatus,
  getExecutiveBrief,
  getAlerts,
} from '../autopilot.js';
import {
  getMetrics,
  getInsights,
  getActions,
  getDashboard,
  getSimulate,
  getExpansionSimulate,
  getCustomerSegments,
  getSkusMarginAnalysis,
} from '../intelligence.js';
import { config } from '../../config/index.js';

const router = Router();
const prefix = config.api.prefix;
const adminOnly = [authOptional, requireAuth, requireRole(['ADMIN'])];
const adminOrStaff = [authOptional, requireAuth, requireRole(['ADMIN', 'STAFF'])];

// Public (no auth)
router.get(`${prefix}/health`, getHealth);
// OPTIONS preflight for CORS from https://autopilot.grovyn.in
router.options(`${prefix}/auth/login`, (_req, res) => res.sendStatus(200));

// Real auth (P1-04) -- login is pre-context by construction (see
// ../auth.js); refresh/logout/me require a verified session first, then
// compose with the ordinary withTenantContext(pool) pattern.
router.post(`${prefix}/auth/login`, login(pool));
router.post(`${prefix}/auth/refresh`, requireSession(pool), refresh(pool));
router.post(`${prefix}/auth/logout`, requireSession(pool), logout(pool));
router.get(`${prefix}/auth/me`, requireSession(pool), me(pool));

// Demo/seed login (P1-08) -- mounted ONLY when AUTH_DEMO_MODE=true (default
// false). When disabled these routes do not exist at all (404), not merely
// return a denial -- "genuinely unreachable", not "off by convention".
if (config.auth.demoModeEnabled) {
  router.get(`${prefix}/auth/demo-stores`, getDemoStoreOptions);
  router.post(`${prefix}/auth/demo-login`, demoLogin);
}

// Core data + store health + inventory + staff + alerts (ADMIN or STAFF; STAFF filtered in handlers)
router.get(`${prefix}/cities`, ...adminOrStaff, getCities);
router.get(`${prefix}/stores`, ...adminOrStaff, getStores);
router.get(`${prefix}/brands`, ...adminOrStaff, getBrands);
router.get(`${prefix}/skus`, ...adminOrStaff, getSkus);
router.get(`${prefix}/orders`, ...adminOrStaff, getOrders);
router.get(`${prefix}/store-health`, ...adminOrStaff, getAllStoreHealth);
router.get(`${prefix}/stores/:id/health`, ...adminOrStaff, requireStoreAccess('id'), getStoreHealthById);
router.get(`${prefix}/inventory`, ...adminOrStaff, getInventory);
router.get(`${prefix}/inventory-insights`, ...adminOrStaff, getInventoryInsights);
router.get(`${prefix}/staff`, ...adminOrStaff, getStaff);
router.get(`${prefix}/workforce-insights`, ...adminOrStaff, getWorkforceInsights);
router.get(`${prefix}/autopilot/alerts`, ...adminOrStaff, getAlerts);

// Sales (P2-02/P2-03) -- real DB-backed session model (requireSession/
// requireRole from sessionAuth.js), NOT the legacy authMiddleware.js HMAC
// scheme the routes above still use (P1-05/P1-07 own migrating those).
// Branch scope is enforced inside each handler (branchId arrives via
// body/query, not a route :param, so requireBranchAccess's param-based
// check doesn't apply directly) -- see isBranchAllowed() in sessionAuth.js,
// used by every handler in routes/sales.js. /sales/import and /sales/rollup
// are registered BEFORE /sales/:id so Express doesn't match "import"/
// "rollup" as an :id param.
const salesAuth = [requireSession(pool), requireSessionRole(['ADMIN', 'STAFF'])];
router.post(`${prefix}/sales`, ...salesAuth, createSale(pool));
router.post(`${prefix}/sales/import`, ...salesAuth, csvUpload.single('file'), handleUploadError, importSales(pool));
router.get(`${prefix}/sales/rollup`, ...salesAuth, getRollup(pool));
router.get(`${prefix}/sales`, ...salesAuth, listSales(pool));
router.get(`${prefix}/sales/:id`, ...salesAuth, getSale(pool));

// Inventory (P2-05 backend, 2026-07-30) -- real DB-backed module, same
// requireSession/requireRole(sessionAuth.js) model as Sales, NOT the legacy
// authMiddleware.js HMAC scheme `routes/inventory.js`'s mock endpoints still
// use. Branch scope enforced inside each handler (branchId arrives via
// body/query, not a route :param) via isBranchAllowed(), same as Sales.
// Mounted under /inventory/items, /inventory/import, /inventory/requests --
// does not collide with the legacy /inventory, /inventory-insights exact
// paths above.
const inventoryAuth = [requireSession(pool), requireSessionRole(['ADMIN', 'STAFF'])];
router.post(`${prefix}/inventory/items`, ...inventoryAuth, createInventoryItem(pool));
router.patch(`${prefix}/inventory/items/:id`, ...inventoryAuth, updateInventoryItem(pool));
router.post(
  `${prefix}/inventory/import`,
  ...inventoryAuth,
  inventoryUpload.single('file'),
  handleInventoryUploadError,
  importInventoryItems(pool)
);
router.post(`${prefix}/inventory/requests`, ...inventoryAuth, createInventoryRequest(pool));
router.get(`${prefix}/inventory/items`, ...inventoryAuth, listInventoryItems(pool));
router.get(`${prefix}/inventory/items/:id`, ...inventoryAuth, getInventoryItem(pool));

// Aggregator & commission (ADMIN only)
router.get(`${prefix}/aggregators`, ...adminOnly, getAggregators);
router.get(`${prefix}/aggregator-insights`, ...adminOnly, getAggregatorInsights);

// Finance (ADMIN only)
router.get(`${prefix}/finance/stores`, ...adminOnly, getStoreProfitability);
router.get(`${prefix}/finance/brands`, ...adminOnly, getBrandProfitability);
router.get(`${prefix}/finance/skus`, ...adminOnly, getSkuMargins);
router.get(`${prefix}/finance-insights`, ...adminOnly, getFinanceInsights);

// Autopilot status & brief (ADMIN only)
router.get(`${prefix}/autopilot/status`, ...adminOnly, getAutopilotStatus);
router.get(`${prefix}/autopilot/executive-brief`, ...adminOnly, getExecutiveBrief);

// AI Intelligence (ADMIN only)
router.get(`${prefix}/metrics`, ...adminOnly, getMetrics);
router.get(`${prefix}/insights`, ...adminOnly, getInsights);
router.get(`${prefix}/actions`, ...adminOnly, getActions);
router.get(`${prefix}/dashboard`, ...adminOnly, getDashboard);
router.get(`${prefix}/simulate`, ...adminOnly, getSimulate);
router.get(`${prefix}/expansion/simulate`, ...adminOnly, getExpansionSimulate);
router.get(`${prefix}/customers/segments`, ...adminOnly, getCustomerSegments);
router.get(`${prefix}/skus/margin-analysis`, ...adminOnly, getSkusMarginAnalysis);

// Customers (P3 backend, 2026-07-30) -- real DB-backed module, same
// requireSession/requireRole(sessionAuth.js) model as Sales/Inventory, NOT
// the legacy authMiddleware.js HMAC scheme. Branch scope enforced inside
// each handler (branchId arrives via body/query, not a route :param) via
// isBranchAllowed(), same as Sales/Inventory. Replaces the legacy in-memory
// `GET /api/v1/customers` mock (`routes/v1/customers.js`, no longer mounted
// here) -- see `routes/customers.js`'s own doc comment for why this module's
// brief reuses that exact path instead of a collision-avoiding sub-path.
// Mounted AFTER `${prefix}/customers/segments` above (registration order
// matters in Express for two GET routes under the same prefix): a request
// for `/customers/segments` must match that literal route, not fall through
// to `GET /customers/:id` matching "segments" as the id param -- same
// import-before-:id / rollup-before-:id ordering discipline
// `routes/v1/index.js` already uses for Sales/Inventory.
const customersAuth = [requireSession(pool), requireSessionRole(['ADMIN', 'STAFF'])];
router.post(`${prefix}/customers`, ...customersAuth, createCustomer(pool));
router.patch(`${prefix}/customers/:id`, ...customersAuth, updateCustomer(pool));
router.delete(`${prefix}/customers/:id`, ...customersAuth, deleteCustomer(pool));
router.get(`${prefix}/customers`, ...customersAuth, listCustomers(pool));
router.get(`${prefix}/customers/:id`, ...customersAuth, getCustomer(pool));

// Staff management (P3 backend, 2026-07-30) -- real DB-backed module,
// ADMIN-ONLY (requireSession/requireRole(['ADMIN']) from sessionAuth.js, NOT
// the legacy authMiddleware.js HMAC scheme). Mounted under
// `/staff/accounts` rather than the brief's literal `/staff` -- that exact
// path is already the legacy in-memory workforce-snapshot mock
// (`GET /api/v1/staff` above, ADMIN-or-STAFF) and IS consumed by the
// frontend (`apiPaths.staff`) -- see `routes/staffManagement.js`'s own doc
// comment for the full collision-avoidance rationale (same move
// `/inventory/items` already made for Inventory).
const staffMgmtAuth = [requireSession(pool), requireSessionRole(['ADMIN'])];
router.post(`${prefix}/staff/accounts`, ...staffMgmtAuth, createStaff(pool));
router.get(`${prefix}/staff/accounts`, ...staffMgmtAuth, listStaff(pool));
router.get(`${prefix}/staff/accounts/:id`, ...staffMgmtAuth, getStaffDetail(pool));
router.patch(`${prefix}/staff/accounts/:id`, ...staffMgmtAuth, updateStaff(pool));
router.delete(`${prefix}/staff/accounts/:id`, ...staffMgmtAuth, deactivateStaff(pool));
router.post(`${prefix}/staff/accounts/:id/branches`, ...staffMgmtAuth, grantStaffBranchAccess(pool));
router.delete(
  `${prefix}/staff/accounts/:id/branches/:branchId`,
  ...staffMgmtAuth,
  revokeStaffBranchAccess(pool)
);

// Notifications (P4 backend, 2026-07-30) -- real DB-backed READER side of
// the `notification` table (schema shipped 2026-07-29 alongside P2/P3/P3.5/
// P6). Surfaces rows the Inventory module's PRODUCER side already writes
// (low-stock trigger, staff restock request, `routes/inventoryManagement.js`)
// -- this task builds no new trigger logic. Same requireSession/requireRole
// (sessionAuth.js) model as Sales/Inventory/Customers/Staff, NOT the legacy
// authMiddleware.js HMAC scheme. Branch scope enforced inside each handler
// (branchId arrives via query, not a route :param) via isBranchAllowed(),
// same as every other module here.
// Resolve is ADMIN-only per this task's explicit split ("staff can mark
// read but resolution is an admin action", matching the module's own
// "staff -> admin request feed" framing) -- layered as an EXTRA
// requireSessionRole(['ADMIN']) on top of the shared adminOrStaff-style
// auth array, same composition style this file already uses for
// `adminOnly`/`adminOrStaff` groups. `unread-count` is mounted before the
// bare `GET /notifications` list only for readability -- Express has no
// actual ordering ambiguity here (different path-segment shapes, no :id
// param on either).
const notificationsAuth = [requireSession(pool), requireSessionRole(['ADMIN', 'STAFF'])];
router.get(`${prefix}/notifications/unread-count`, ...notificationsAuth, getUnreadNotificationCount(pool));
router.get(`${prefix}/notifications`, ...notificationsAuth, listNotifications(pool));
router.patch(`${prefix}/notifications/:id/read`, ...notificationsAuth, markNotificationRead(pool));
router.patch(
  `${prefix}/notifications/:id/resolve`,
  ...notificationsAuth,
  requireSessionRole(['ADMIN']),
  resolveNotification(pool)
);

// Dashboard aggregation (P2-03/P2-04/P2-06 backend, 2026-07-30) -- real
// DB-backed module, same requireSession/requireRole(sessionAuth.js) model as
// Sales/Inventory/Customers/Notifications, NOT the legacy authMiddleware.js
// HMAC scheme the OLD `GET /api/v1/dashboard` (AI-intelligence mock,
// `routes/intelligence.js`, still mounted above, unrelated/untouched) uses.
// No path collision: `/dashboard/summary` and `/dashboard/by-branch` are
// distinct literal path strings from the legacy exact-match `/dashboard`
// route -- Express does not treat the latter as a prefix of the former.
// `/dashboard/summary` is reachable by ADMIN or STAFF (the handler itself
// shapes the response per-role, see `routes/dashboard.js`'s doc comment);
// `/dashboard/by-branch` is ADMIN-only, enforced HERE via an extra
// `requireSessionRole(['ADMIN'])` layered on top, same composition style
// already used for `resolveNotification` above.
const dashboardAuth = [requireSession(pool), requireSessionRole(['ADMIN', 'STAFF'])];
router.get(`${prefix}/dashboard/summary`, ...dashboardAuth, getDashboardSummary(pool));
router.get(
  `${prefix}/dashboard/by-branch`,
  ...dashboardAuth,
  requireSessionRole(['ADMIN']),
  getDashboardByBranch(pool)
);

// Finance summary (P2-03/P2-06 backend, 2026-07-30) -- real DB-backed
// module, ADMIN-ONLY (requireSession/requireRole(['ADMIN']) from
// sessionAuth.js). SUPERSEDES the legacy in-memory mock previously mounted
// at this exact path (see `routes/financeManagement.js`'s own doc comment
// for the full collision-supersede rationale, same pattern P3's
// `routes/customers.js` established for `GET /api/v1/customers`) -- the
// legacy `getFinanceSummary` import/mount above was removed, not left
// shadowed (Express would only ever reach the first-registered handler for
// an identical method+path, so leaving both mounted would have silently
// stranded this new one dead code).
const financeMgmtAuth = [requireSession(pool), requireSessionRole(['ADMIN'])];
router.get(`${prefix}/finance/summary`, ...financeMgmtAuth, getRealFinanceSummary(pool));

// Tax / GST module (Phase 6 backend, 2026-07-31) -- real DB-backed,
// ADMIN-ONLY (requireSession/requireRole(['ADMIN']) from sessionAuth.js,
// same auth model as Finance -- D-007's CA-in-the-loop positioning treats
// this as financial/compliance data, not a STAFF-facing feature). Computes
// GST period summaries on-demand from `sale`/`sale_line_item` data and
// upserts an idempotent cache row into `tax_period_summary` -- see
// `routes/tax.js`'s own doc comment. `/tax/export` returns a CSV file (not
// JSON) via the new `replyRaw()` envelope in `middleware/tenantContext.js`.
const taxAuth = [requireSession(pool), requireSessionRole(['ADMIN'])];
router.get(`${prefix}/tax/summary`, ...taxAuth, getTaxSummary(pool));
router.get(`${prefix}/tax/export`, ...taxAuth, getTaxExport(pool));

// Expansion planning (P35-01/P35-02 backend, 2026-07-30) -- real DB-backed,
// deterministic (NO AI/HF calls anywhere in this path), ADMIN-ONLY
// (requireSession/requireRole(['ADMIN']) from sessionAuth.js, same auth
// model as Finance/Staff/Dashboard-by-branch). Deliberately mounted at
// `/expansion/plan`, NOT `/expansion/simulate` -- that exact path above
// (line ~177) is the pre-existing legacy mock-backed route
// (`routes/intelligence.js#getExpansionSimulate`, still on the OLD
// `authMiddleware.js` HMAC scheme, driven by in-memory
// `storeService`/`metricsEngine`/`alertOrchestratorService`) and is left
// completely untouched by this task -- see `routes/expansion.js`'s own doc
// comment for the full collision-avoidance rationale (same pattern
// `financeManagement.js`/`customers.js` established for their own
// legacy-mock siblings, except this one does NOT supersede/replace the old
// path since P35-03 (frontend) has not yet cut over).
const expansionAuth = [requireSession(pool), requireSessionRole(['ADMIN'])];
router.get(`${prefix}/expansion/plan`, ...expansionAuth, getRealExpansionPlan(pool));

export default router;
