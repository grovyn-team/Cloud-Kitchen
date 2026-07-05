/**
 * Aggregator Insight — rule-based detection of commission problems. No AI/LLM; templates only.
 * Produces insights for finance and future AI modules. Deterministic.
 */

import * as commissionService from './commissionService.js';

// --- Insight rule thresholds ---
const COMMISSION_IMPACT_INCREASE_THRESHOLD_PERCENT = 3;
const UNDERPERFORMING_COMMISSION_LIMIT_PERCENT = 20;
const UNDERPERFORMING_VOLUME_THRESHOLD = 500;
const UNDERPERFORMING_LOW_REVENUE_THRESHOLD = 50000;

/**
 * @typedef {Object} AggregatorInsight
 * @property {string} type
 * @property {string} aggregatorId
 * @property {string} message
 * @property {'info'|'warning'|'critical'} severity
 * @property {string} evaluatedAt
 */

/** @type {AggregatorInsight[]} */
let insights = [];

/** Deterministic evaluation timestamp (from reference date in data) */
let evaluatedAt = '';

function emitInsight(insight) {
  console.log('[AGGREGATOR_INSIGHT]', JSON.stringify(insight));
}

/**
 * Get reference date (max order date) for "this week" and evaluatedAt.
 * @param {import('./commissionService.js').OrderWithCommission[]} orders
 * @returns {string} YYYY-MM-DD
 */
function getReferenceDateKey(orders) {
  if (orders.length === 0) return new Date().toISOString().slice(0, 10);
  let max = orders[0].createdAt.slice(0, 10);
  for (const o of orders) {
    const key = o.createdAt.slice(0, 10);
    if (key > max) max = key;
  }
  return max;
}

/**
 * Run insight rules for one aggregator. Only AGGREGATOR_* ids (not DIRECT).
 */
function evaluateAggregator(aggregatorId, summary, thisWeekOrders, baselinePercent, refDateKey) {
  const list = [];
  const ts = evaluatedAt;

  // Rule: Commission Impact Increased — this week's commission % > baseline + threshold
  const weekGross = thisWeekOrders.reduce((s, o) => s + o.totalAmount, 0);
  const weekCommission = thisWeekOrders.reduce((s, o) => s + o.commissionAmount, 0);
  const thisWeekPercent = weekGross > 0 ? (weekCommission / weekGross) * 100 : 0;
  const baseline = baselinePercent[aggregatorId] ?? 0;
  if (thisWeekPercent > baseline + COMMISSION_IMPACT_INCREASE_THRESHOLD_PERCENT) {
    const insight = {
      type: 'COMMISSION_IMPACT_INCREASED',
      aggregatorId,
      message: `This week's commission (${thisWeekPercent.toFixed(1)}%) is above baseline (${baseline.toFixed(1)}%) by more than ${COMMISSION_IMPACT_INCREASE_THRESHOLD_PERCENT}%.`,
      severity: 'warning',
      evaluatedAt: ts,
    };
    list.push(insight);
    emitInsight(insight);
  }

  // Rule: Aggregator Underperforming — high volume + low net revenue, or commission % exceeds limit
  const highVolumeLowRevenue =
    summary.totalOrders >= UNDERPERFORMING_VOLUME_THRESHOLD &&
    summary.netRevenue < UNDERPERFORMING_LOW_REVENUE_THRESHOLD;
  const commissionExceedsLimit = summary.averageCommissionPercent > UNDERPERFORMING_COMMISSION_LIMIT_PERCENT;
  if (highVolumeLowRevenue || commissionExceedsLimit) {
    const reason = highVolumeLowRevenue
      ? `High order volume (${summary.totalOrders}) but low net revenue (${summary.netRevenue})`
      : `Commission % (${summary.averageCommissionPercent.toFixed(1)}%) exceeds limit (${UNDERPERFORMING_COMMISSION_LIMIT_PERCENT}%)`;
    const insight = {
      type: 'AGGREGATOR_UNDERPERFORMING',
      aggregatorId,
      message: reason,
      severity: highVolumeLowRevenue && commissionExceedsLimit ? 'critical' : 'warning',
      evaluatedAt: ts,
    };
    list.push(insight);
    emitInsight(insight);
  }

  return list;
}

/**
 * Initialize aggregator insight service: run rules, cache insights, log each.
 * Must be called after initCommissionService.
 */
export function initAggregatorInsightService() {
  const orders = commissionService.getOrdersWithCommission();
  const refDateKey = getReferenceDateKey(orders);
  evaluatedAt = new Date(refDateKey + 'T12:00:00.000Z').toISOString();

  const summaries = commissionService.getAggregatorSummaries();
  const baselinePercent = commissionService.getBaselineCommissionPercentByAggregator();
  const thisWeekOrders = commissionService.getOrdersThisWeek(refDateKey);

  insights = [];
  for (const summary of summaries) {
    if (summary.aggregatorId === 'DIRECT') continue;
    const thisWeekForAgg = thisWeekOrders.filter((o) => o.aggregatorId === summary.aggregatorId);
    const list = evaluateAggregator(
      summary.aggregatorId,
      summary,
      thisWeekForAgg,
      baselinePercent,
      refDateKey
    );
    insights.push(...list);
  }
}

/**
 * @returns {AggregatorInsight[]}
 */
export function getAggregatorInsights() {
  return insights;
}
