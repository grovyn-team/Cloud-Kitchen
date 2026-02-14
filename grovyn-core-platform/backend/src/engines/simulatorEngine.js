/**
 * Simulator Engine — branch/store scalability: 1–10 new stores.
 * With vs without Grovyn AI margin and repeat assumptions.
 */

import * as metricsEngine from './metricsEngine.js';
import * as storeService from '../services/storeService.js';

/**
 * @param {number} newStores 1–10
 * @returns {object}
 */
export function simulate(newStores) {
  const n = Math.max(1, Math.min(10, Number(newStores) || 1));
  const metrics = metricsEngine.getFullMetrics();
  const stores = storeService.getAllStores();
  const currentStores = stores.length;
  const totalStores = currentStores + n;

  const currentCustomers = metrics.last7?.orderCount ? metrics.last7.orderCount * 3 : 1200;
  const yesterdayRevenue = metrics.yesterday?.revenue ?? 45000;

  const projectedMAU = Math.round(currentCustomers * (totalStores / currentStores) * 0.88);
  const scaleFactor = totalStores / currentStores;
  const projectedDailyRevenue = Number((yesterdayRevenue * scaleFactor * 0.92).toFixed(2));

  const baseMargin = metrics.last7?.netMarginPct ?? 18;
  const baseRepeat = metrics.last7?.repeatRate ?? 22;

  let withoutMargin = baseMargin - 1.7 * n;
  withoutMargin = Math.max(8, withoutMargin);
  let withoutRepeat = baseRepeat - 2.0 * n;
  withoutRepeat = Math.max(11, withoutRepeat);

  let withMargin = baseMargin + 0.5 * n;
  withMargin = Math.min(baseMargin + 3.5, withMargin);
  let withRepeat = baseRepeat + 0.7 * n;
  withRepeat = Math.min(baseRepeat + 6, withRepeat);

  const dailyNetWithout = Number((projectedDailyRevenue * (withoutMargin / 100)).toFixed(2));
  const dailyNetWith = Number((projectedDailyRevenue * (withMargin / 100)).toFixed(2));
  const monthlySavings = Number(((dailyNetWith - dailyNetWithout) * 30).toFixed(2));

  return {
    newStores: n,
    totalStores,
    currentStores,
    projectedMAU,
    projectedDailyRevenue,
    withoutGrovyn: {
      marginPercent: Number(withoutMargin.toFixed(2)),
      repeatPercent: Number(withoutRepeat.toFixed(2)),
      dailyNet: dailyNetWithout,
    },
    withGrovyn: {
      marginPercent: Number(withMargin.toFixed(2)),
      repeatPercent: Number(withRepeat.toFixed(2)),
      dailyNet: dailyNetWith,
    },
    monthlySavings,
  };
}
