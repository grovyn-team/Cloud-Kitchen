/**
 * Workforce Insight Service — rule-based staff shortage, overstaffing, productivity risk.
 * No AI/ML; templates only. Deterministic evaluatedAt from order data.
 */

import * as shiftService from './shiftService.js';
import * as commissionService from './commissionService.js';

const SHORTAGE_THRESHOLD = 1.1;
const SHORTAGE_CRITICAL_THRESHOLD = 1.3;
const OVERSTAFFING_THRESHOLD = 0.6;

/**
 * @typedef {Object} WorkforceInsight
 * @property {string} type
 * @property {string} storeId
 * @property {string} [role]
 * @property {string} message
 * @property {'info'|'warning'|'critical'} severity
 * @property {string} evaluatedAt
 */

/** @type {WorkforceInsight[]} */
let insights = [];

function emitInsight(insight) {
  console.log('[WORKFORCE_INSIGHT]', JSON.stringify(insight));
}

/**
 * Deterministic evaluatedAt from max order date.
 */
function getEvaluatedAt() {
  const orders = commissionService.getOrdersWithCommission();
  if (orders.length === 0) return new Date().toISOString();
  const maxDate = orders.map((o) => o.createdAt.slice(0, 10)).reduce((a, b) => (a > b ? a : b), '');
  return new Date(maxDate + 'T12:00:00.000Z').toISOString();
}

/**
 * Initialize workforce insights: run rules, cache, log each.
 * Must be called after initShiftService.
 */
export function initWorkforceInsightService() {
  const metrics = shiftService.getShiftMetrics();
  const evaluatedAt = getEvaluatedAt();
  insights = [];

  const byStore = new Map();
  for (const m of metrics) {
    if (!byStore.has(m.storeId)) byStore.set(m.storeId, []);
    byStore.get(m.storeId).push(m);
  }

  for (const [storeId, storeMetrics] of byStore) {
    for (const m of storeMetrics) {
      const util = m.utilization;
      const shiftLabel = m.shift === 'morning' ? 'Morning' : 'Evening';

      // STAFF_SHORTAGE: utilization > 1.1
      if (util > SHORTAGE_THRESHOLD) {
        const severity = util > SHORTAGE_CRITICAL_THRESHOLD ? 'critical' : 'warning';
        const insight = {
          type: 'STAFF_SHORTAGE',
          storeId,
          message: `${shiftLabel} shift utilization (${util.toFixed(2)}) exceeds ${SHORTAGE_THRESHOLD}. Consider adding staff.`,
          severity,
          evaluatedAt,
        };
        insights.push(insight);
        emitInsight(insight);
      }

      // OVERSTAFFING: utilization < 0.6
      if (util < OVERSTAFFING_THRESHOLD && util > 0) {
        const insight = {
          type: 'OVERSTAFFING',
          storeId,
          message: `${shiftLabel} shift utilization (${util.toFixed(2)}) below ${OVERSTAFFING_THRESHOLD}. Underused capacity.`,
          severity: 'info',
          evaluatedAt,
        };
        insights.push(insight);
        emitInsight(insight);
      }
    }

    // PRODUCTIVITY_RISK: same store overloaded in both shifts (utilization > 1.1 in both)
    const morning = storeMetrics.find((x) => x.shift === 'morning');
    const evening = storeMetrics.find((x) => x.shift === 'evening');
    if (morning && evening && morning.utilization > SHORTAGE_THRESHOLD && evening.utilization > SHORTAGE_THRESHOLD) {
      const insight = {
        type: 'PRODUCTIVITY_RISK',
        storeId,
        message: `Both morning and evening shifts are overloaded (utilization ${morning.utilization.toFixed(2)} / ${evening.utilization.toFixed(2)}). Role capacity may be misaligned.`,
        severity: 'warning',
        evaluatedAt,
      };
      insights.push(insight);
      emitInsight(insight);
    }
  }
}

/**
 * @returns {WorkforceInsight[]}
 */
export function getWorkforceInsights() {
  return insights;
}
