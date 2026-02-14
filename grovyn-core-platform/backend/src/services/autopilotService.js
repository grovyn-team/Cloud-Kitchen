/**
 * AI Autopilot — orchestration brain. Consumes insights from M2–M6, prioritizes, outputs top actions.
 * No new metrics; rule-based prioritization only. Deterministic.
 */

import * as storeHealthService from './storeHealthService.js';
import * as aggregatorInsightService from './aggregatorInsightService.js';
import * as inventoryInsightService from './inventoryInsightService.js';
import * as workforceInsightService from './workforceInsightService.js';
import * as financeInsightService from './financeInsightService.js';

const PRIORITY_CRITICAL = 100;
const PRIORITY_WARNING = 60;
const PRIORITY_INFO = 20;
const FINANCE_BOOST = 10;
const SAME_STORE_BOOST = 5;
const TOP_N = 5;

/**
 * @typedef {Object} NormalizedInsight
 * @property {string} type
 * @property {string} severity
 * @property {string} [entityType]
 * @property {string} [entityId]
 * @property {string} [storeId]
 * @property {string} [storeName]
 * @property {string} [brandId]
 * @property {string} [skuId]
 * @property {string} message
 * @property {string} evaluatedAt
 * @property {string} source
 * @property {number} priorityScore
 */

/** @type {NormalizedInsight[]} */
let allInsights = [];

/** @type {NormalizedInsight[]} */
let topPriorities = [];

/** Counts per module for boot log */
let insightsConsumedByModule = { storeHealth: 0, aggregator: 0, inventory: 0, workforce: 0, finance: 0 };

function severityToScore(severity) {
  if (severity === 'critical') return PRIORITY_CRITICAL;
  if (severity === 'warning') return PRIORITY_WARNING;
  return PRIORITY_INFO;
}

/**
 * Convert store health (at_risk / critical) into insights.
 */
function collectStoreHealthInsights() {
  const health = storeHealthService.getHealthForAllStores();
  const list = [];
  for (const h of health) {
    if (h.status === 'healthy') continue;
    const severity = h.status === 'critical' ? 'critical' : 'warning';
    list.push({
      type: 'STORE_HEALTH',
      severity,
      storeId: h.storeId,
      storeName: h.storeName,
      message: `${h.storeName} is ${h.status.replace('_', ' ')}.`,
      evaluatedAt: h.lastEvaluatedAt,
      source: 'storeHealth',
    });
  }
  return list;
}

/**
 * Normalize and score a single insight; add storeId when derivable.
 */
function normalize(raw, source, defaultStoreId = null) {
  const severity = raw.severity ?? 'info';
  let score = severityToScore(severity);
  if (source === 'finance') score += FINANCE_BOOST;
  const out = {
    type: raw.type,
    severity,
    message: raw.message,
    evaluatedAt: raw.evaluatedAt,
    source,
    priorityScore: score,
  };
  if (raw.storeId) out.storeId = raw.storeId;
  if (raw.storeName) out.storeName = raw.storeName;
  if (raw.entityType) out.entityType = raw.entityType;
  if (raw.entityId) out.entityId = raw.entityId;
  if (raw.brandId) out.brandId = raw.brandId;
  if (raw.skuId) out.skuId = raw.skuId;
  if (raw.aggregatorId) out.entityId = raw.aggregatorId;
  if (raw.ingredientId) out.entityId = raw.ingredientId;
  if (defaultStoreId && !out.storeId) out.storeId = defaultStoreId;
  return out;
}

/**
 * Collect from all modules, normalize, score, apply same-store boost, sort, take top N.
 */
function runPrioritization() {
  const collected = [];

  const storeHealthInsights = collectStoreHealthInsights();
  insightsConsumedByModule.storeHealth = storeHealthInsights.length;
  for (const i of storeHealthInsights) {
    collected.push(normalize(i, 'storeHealth'));
  }

  const aggregator = aggregatorInsightService.getAggregatorInsights();
  insightsConsumedByModule.aggregator = aggregator.length;
  for (const i of aggregator) {
    collected.push(normalize({ ...i, entityType: 'AGGREGATOR', entityId: i.aggregatorId }, 'aggregator'));
  }

  const inventory = inventoryInsightService.getInventoryInsights();
  insightsConsumedByModule.inventory = inventory.length;
  for (const i of inventory) {
    collected.push(normalize(i, 'inventory'));
  }

  const workforce = workforceInsightService.getWorkforceInsights();
  insightsConsumedByModule.workforce = workforce.length;
  for (const i of workforce) {
    collected.push(normalize(i, 'workforce'));
  }

  const finance = financeInsightService.getFinanceInsights();
  insightsConsumedByModule.finance = finance.length;
  for (const i of finance) {
    const n = normalize(i, 'finance');
    if (i.entityType === 'STORE' && i.entityId) n.storeId = i.entityId;
    if (i.entityType === 'BRAND' && i.entityId) n.brandId = i.entityId;
    if (i.entityType === 'SKU' && i.entityId) n.skuId = i.entityId;
    collected.push(n);
  }

  const storeInsightCount = new Map();
  for (const i of collected) {
    const sid = i.storeId ?? 'global';
    storeInsightCount.set(sid, (storeInsightCount.get(sid) ?? 0) + 1);
  }
  for (const i of collected) {
    const sid = i.storeId ?? 'global';
    if (storeInsightCount.get(sid) >= 2) i.priorityScore += SAME_STORE_BOOST;
  }

  allInsights = collected.sort((a, b) => b.priorityScore - a.priorityScore);
  topPriorities = allInsights.slice(0, TOP_N);
}

/**
 * Initialize autopilot: collect and prioritize. Call after all insight services (M2–M6).
 */
export function initAutopilotService() {
  runPrioritization();
}

export function getAllInsights() {
  return allInsights;
}

export function getTopPriorities() {
  return topPriorities;
}

export function getInsightsConsumedByModule() {
  return insightsConsumedByModule;
}

export function getTotalInsightsConsumed() {
  return allInsights.length;
}
