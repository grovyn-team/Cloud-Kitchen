/**
 * Aggregator APIs. Validate input, call services, return response. No business logic.
 */

import * as commissionService from '../services/commissionService.js';
import * as aggregatorInsightService from '../services/aggregatorInsightService.js';

/**
 * GET /api/v1/aggregators — per-aggregator summary, commission totals, net revenue impact
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function getAggregators(req, res) {
  const data = commissionService.getAggregatorSummaries();
  res.json({ data, meta: { count: data.length } });
}

/**
 * GET /api/v1/aggregator-insights — all active commission-related insights
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function getAggregatorInsights(req, res) {
  const data = aggregatorInsightService.getAggregatorInsights();
  res.json({ data, meta: { count: data.length } });
}
