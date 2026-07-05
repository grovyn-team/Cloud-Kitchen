/**
 * Store & Operations Management — operational health of each store.
 * Evaluates stores using deterministic, rule-based logic only.
 * No AI, no external deps; runs on seeded data and emits internal events.
 */

import { createSeededRandom, float } from '../seed/seededRandom.js';
import { config } from '../config/index.js';

// --- Thresholds (rule-based health status) ---
const THRESHOLD_ORDER_DROP_PERCENT = 20;  // breach when orderDeviationPercent < -20
const THRESHOLD_LOAD_FACTOR = 0.85;       // breach when loadFactor > 0.85
const THRESHOLD_FAILURE_RATE = 0.05;      // breach when failureRate > 5%

/** @type {Map<string, { status: string, lastEvaluatedAt: string }>} */
const previousStatusByStore = new Map();

/** @type {Array<{ storeId: string, storeName: string, status: string, signals: object, lastEvaluatedAt: string }>} */
let evaluationResults = [];

/** Fixed evaluation timestamp (deterministic across restarts). */
let evaluationTimestamp = '';

/**
 * Hash string to unsigned 32-bit integer (deterministic).
 * @param {string} str
 * @returns {number}
 */
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/**
 * Get deterministic failure rate for a store (0..0.10). Uses seeded RNG, never Math.random.
 * @param {string} storeId
 * @returns {number}
 */
function getFailureRateForStore(storeId) {
  const seed = (hashString(storeId) + config.seed.randomSeed) >>> 0;
  const rng = createSeededRandom(seed);
  return float(rng, 0, 0.10, 2);
}

/**
 * Extract UTC date string YYYY-MM-DD from ISO timestamp.
 * @param {string} iso
 * @returns {string}
 */
function toDateKey(iso) {
  return iso.slice(0, 10);
}

/**
 * Compute operational baselines from orders: dailyOrderBaseline, avgOrdersPerHour per store.
 * Uses global date range from all orders so "yesterday" is deterministic (max date - 1 day).
 * @param {import('./storeService.js')} storeSvc
 * @param {import('./orderService.js')} orderSvc
 * @returns {{ baselines: Map<string, { dailyOrderBaseline: number, avgOrdersPerHour: number, operatingHours: number }>, evaluationDate: string, yesterdayDate: string }}
 */
function computeBaselines(storeSvc, orderSvc) {
  const stores = storeSvc.getAllStores();
  const orders = orderSvc.getAllOrders();
  const getOperatingHoursAsHours = storeSvc.getOperatingHoursAsHours;

  const dateSet = new Set();
  for (const o of orders) dateSet.add(toDateKey(o.createdAt));
  const sortedDates = [...dateSet].sort();
  const minDate = sortedDates[0];
  const maxDate = sortedDates[sortedDates.length - 1];
  const numDays = sortedDates.length;

  const evaluationDate = maxDate;
  const d = new Date(maxDate + 'T12:00:00.000Z');
  d.setUTCDate(d.getUTCDate() - 1);
  const yesterdayDate = d.toISOString().slice(0, 10);

  const baselines = new Map();
  for (const store of stores) {
    const storeOrders = orderSvc.getOrdersByStoreId(store.id);
    const dailyOrderBaseline = numDays > 0 ? storeOrders.length / numDays : 0;
    const hours = getOperatingHoursAsHours(store.operatingHours) || 14;
    const avgOrdersPerHour = hours > 0 ? dailyOrderBaseline / hours : 0;
    baselines.set(store.id, { dailyOrderBaseline, avgOrdersPerHour, operatingHours: hours });
  }

  return { baselines, evaluationDate, yesterdayDate };
}

/**
 * Count orders for a store on a given date (UTC day).
 * @param {import('../models/index.js').Order[]} storeOrders
 * @param {string} dateKey YYYY-MM-DD
 * @returns {number}
 */
function countOrdersOnDate(storeOrders, dateKey) {
  return storeOrders.filter((o) => toDateKey(o.createdAt) === dateKey).length;
}

/**
 * Evaluate one store: compute metrics and derive status.
 * @param {import('../models/index.js').Store} store
 * @param {Map<string, { dailyOrderBaseline: number, avgOrdersPerHour: number, operatingHours: number }>} baselines
 * @param {string} yesterdayDate
 * @param {import('./orderService.js')} orderSvc
 * @returns {{ status: 'healthy' | 'at_risk' | 'critical', signals: { orderDeviationPercent: number, loadFactor: number, failureRate: number } }}
 */
function evaluateStore(store, baselines, yesterdayDate, orderSvc) {
  const bl = baselines.get(store.id);
  const dailyOrderBaseline = bl ? bl.dailyOrderBaseline : 0;
  const avgOrdersPerHour = bl ? bl.avgOrdersPerHour : 0;
  const operatingHours = bl ? bl.operatingHours : 14;

  const storeOrders = orderSvc.getOrdersByStoreId(store.id);
  const yesterdayOrders = countOrdersOnDate(storeOrders, yesterdayDate);

  let orderDeviationPercent = 0;
  if (dailyOrderBaseline > 0) {
    orderDeviationPercent = Number((((yesterdayOrders - dailyOrderBaseline) / dailyOrderBaseline) * 100).toFixed(2));
  }

  let loadFactor = 0;
  if (avgOrdersPerHour > 0 && operatingHours > 0) {
    const ordersPerHourYesterday = yesterdayOrders / operatingHours;
    loadFactor = Number((ordersPerHourYesterday / avgOrdersPerHour).toFixed(2));
  }

  const failureRate = getFailureRateForStore(store.id);

  const orderBreach = orderDeviationPercent < -THRESHOLD_ORDER_DROP_PERCENT;
  const loadBreach = loadFactor > THRESHOLD_LOAD_FACTOR;
  const failureBreach = failureRate > THRESHOLD_FAILURE_RATE;
  const breachCount = [orderBreach, loadBreach, failureBreach].filter(Boolean).length;

  let status = 'healthy';
  if (breachCount >= 2) status = 'critical';
  else if (breachCount === 1) status = 'at_risk';

  return {
    status,
    signals: {
      orderDeviationPercent,
      loadFactor,
      failureRate,
    },
  };
}

/**
 * Emit internal event (log to console). For future AI/consumers.
 * @param {object} event
 */
function emitStoreHealthEvent(event) {
  console.log('[STORE_HEALTH_EVENT]', JSON.stringify(event));
}

/**
 * Initialize store health service: compute baselines, evaluate all stores, emit events on change, log counts.
 * Must be called after initServices(seedData). Uses only storeService and orderService.
 * @param {import('./storeService.js')} storeSvc
 * @param {import('./orderService.js')} orderSvc
 */
export function initStoreHealthService(storeSvc, orderSvc) {
  const { baselines, evaluationDate, yesterdayDate } = computeBaselines(storeSvc, orderSvc);
  const stores = storeSvc.getAllStores();

  evaluationTimestamp = new Date(evaluationDate + 'T12:00:00.000Z').toISOString();

  const counts = { healthy: 0, at_risk: 0, critical: 0 };
  const results = [];

  for (const store of stores) {
    const { status, signals } = evaluateStore(store, baselines, yesterdayDate, orderSvc);
    counts[status] += 1;

    const evaluatedAt = evaluationTimestamp;
    const previous = previousStatusByStore.get(store.id);
    if (previous && previous.status !== status) {
      emitStoreHealthEvent({
        type: 'STORE_HEALTH_STATUS_CHANGED',
        storeId: store.id,
        previousStatus: previous.status,
        currentStatus: status,
        evaluatedAt,
      });
    }
    previousStatusByStore.set(store.id, { status, lastEvaluatedAt: evaluatedAt });

    results.push({
      storeId: store.id,
      storeName: store.name,
      status,
      signals,
      lastEvaluatedAt: evaluatedAt,
    });
  }

  evaluationResults = results;

  console.log(`Store health evaluated: ${stores.length} stores`);
  console.log('Store health status counts:', counts);
}

/**
 * @returns {Array<{ storeId: string, storeName: string, status: string, signals: object, lastEvaluatedAt: string }>}
 */
export function getHealthForAllStores() {
  return evaluationResults;
}

/**
 * @param {string} storeId
 * @returns {{ storeId: string, storeName: string, status: string, signals: object, lastEvaluatedAt: string } | null}
 */
export function getHealthForStore(storeId) {
  return evaluationResults.find((r) => r.storeId === storeId) ?? null;
}
