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
import { getCities } from './cities.js';
import { getStores } from './stores.js';
import { getBrands } from './brands.js';
import { getSkus } from './skus.js';
import { getCustomers } from './customers.js';
import { getOrders } from './orders.js';
import { getAllStoreHealth, getStoreHealthById } from '../storeHealth.js';
import { getAggregators, getAggregatorInsights } from '../aggregators.js';
import { getInventory, getInventoryInsights } from '../inventory.js';
import { getStaff, getWorkforceInsights } from '../staff.js';
import {
  getFinanceSummary,
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
router.get(`${prefix}/customers`, ...adminOrStaff, getCustomers);
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
router.get(`${prefix}/finance/summary`, ...adminOnly, getFinanceSummary);
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

export default router;
