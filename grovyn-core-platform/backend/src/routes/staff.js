/**
 * Staff & workforce APIs. Validate input, call services, return response. No business logic.
 */

import * as staffService from '../services/staffService.js';
import * as workforceInsightService from '../services/workforceInsightService.js';

/**
 * GET /api/v1/staff — store-wise staff list, roles, experience levels
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function getStaff(req, res) {
  const data = staffService.getStaffSnapshot();
  res.json({ data, meta: { count: data.length } });
}

/**
 * GET /api/v1/workforce-insights — all active workforce-related insights
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function getWorkforceInsights(req, res) {
  const data = workforceInsightService.getWorkforceInsights();
  res.json({ data, meta: { count: data.length } });
}
