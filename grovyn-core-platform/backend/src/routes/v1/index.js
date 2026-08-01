/**
 * API v1 router. All internal APIs are versioned under /api/v1.
 * RBAC: `requireSession` (DB-backed, `middleware/sessionAuth.js`) derives
 * `req.tenantId`/`req.userId`/`req.userRole`/`req.branchIds` from a verified
 * session row -- never from client input. `requireRole` gates by that
 * DB-sourced role.
 *
 * Integration Task 2 (retired the legacy HMAC auth middleware,
 * `middleware/authMiddleware.js`, and every route that only existed behind
 * it): that middleware verified a stateless, HMAC-signed in-memory token
 * that only the legacy demo-login path (`P1-08`) could ever mint. Since
 * `AUTH_DEMO_MODE` defaults to disabled and every module built since P1-04
 * mints and verifies real DB-backed session tokens (a different, unrelated
 * token format), a bearer token from real `/auth/login` never validated
 * against the legacy middleware -- every route still gated by it was
 * already returning 401 for any real logged-in user, in production, since
 * the day P1-04 shipped. What follows is exactly what depended on it:
 *
 * - `GET /stores` (branch-picker mock) -- superseded by the real
 *   `GET /branches` below (Integration Task 1). Frontend rewired.
 * - `GET /customers/segments`, `GET /inventory-insights`,
 *   `GET /workforce-insights`, `GET /store-health`,
 *   `GET /stores/:id/health`, `GET /finance/stores`,
 *   `GET /finance-insights` -- genuinely still called by 4 frontend pages
 *   (`Stores.tsx`, `StoreDetail.tsx`, `Operations.tsx`'s Insights tab,
 *   `RepeatEngine.tsx`'s AI Segments tab), all silently broken (401) under
 *   real auth already. `Stores.tsx` is replaced by the real Branch
 *   management page; `StoreDetail.tsx` is removed (no real per-branch
 *   health/insight data source exists or is planned); the Insights/Segments
 *   tabs are removed from Operations/RepeatEngine (seed-data AI garnish,
 *   never wired to real tenant data, consistent with CLAUDE.md's "AI is
 *   optional garnish, never a critical path").
 * - `GET /cities`, `GET /brands`, `GET /skus`, `GET /orders`,
 *   `GET /inventory`, `GET /staff` (legacy workforce snapshot),
 *   `GET /aggregators`, `GET /aggregator-insights`, `GET /finance/brands`,
 *   `GET /finance/skus`, `GET /autopilot/*`, `GET /metrics`, `GET /insights`,
 *   `GET /actions`, `GET /dashboard` (legacy), `GET /simulate`,
 *   `GET /expansion/simulate`, `GET /skus/margin-analysis` -- no live
 *   frontend caller found (grepped `frontend/src` for every one of these
 *   `apiPaths` keys before removing any of them). Dead under real auth,
 *   confirmed dead in the frontend too.
 * - The demo/seed login itself (`POST /auth/demo-login`,
 *   `GET /auth/demo-stores`) is gone -- it was the ONLY thing that could
 *   ever mint a token the legacy middleware accepted, so removing one
 *   without the other would have left dead code with no possible caller.
 *   `backend/tests/system.test.js` authenticated exclusively via demo-login
 *   to smoke-test this entire legacy surface DB-free -- it lost that path
 *   as a direct, unavoidable consequence and has been reduced to a minimal
 *   boot/health check; real endpoint coverage lives in the `*.pgtest.mjs`
 *   suites (each requires a real Postgres container, same as they always
 *   have).
 *
 * The underlying route/handler files (`routes/v1/cities.js`,
 * `routes/v1/stores.js`, `routes/storeHealth.js`, `routes/inventory.js`,
 * `routes/staff.js`, `routes/aggregators.js`, `routes/finance.js`,
 * `routes/autopilot.js`, `routes/intelligence.js`, etc.) and their seeded
 * in-memory service/engine dependencies are left in place, unmounted --
 * `demoLogin` was their only other consumer and is also gone, but deleting
 * files outright was judged out of scope for this pass (no compile-time
 * reference remains to any of them from this file).
 */

import { Router } from 'express';
import { requireSession, requireRole as requireSessionRole } from '../../middleware/sessionAuth.js';
import { csvUpload, handleUploadError } from '../../middleware/csvUpload.js';
import { inventoryUpload, handleInventoryUploadError } from '../../middleware/inventoryUpload.js';
import { pool } from '../../db/pool.js';
import { getHealth } from '../health.js';
import { login, refresh, logout, me } from '../auth.js';
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
import { getSummary as getTaxSummary, getExport as getTaxExport, createRate as createTaxRate } from '../tax.js';
import { getExpansionPlan as getRealExpansionPlan } from '../expansion.js';
import {
  createBranch,
  updateBranch,
  deleteBranch,
  listBranches,
  getBranch,
} from '../branches.js';
import { createAlias as createInventoryAlias } from '../inventoryAliases.js';
import { config } from '../../config/index.js';

const router = Router();
const prefix = config.api.prefix;

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

// Branches (P1-06 backend, Integration Task 1) -- real DB-backed module,
// same requireSession/requireRole(sessionAuth.js) model as every other real
// module below. Write operations (create/update/delete) are ADMIN-only;
// list/detail allow ADMIN (sees every tenant branch) or STAFF (scoped to
// their active `staff_branch_access` grants). Supersedes the legacy
// `GET /stores` mock -- see this file's top doc comment.
const branchReadAuth = [requireSession(pool), requireSessionRole(['ADMIN', 'STAFF'])];
const branchWriteAuth = [requireSession(pool), requireSessionRole(['ADMIN'])];
router.post(`${prefix}/branches`, ...branchWriteAuth, createBranch(pool));
router.get(`${prefix}/branches`, ...branchReadAuth, listBranches(pool));
router.get(`${prefix}/branches/:id`, ...branchReadAuth, getBranch(pool));
router.patch(`${prefix}/branches/:id`, ...branchWriteAuth, updateBranch(pool));
router.delete(`${prefix}/branches/:id`, ...branchWriteAuth, deleteBranch(pool));

// Sales (P2-02/P2-03) -- real DB-backed session model (requireSession/
// requireRole from sessionAuth.js). Branch scope is enforced inside each
// handler (branchId arrives via body/query, not a route :param) -- see
// isBranchAllowed() in sessionAuth.js, used by every handler in
// routes/sales.js. /sales/import and /sales/rollup are registered BEFORE
// /sales/:id so Express doesn't match "import"/"rollup" as an :id param.
const salesAuth = [requireSession(pool), requireSessionRole(['ADMIN', 'STAFF'])];
router.post(`${prefix}/sales`, ...salesAuth, createSale(pool));
router.post(`${prefix}/sales/import`, ...salesAuth, csvUpload.single('file'), handleUploadError, importSales(pool));
router.get(`${prefix}/sales/rollup`, ...salesAuth, getRollup(pool));
router.get(`${prefix}/sales`, ...salesAuth, listSales(pool));
router.get(`${prefix}/sales/:id`, ...salesAuth, getSale(pool));

// Inventory (P2-05 backend, 2026-07-30) -- real DB-backed module, same
// requireSession/requireRole(sessionAuth.js) model as Sales. Branch scope
// enforced inside each handler (branchId arrives via body/query, not a
// route :param) via isBranchAllowed(), same as Sales. Mounted under
// /inventory/items, /inventory/import, /inventory/requests.
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

// Inventory item aliases (Integration Task 1, round 3) -- ADMIN-only create,
// so a failed CSV import (unmatched item name) is one click from working.
const inventoryAliasAuth = [requireSession(pool), requireSessionRole(['ADMIN'])];
router.post(`${prefix}/inventory/aliases`, ...inventoryAliasAuth, createInventoryAlias(pool));

// Customers (P3 backend, 2026-07-30) -- real DB-backed module, same
// requireSession/requireRole(sessionAuth.js) model as Sales/Inventory.
// Branch scope enforced inside each handler (branchId arrives via
// body/query, not a route :param) via isBranchAllowed(), same as
// Sales/Inventory.
const customersAuth = [requireSession(pool), requireSessionRole(['ADMIN', 'STAFF'])];
router.post(`${prefix}/customers`, ...customersAuth, createCustomer(pool));
router.patch(`${prefix}/customers/:id`, ...customersAuth, updateCustomer(pool));
router.delete(`${prefix}/customers/:id`, ...customersAuth, deleteCustomer(pool));
router.get(`${prefix}/customers`, ...customersAuth, listCustomers(pool));
router.get(`${prefix}/customers/:id`, ...customersAuth, getCustomer(pool));

// Staff management (P3 backend, 2026-07-30) -- real DB-backed module,
// ADMIN-ONLY (requireSession/requireRole(['ADMIN']) from sessionAuth.js).
// Mounted under `/staff/accounts` (not the brief's literal `/staff`, which
// was the legacy workforce-snapshot mock -- now unmounted and dead, see this
// file's top doc comment, so this naming split is now historical but left
// as-is to avoid an unnecessary churn rename).
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
// the `notification` table. Same requireSession/requireRole(sessionAuth.js)
// model as every other real module. Branch scope enforced inside each
// handler (branchId arrives via query, not a route :param) via
// isBranchAllowed(). Resolve is ADMIN-only ("staff can mark read but
// resolution is an admin action").
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
// DB-backed module, same requireSession/requireRole(sessionAuth.js) model.
// `/dashboard/summary` is reachable by ADMIN or STAFF (the handler itself
// shapes the response per-role); `/dashboard/by-branch` is ADMIN-only.
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
// sessionAuth.js).
const financeMgmtAuth = [requireSession(pool), requireSessionRole(['ADMIN'])];
router.get(`${prefix}/finance/summary`, ...financeMgmtAuth, getRealFinanceSummary(pool));

// Tax / GST module (Phase 6 backend, 2026-07-31) -- real DB-backed,
// ADMIN-ONLY (requireSession/requireRole(['ADMIN']) from sessionAuth.js,
// same auth model as Finance -- D-007's CA-in-the-loop positioning treats
// this as financial/compliance data, not a STAFF-facing feature).
const taxAuth = [requireSession(pool), requireSessionRole(['ADMIN'])];
router.get(`${prefix}/tax/summary`, ...taxAuth, getTaxSummary(pool));
router.get(`${prefix}/tax/export`, ...taxAuth, getTaxExport(pool));
router.post(`${prefix}/tax/rates`, ...taxAuth, createTaxRate(pool));

// Expansion planning (P35-01/P35-02 backend, 2026-07-30) -- real DB-backed,
// deterministic (NO AI/HF calls anywhere in this path), ADMIN-ONLY
// (requireSession/requireRole(['ADMIN']) from sessionAuth.js).
const expansionAuth = [requireSession(pool), requireSessionRole(['ADMIN'])];
router.get(`${prefix}/expansion/plan`, ...expansionAuth, getRealExpansionPlan(pool));

export default router;
