/**
 * Alert Orchestrator — decide what deserves an executive alert. Log only; no real notifications.
 */

import * as autopilotService from './autopilotService.js';
import * as financeInsightService from './financeInsightService.js';
import * as commissionService from './commissionService.js';

/**
 * @typedef {Object} AutopilotAlert
 * @property {string} channel
 * @property {string} severity
 * @property {string} message
 * @property {Array<{ type: string, id: string }>} entities
 * @property {string} generatedAt
 */

/** @type {AutopilotAlert[]} */
let activeAlerts = [];

function getGeneratedAt() {
  const orders = commissionService.getOrdersWithCommission();
  if (orders.length === 0) return new Date().toISOString();
  const maxDate = orders.map((o) => o.createdAt.slice(0, 10)).reduce((a, b) => (a > b ? a : b), '');
  return new Date(maxDate + 'T07:00:00.000Z').toISOString();
}

function emitAlert(alert) {
  console.log('[AUTOPILOT_ALERT]', JSON.stringify(alert));
}

/**
 * Build alerts: critical always; 2+ warnings same store; negative profit. Deterministic.
 */
function runAlertOrchestrator() {
  const insights = autopilotService.getAllInsights();
  const financeInsights = financeInsightService.getFinanceInsights();
  const generatedAt = getGeneratedAt();
  activeAlerts = [];

  const criticalInsights = insights.filter((i) => i.severity === 'critical');
  const warningsByStore = new Map();
  for (const i of insights) {
    if (i.severity !== 'warning' || !i.storeId) continue;
    warningsByStore.set(i.storeId, (warningsByStore.get(i.storeId) ?? 0) + 1);
  }
  const storesWith2PlusWarnings = [...warningsByStore].filter(([, c]) => c >= 2).map(([s]) => s);
  const negativeProfit = financeInsights.filter(
    (i) => i.type === 'NEGATIVE_PROFIT'
  );

  if (criticalInsights.length > 0) {
    const entities = criticalInsights.map((i) => ({
      type: i.entityType ?? (i.storeId ? 'STORE' : 'AGGREGATOR'),
      id: i.storeId ?? i.entityId ?? i.type,
    }));
    const alert = {
      channel: 'EXECUTIVE_ALERT',
      severity: 'critical',
      message: `${criticalInsights.length} critical issue(s) require attention.`,
      entities,
      generatedAt,
    };
    activeAlerts.push(alert);
    emitAlert(alert);
  }

  if (storesWith2PlusWarnings.length > 0) {
    const alert = {
      channel: 'EXECUTIVE_ALERT',
      severity: 'warning',
      message: `${storesWith2PlusWarnings.length} store(s) have 2+ warnings: ${storesWith2PlusWarnings.join(', ')}.`,
      entities: storesWith2PlusWarnings.map((id) => ({ type: 'STORE', id })),
      generatedAt,
    };
    activeAlerts.push(alert);
    emitAlert(alert);
  }

  if (negativeProfit.length > 0) {
    const entities = negativeProfit.map((i) => ({ type: i.entityType, id: i.entityId }));
    const alert = {
      channel: 'EXECUTIVE_ALERT',
      severity: 'critical',
      message: `Negative profit detected on ${entities.length} entity/entities.`,
      entities,
      generatedAt,
    };
    activeAlerts.push(alert);
    emitAlert(alert);
  }
}

/**
 * Initialize alert orchestrator. Call after initAutopilotService and finance insights.
 */
export function initAlertOrchestratorService() {
  runAlertOrchestrator();
}

export function getActiveAlerts() {
  return activeAlerts;
}
