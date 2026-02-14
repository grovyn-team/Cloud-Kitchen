/**
 * Finance APIs. Validate input, call services, return JSON. No business logic.
 */

import * as profitEngine from '../services/profitEngine.js';
import * as financeInsightService from '../services/financeInsightService.js';
import * as storeService from '../services/storeService.js';

/**
 * GET /api/v1/finance/summary
 */
export function getFinanceSummary(req, res) {
  const data = profitEngine.getFinanceSummary();
  res.json(data ?? {});
}

/**
 * GET /api/v1/finance/stores
 */
export function getStoreProfitability(req, res) {
  const rows = profitEngine.getStoreProfitability();
  const data = rows.map((r) => {
    const store = storeService.getStoreById(r.storeId);
    return { ...r, storeName: store?.name ?? r.storeId };
  });
  res.json({ data, meta: { count: data.length } });
}

/**
 * GET /api/v1/finance/brands
 */
export function getBrandProfitability(req, res) {
  const data = profitEngine.getBrandProfitability();
  res.json({ data, meta: { count: data.length } });
}

/**
 * GET /api/v1/finance/skus
 */
export function getSkuMargins(req, res) {
  const data = profitEngine.getSkuMargins();
  res.json({ data, meta: { count: data.length } });
}

/**
 * GET /api/v1/finance-insights
 */
export function getFinanceInsights(req, res) {
  const data = financeInsightService.getFinanceInsights();
  res.json({ data, meta: { count: data.length } });
}
