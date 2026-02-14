/**
 * Inventory APIs. Validate input, call services, return response. No business logic.
 */

import * as inventoryService from '../services/inventoryService.js';
import * as inventoryInsightService from '../services/inventoryInsightService.js';

/**
 * GET /api/v1/inventory — store-wise inventory, ingredient stock, days remaining
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function getInventory(req, res) {
  const data = inventoryService.getInventorySnapshot();
  res.json({ data, meta: { count: data.length } });
}

/**
 * GET /api/v1/inventory-insights — all active inventory-related insights
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function getInventoryInsights(req, res) {
  const data = inventoryInsightService.getInventoryInsights();
  res.json({ data, meta: { count: data.length } });
}
