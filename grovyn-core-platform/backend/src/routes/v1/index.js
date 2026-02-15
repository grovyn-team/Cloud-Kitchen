/**
 * API v1 router. All internal APIs are versioned under /api/v1.
 * RBAC: authOptional runs first; protected routes use requireAuth + requireRole.
 */

import { Router } from 'express';
import { authOptional, requireAuth, requireRole, requireStoreAccess } from '../../middleware/authMiddleware.js';
import { getHealth } from '../health.js';
import { login, getStoreOptions } from '../auth.js';
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
router.get(`${prefix}/auth/stores`, getStoreOptions);
router.post(`${prefix}/auth/login`, login);

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
