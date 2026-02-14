/**
 * API v1 router. All internal APIs are versioned under /api/v1.
 */

import { Router } from 'express';
import { getHealth } from '../health.js';
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
import { config } from '../../config/index.js';

const router = Router();
const prefix = config.api.prefix;

// Health is part of the versioned API contract
router.get(`${prefix}/health`, getHealth);
router.get(`${prefix}/cities`, getCities);
router.get(`${prefix}/stores`, getStores);
router.get(`${prefix}/brands`, getBrands);
router.get(`${prefix}/skus`, getSkus);
router.get(`${prefix}/customers`, getCustomers);
router.get(`${prefix}/orders`, getOrders);

// Store operational health (Milestone 2)
router.get(`${prefix}/store-health`, getAllStoreHealth);
router.get(`${prefix}/stores/:id/health`, getStoreHealthById);

// Aggregator & commission (Milestone 3)
router.get(`${prefix}/aggregators`, getAggregators);
router.get(`${prefix}/aggregator-insights`, getAggregatorInsights);

// Inventory & supply chain (Milestone 4)
router.get(`${prefix}/inventory`, getInventory);
router.get(`${prefix}/inventory-insights`, getInventoryInsights);

// Staff & workforce (Milestone 5)
router.get(`${prefix}/staff`, getStaff);
router.get(`${prefix}/workforce-insights`, getWorkforceInsights);

// Finance & profitability (Milestone 6)
router.get(`${prefix}/finance/summary`, getFinanceSummary);
router.get(`${prefix}/finance/stores`, getStoreProfitability);
router.get(`${prefix}/finance/brands`, getBrandProfitability);
router.get(`${prefix}/finance/skus`, getSkuMargins);
router.get(`${prefix}/finance-insights`, getFinanceInsights);

// AI Autopilot & executive control (Milestone 8)
router.get(`${prefix}/autopilot/status`, getAutopilotStatus);
router.get(`${prefix}/autopilot/executive-brief`, getExecutiveBrief);
router.get(`${prefix}/autopilot/alerts`, getAlerts);

export default router;
