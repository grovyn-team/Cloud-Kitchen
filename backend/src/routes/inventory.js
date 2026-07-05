/**
 * Inventory APIs. Validate input, call services, return response. No business logic.
 */

import * as inventoryService from '../services/inventoryService.js';
import * as inventoryInsightService from '../services/inventoryInsightService.js';

/**
 * GET /api/v1/inventory — store-wise inventory. RBAC: STAFF sees only assigned stores.
 */
export function getInventory(req, res) {
  let data = inventoryService.getInventorySnapshot();
  if (req.user && req.user.role === 'STAFF' && req.user.storeIds?.length) {
    const idSet = new Set(req.user.storeIds);
    data = data.filter((row) => idSet.has(row.storeId));
  }
  res.json({ data, meta: { count: data.length } });
}

/**
 * GET /api/v1/inventory-insights — RBAC: STAFF sees only insights for assigned stores.
 */
export function getInventoryInsights(req, res) {
  let data = inventoryInsightService.getInventoryInsights();
  if (req.user && req.user.role === 'STAFF' && req.user.storeIds?.length) {
    const idSet = new Set(req.user.storeIds);
    data = data.filter((i) => idSet.has(i.storeId));
  }
  res.json({ data, meta: { count: data.length } });
}
