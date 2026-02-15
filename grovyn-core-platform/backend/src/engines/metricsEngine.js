/**
 * Metrics Engine — time-series analytics derived from order/store data.
 * All numbers are computed; no hardcoding. Deterministic.
 */

import * as commissionService from '../services/commissionService.js';
import * as financeService from '../services/financeService.js';
import * as storeService from '../services/storeService.js';

/** @type {string} Reference "today" YYYY-MM-DD = max date in orders for deterministic windows */
let referenceToday = '';

function getReferenceToday() {
  if (referenceToday) return referenceToday;
  const orders = commissionService.getOrdersWithCommission();
  if (orders.length === 0) {
    const d = new Date();
    referenceToday = d.toISOString().slice(0, 10);
    return referenceToday;
  }
  referenceToday = orders.reduce((max, o) => {
    const key = o.createdAt.slice(0, 10);
    return key > max ? key : max;
  }, orders[0].createdAt.slice(0, 10));
  return referenceToday;
}

/** @param {string} dateKey YYYY-MM-DD @param {number} deltaDays @returns {string} YYYY-MM-DD */
function addDays(dateKey, deltaDays) {
  const d = new Date(dateKey + 'T12:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/**
 * @param {string} fromKey
 * @param {string} toKey
 * @returns {{ revenue: number, cost: number, commission: number, netMargin: number, netMarginPct: number, repeatRate: number, orderCount: number }}
 */
function aggregateForRange(fromKey, toKey) {
  const orders = commissionService.getOrdersInDateRange(fromKey, toKey);
  const financials = financeService.getOrderFinancials();
  const orderIdToFin = new Map(financials.map((f) => [f.orderId, f]));

  let revenue = 0;
  let commission = 0;
  let netRevenue = 0;
  const orderCount = orders.length;

  const customerOrderCount = new Map();
  for (const o of orders) {
    revenue += o.totalAmount;
    commission += o.commissionAmount ?? 0;
    const f = orderIdToFin.get(o.orderId);
    if (f) netRevenue += f.netRevenue;
    customerOrderCount.set(o.customerId, (customerOrderCount.get(o.customerId) ?? 0) + 1);
  }

  const repeatCustomers = [...customerOrderCount.entries()].filter(([, c]) => c >= 2).length;
  const totalCustomersWithOrders = customerOrderCount.size;
  const repeatOrders = [...customerOrderCount.entries()].filter(([, c]) => c >= 2).reduce((s, [, c]) => s + c, 0);
  const repeatRate = orderCount > 0 ? Number(((repeatOrders / orderCount) * 100).toFixed(2)) : 0;

  const cost = revenue - netRevenue;
  const netMarginPct = revenue > 0 ? Number(((netRevenue / revenue) * 100).toFixed(2)) : 0;

  return {
    revenue: Number(revenue.toFixed(2)),
    cost: Number(cost.toFixed(2)),
    commission: Number(commission.toFixed(2)),
    netMargin: Number(netRevenue.toFixed(2)),
    netMarginPct,
    repeatRate,
    orderCount,
  };
}

/**
 * Same as aggregateForRange but filtered by storeId.
 * @param {string} storeId
 * @param {string} fromKey
 * @param {string} toKey
 */
function aggregateForStoreInRange(storeId, fromKey, toKey) {
  const orders = commissionService.getOrdersInDateRange(fromKey, toKey).filter((o) => o.storeId === storeId);
  const financials = financeService.getOrderFinancials();
  const orderIdToFin = new Map(financials.map((f) => [f.orderId, f]));

  let revenue = 0;
  let commission = 0;
  let netRevenue = 0;
  const orderCount = orders.length;

  const customerOrderCount = new Map();
  for (const o of orders) {
    revenue += o.totalAmount;
    commission += o.commissionAmount ?? 0;
    const f = orderIdToFin.get(o.orderId);
    if (f) netRevenue += f.netRevenue;
    customerOrderCount.set(o.customerId, (customerOrderCount.get(o.customerId) ?? 0) + 1);
  }

  const repeatOrders = [...customerOrderCount.entries()].filter(([, c]) => c >= 2).reduce((s, [, c]) => s + c, 0);
  const repeatRate = orderCount > 0 ? Number(((repeatOrders / orderCount) * 100).toFixed(2)) : 0;
  const netMarginPct = revenue > 0 ? Number(((netRevenue / revenue) * 100).toFixed(2)) : 0;

  return {
    revenue: Number(revenue.toFixed(2)),
    commission: Number(commission.toFixed(2)),
    netMargin: Number(netRevenue.toFixed(2)),
    netMarginPct,
    repeatRate,
    orderCount,
  };
}

/**
 * Daily trend: last 7 days each with revenue, margin%, repeat%, commission%.
 * @returns {Array<{ date: string, revenue: number, marginPct: number, repeatPct: number, commissionPct: number }>}
 */
function getDailyTrend() {
  const today = getReferenceToday();
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    const agg = aggregateForRange(d, d);
    const commissionPct = agg.revenue > 0 ? Number(((agg.commission / agg.revenue) * 100).toFixed(2)) : 0;
    out.push({
      date: d,
      revenue: agg.revenue,
      marginPct: agg.netMarginPct,
      repeatPct: agg.repeatRate,
      commissionPct,
    });
  }
  return out;
}

/**
 * 3-day continuous trend: last 3 days of values. Returns 'increase' | 'decline' | 'stable' for a metric.
 * @param {string} metricKey 'revenue' | 'netMarginPct' | 'repeatRate' | 'commissionPct'
 * @returns {'increase'|'decline'|'stable'}
 */
function get3DayTrend(metricKey) {
  const trend = getDailyTrend();
  const last3 = trend.slice(-3).map((d) => d[metricKey === 'repeatRate' ? 'repeatPct' : metricKey === 'revenue' ? 'revenue' : metricKey === 'netMarginPct' ? 'marginPct' : 'commissionPct']);
  if (last3.length < 3) return 'stable';
  if (last3[0] < last3[1] && last3[1] < last3[2]) return 'increase';
  if (last3[0] > last3[1] && last3[1] > last3[2]) return 'decline';
  return 'stable';
}

/**
 * Initialize and compute reference today. Call after commission + finance init.
 */
export function initMetricsEngine() {
  getReferenceToday();
}

/**
 * Full computed metrics: yesterday, 7d, 14d, WoW, trends, per-store.
 * @returns {object}
 */
export function getFullMetrics() {
  const today = getReferenceToday();
  const yesterdayKey = addDays(today, -1);
  const day7Start = addDays(today, -7);
  const day14Start = addDays(today, -14);

  const yesterday = aggregateForRange(yesterdayKey, yesterdayKey);
  const last7 = aggregateForRange(day7Start, today);
  const last14 = aggregateForRange(day14Start, today);
  // WoW = prior 7 days (days -14..-8) vs current 7 days (days -7..-1) so R2/R3 fire correctly
  const prior7Start = addDays(today, -14);
  const prior7End = addDays(today, -8);
  const current7Start = addDays(today, -7);
  const current7End = addDays(today, -1);
  const prior7 = aggregateForRange(prior7Start, prior7End);
  const current7 = aggregateForRange(current7Start, current7End);

  const wowMarginDelta = Number((current7.netMarginPct - prior7.netMarginPct).toFixed(2));
  const wowRepeatDelta = Number((current7.repeatRate - prior7.repeatRate).toFixed(2));
  const prior7CommissionPct = prior7.revenue > 0 ? (prior7.commission / prior7.revenue) * 100 : 0;
  const current7CommissionPct = current7.revenue > 0 ? (current7.commission / current7.revenue) * 100 : 0;
  const wowCommissionDelta = Number((current7CommissionPct - prior7CommissionPct).toFixed(2));
  const wowRevenueDeltaPct = prior7.revenue > 0
    ? Number((((current7.revenue - prior7.revenue) / prior7.revenue) * 100).toFixed(2))
    : 0;

  const dailyTrend = getDailyTrend();
  const trend3DayRevenue = get3DayTrend('revenue');
  const trend3DayMargin = get3DayTrend('netMarginPct');
  const trend3DayRepeat = get3DayTrend('repeatRate');
  const trend3DayCommission = get3DayTrend('commissionPct');

  const stores = storeService.getAllStores();
  const perStore = stores.map((store) => {
    const y = aggregateForStoreInRange(store.id, yesterdayKey, yesterdayKey);
    const s7 = aggregateForStoreInRange(store.id, day7Start, today);
    const s14 = aggregateForStoreInRange(store.id, day14Start, today);
    const repeatDelta = Number((s7.repeatRate - s14.repeatRate).toFixed(2));
    return {
      storeId: store.id,
      storeName: store.name,
      yesterday: y,
      last7: s7,
      last14: s14,
      repeatRateDelta7vs14: repeatDelta,
    };
  });

  return {
    referenceToday: today,
    yesterday: {
      revenue: yesterday.revenue,
      cost: yesterday.cost,
      commission: yesterday.commission,
      netMargin: yesterday.netMargin,
      netMarginPct: yesterday.netMarginPct,
      repeatRate: yesterday.repeatRate,
      orderCount: yesterday.orderCount,
    },
    last7: {
      revenue: last7.revenue,
      cost: last7.cost,
      commission: last7.commission,
      netMargin: last7.netMargin,
      netMarginPct: last7.netMarginPct,
      repeatRate: last7.repeatRate,
      orderCount: last7.orderCount,
    },
    last14: {
      revenue: last14.revenue,
      cost: last14.cost,
      commission: last14.commission,
      netMargin: last14.netMargin,
      netMarginPct: last14.netMarginPct,
      repeatRate: last14.repeatRate,
      orderCount: last14.orderCount,
    },
    wow: {
      marginDeltaPct: wowMarginDelta,
      repeatDeltaPct: wowRepeatDelta,
      commissionDeltaPct: wowCommissionDelta,
      revenueDeltaPct: wowRevenueDeltaPct,
    },
    dailyTrend,
    trend3Day: {
      revenue: trend3DayRevenue,
      marginPct: trend3DayMargin,
      repeatRate: trend3DayRepeat,
      commissionPct: trend3DayCommission,
    },
    perStore,
  };
}

export { getReferenceToday, getDailyTrend, get3DayTrend, aggregateForRange, aggregateForStoreInRange };
