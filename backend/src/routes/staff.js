/**
 * Staff & workforce APIs. Validate input, call services, return response. No business logic.
 */

import * as staffService from '../services/staffService.js';
import * as workforceInsightService from '../services/workforceInsightService.js';

/**
 * GET /api/v1/staff — store-wise staff. RBAC: STAFF sees only assigned stores.
 */
export function getStaff(req, res) {
  let data = staffService.getStaffSnapshot();
  if (req.user && req.user.role === 'STAFF' && req.user.storeIds?.length) {
    const idSet = new Set(req.user.storeIds);
    data = data.filter((row) => idSet.has(row.storeId));
  }
  res.json({ data, meta: { count: data.length } });
}

/**
 * GET /api/v1/workforce-insights — RBAC: STAFF sees only insights for assigned stores.
 */
export function getWorkforceInsights(req, res) {
  let data = workforceInsightService.getWorkforceInsights();
  if (req.user && req.user.role === 'STAFF' && req.user.storeIds?.length) {
    const idSet = new Set(req.user.storeIds);
    data = data.filter((i) => idSet.has(i.storeId));
  }
  res.json({ data, meta: { count: data.length } });
}
