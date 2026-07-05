/**
 * Commission Engine — real commission impact at order level and per-aggregator.
 * Defines economic truth for margin and finance. Deterministic; all rates are constants.
 */

import * as orderIngestionService from './orderIngestionService.js';

// --- Commission rates per aggregator (constants; change here for tuning) ---
const AGGREGATOR_COMMISSION_RATES = {
  AGGREGATOR_A: 0.15,
  AGGREGATOR_B: 0.18,
};

/** Logged once at init so operators know what is in effect */
function logCommissionRates() {
  console.log('Commission rates (active):', AGGREGATOR_COMMISSION_RATES);
}

/**
 * @typedef {import('./orderIngestionService.js').NormalizedOrder & { commissionAmount: number }} OrderWithCommission
 */

/** @type {OrderWithCommission[]} */
let ordersWithCommission = [];

/**
 * @typedef {Object} AggregatorSummary
 * @property {string} aggregatorId
 * @property {number} totalOrders
 * @property {number} totalGrossRevenue
 * @property {number} totalCommissionPaid
 * @property {number} averageCommissionPercent
 * @property {number} netRevenue
 */

/** @type {AggregatorSummary[]} */
let aggregatorSummaries = [];

/**
 * Compute commission for one order. DIRECT => 0; AGGREGATOR => totalAmount * rate.
 * @param {import('./orderIngestionService.js').NormalizedOrder} order
 * @returns {number}
 */
function computeOrderCommission(order) {
  if (order.channel === 'DIRECT') return 0;
  const rate = AGGREGATOR_COMMISSION_RATES[order.aggregatorId];
  if (rate == null) return 0;
  return Number((order.totalAmount * rate).toFixed(2));
}

/**
 * Build orders with commission and aggregate per-aggregator. Deterministic, cached.
 */
function runAggregation() {
  const normalized = orderIngestionService.getNormalizedOrders();
  ordersWithCommission = normalized.map((o) => ({
    ...o,
    commissionAmount: computeOrderCommission(o),
  }));

  const byAggregator = new Map();
  for (const o of ordersWithCommission) {
    const key = o.aggregatorId ?? 'DIRECT';
    if (!byAggregator.has(key)) {
      byAggregator.set(key, { orders: 0, gross: 0, commission: 0 });
    }
    const agg = byAggregator.get(key);
    agg.orders += 1;
    agg.gross += o.totalAmount;
    agg.commission += o.commissionAmount;
  }

  aggregatorSummaries = [];
  for (const [aggregatorId, agg] of byAggregator) {
    const totalOrders = agg.orders;
    const totalGrossRevenue = Number(agg.gross.toFixed(2));
    const totalCommissionPaid = Number(agg.commission.toFixed(2));
    const averageCommissionPercent =
      totalGrossRevenue > 0 ? Number(((totalCommissionPaid / totalGrossRevenue) * 100).toFixed(2)) : 0;
    const netRevenue = Number((totalGrossRevenue - totalCommissionPaid).toFixed(2));
    aggregatorSummaries.push({
      aggregatorId,
      totalOrders,
      totalGrossRevenue,
      totalCommissionPaid,
      averageCommissionPercent,
      netRevenue,
    });
  }
}

/**
 * Initialize commission service: enrich normalized orders and compute aggregator summaries.
 * Must be called after initOrderIngestionService.
 */
export function initCommissionService() {
  logCommissionRates();
  runAggregation();
}

/**
 * @returns {OrderWithCommission[]}
 */
export function getOrdersWithCommission() {
  return ordersWithCommission;
}

/**
 * @returns {AggregatorSummary[]}
 */
export function getAggregatorSummaries() {
  return aggregatorSummaries;
}

/**
 * Get baseline (all-time) average commission % per aggregator for insight rules.
 * @returns {Record<string, number>}
 */
export function getBaselineCommissionPercentByAggregator() {
  const out = {};
  for (const s of aggregatorSummaries) {
    out[s.aggregatorId] = s.averageCommissionPercent;
  }
  return out;
}

/**
 * Get total gross and total commission for a subset of orders (e.g. this week). For insights.
 * @param {OrderWithCommission[]} orders
 * @returns {{ totalGross: number, totalCommission: number, commissionPercent: number }}
 */
export function getTotalsForOrders(orders) {
  let totalGross = 0;
  let totalCommission = 0;
  for (const o of orders) {
    totalGross += o.totalAmount;
    totalCommission += o.commissionAmount;
  }
  const commissionPercent = totalGross > 0 ? (totalCommission / totalGross) * 100 : 0;
  return { totalGross, totalCommission, commissionPercent };
}

/**
 * Get orders filtered by a date range (inclusive day). Date key = YYYY-MM-DD from createdAt.
 * @param {string} fromDateKey
 * @param {string} toDateKey
 * @returns {OrderWithCommission[]}
 */
export function getOrdersInDateRange(fromDateKey, toDateKey) {
  return ordersWithCommission.filter((o) => {
    const key = o.createdAt.slice(0, 10);
    return key >= fromDateKey && key <= toDateKey;
  });
}

/**
 * Get orders in "this week" (week of reference date). ISO week: Monday = start.
 * @param {string} referenceDateKey YYYY-MM-DD
 * @returns {OrderWithCommission[]}
 */
export function getOrdersThisWeek(referenceDateKey) {
  const d = new Date(referenceDateKey + 'T12:00:00.000Z');
  const day = d.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + mondayOffset);
  const monday = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 6);
  const sunday = d.toISOString().slice(0, 10);
  return getOrdersInDateRange(monday, sunday);
}
