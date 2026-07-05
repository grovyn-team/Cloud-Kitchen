/**
 * Executive Brief — daily summary for leadership. Snapshot, top issues, suggested actions.
 * Rule-based; generatedAt deterministic (evaluation date 07:00 UTC). No LLM.
 */

import * as profitEngine from './profitEngine.js';
import * as storeHealthService from './storeHealthService.js';
import * as autopilotService from './autopilotService.js';
import * as commissionService from './commissionService.js';

/** @type {object|null} */
let briefCache = null;

function getEvaluationDateKey() {
  const orders = commissionService.getOrdersWithCommission();
  if (orders.length === 0) return new Date().toISOString().slice(0, 10);
  return orders.map((o) => o.createdAt.slice(0, 10)).reduce((a, b) => (a > b ? a : b), '');
}

/**
 * Map insight type to human-readable action. Rule-based.
 */
function suggestAction(insight) {
  const t = insight.type;
  if (t === 'LOW_STOCK' || t === 'STORE_HEALTH') return 'Reorder ingredient / review store ops';
  if (t === 'STAFF_SHORTAGE' || t === 'PRODUCTIVITY_RISK') return 'Add evening staff or rebalance shifts';
  if (t === 'MARGIN_LEAKAGE' || t === 'NEGATIVE_PROFIT') return 'Review pricing and discounts';
  if (t === 'DISCOUNT_MISUSE') return 'Pause discount for one-time customers';
  if (t === 'LOW_SKU_MARGIN') return 'Review SKU pricing';
  if (t === 'OVERSTAFFING') return 'Optimize shift allocation';
  if (t === 'COMMISSION_IMPACT_INCREASED' || t === 'AGGREGATOR_UNDERPERFORMING') return 'Review aggregator terms';
  if (t === 'OVERSTOCK' || t === 'WASTE_RISK') return 'Reduce order or adjust menu';
  return 'Review and act';
}

/**
 * Build one-line bullet for "what needs attention" from insight (store name when available).
 */
function toAttentionBullet(insight) {
  if (insight.storeName && insight.message) {
    return `${insight.storeName}: ${insight.message.slice(0, 80)}${insight.message.length > 80 ? '…' : ''}`;
  }
  if (insight.storeId) return `Store ${insight.storeId}: ${insight.message.slice(0, 70)}…`;
  return insight.message;
}

/**
 * Generate executive brief. Deterministic; same restart → same brief.
 */
function generateBrief() {
  const evaluationDate = getEvaluationDateKey();
  const generatedAt = `${evaluationDate}T07:00:00.000Z`;

  const summary = profitEngine.getFinanceSummary();
  const health = storeHealthService.getHealthForAllStores();
  const storesAtRisk = health.filter((h) => h.status === 'at_risk' || h.status === 'critical').length;

  const snapshot = {
    totalGrossRevenue: summary?.totalGrossRevenue ?? 0,
    totalNetRevenue: summary?.totalNetRevenue ?? 0,
    totalProfit: summary?.totalProfit ?? 0,
    overallMarginPercent: summary?.overallMarginPercent ?? 0,
    storesAtRiskCount: storesAtRisk,
  };

  const topPriorities = autopilotService.getTopPriorities();
  const whatNeedsAttention = topPriorities.slice(0, 5).map(toAttentionBullet);
  const suggestedActions = [...new Set(topPriorities.slice(0, 5).map(suggestAction))];

  briefCache = {
    generatedAt,
    businessSnapshot: snapshot,
    whatNeedsAttentionToday: whatNeedsAttention,
    suggestedActions,
  };
  console.log('[EXECUTIVE_BRIEF_GENERATED]', JSON.stringify(briefCache));
}

/**
 * Initialize and generate brief. Call after initAutopilotService.
 */
export function initExecutiveBriefService() {
  generateBrief();
}

export function getExecutiveBrief() {
  return briefCache;
}
