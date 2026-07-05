/**
 * Insight Engine — rule-based AI insight generator.
 * 9 rules, deterministic confidence scoring, conditions array for explainability.
 */

import * as metricsEngine from './metricsEngine.js';
import * as storeService from '../services/storeService.js';
import * as commissionService from '../services/commissionService.js';
import * as profitEngine from '../services/profitEngine.js';
import * as skuService from '../services/skuService.js';
import * as customerService from '../services/customerService.js';

/** Confidence: min(95, 70 + deviation_strength(0-15) + confirming_signals(0-10)) */
function confidence(deviationStrength, confirmingCount) {
  const d = Math.min(deviationStrength, 15);
  const c = Math.min(confirmingCount * 3, 10);
  return Math.min(95, Math.round(70 + d + c));
}

/**
 * @param {object} metrics from getFullMetrics()
 * @returns {Array<{ id: string, type: string, icon: string, priority: number, title: string, text: string, confidence: number, triggerRule: string, conditions: Array<{ condition: string, met: boolean, detail: string }> }>}
 */
export function generateInsights(metrics) {
  const insights = [];
  const m = metrics;
  const yesterday = m.yesterday;
  const last7 = m.last7;
  const last14 = m.last14;
  const wow = m.wow;
  const trend3 = m.trend3Day;
  const perStore = m.perStore || [];
  let idSeq = 1;
  const nextId = () => `insight_${idSeq++}`;

  // --- 1. Repeat Rate Drop ---
  const repeatDrop = last7.repeatRate < last14.repeatRate && (last14.repeatRate - last7.repeatRate) > 0.5;
  const cond1 = [
    { condition: 'repeat_7d < repeat_14d', met: repeatDrop, detail: `${last7.repeatRate}% < ${last14.repeatRate}%` },
    { condition: '3-day continuous decline', met: trend3.repeatRate === 'decline', detail: trend3.repeatRate === 'decline' ? 'Confirmed' : 'No' },
    { condition: 'WoW repeat negative', met: wow.repeatDeltaPct < 0, detail: `${wow.repeatDeltaPct}%` },
  ];
  if (repeatDrop) {
    const dev = Math.min(((last14.repeatRate - last7.repeatRate) / 0.5), 1) * 15;
    const conf = Math.min(95, 70 + dev + (cond1.filter((c) => c.met).length * 3));
    insights.push({
      id: nextId(),
      type: 'critical',
      icon: '📉',
      priority: 1,
      title: 'Repeat Rate Drop',
      text: `7-day repeat rate (${last7.repeatRate}%) is below 14-day (${last14.repeatRate}%). WoW delta: ${wow.repeatDeltaPct}%. Consider retention campaigns.`,
      confidence: Math.min(95, conf),
      triggerRule: 'Fire if 7d repeat < 14d repeat by >0.5%.',
      conditions: cond1,
    });
  }

  // --- 2. Margin Decline WoW ---
  const marginDecline = wow.marginDeltaPct < -0.3;
  const cond2 = [
    { condition: 'WoW margin change < -0.3%', met: marginDecline, detail: `${wow.marginDeltaPct}%` },
    { condition: '3-day margin decline', met: trend3.marginPct === 'decline', detail: trend3.marginPct === 'decline' ? 'Yes' : 'No' },
    { condition: 'Commission rising', met: wow.commissionDeltaPct > 0, detail: `${wow.commissionDeltaPct}%` },
  ];
  if (marginDecline) {
    const dev = Math.min(Math.abs(wow.marginDeltaPct) / 0.3, 1) * 15;
    insights.push({
      id: nextId(),
      type: 'warning',
      icon: '📊',
      priority: 2,
      title: 'Margin Decline WoW',
      text: `Week-over-week margin change is ${wow.marginDeltaPct}%. Net margin 7d: ${last7.netMarginPct}%, 14d: ${last14.netMarginPct}%.`,
      confidence: confidence(dev, cond2.filter((c) => c.met).length),
      triggerRule: 'Fire if WoW margin change < -0.3%.',
      conditions: cond2,
    });
  }

  // --- 3. Commission Rising ---
  const commissionRising = wow.commissionDeltaPct > 0.2;
  const cond3 = [
    { condition: 'WoW commission change > +0.2%', met: commissionRising, detail: `${wow.commissionDeltaPct}%` },
    { condition: '3-day commission trend', met: trend3.commissionPct === 'increase', detail: trend3.commissionPct },
    { condition: 'Margin declining', met: wow.marginDeltaPct < 0, detail: `${wow.marginDeltaPct}%` },
  ];
  if (commissionRising) {
    const dev = Math.min(wow.commissionDeltaPct / 0.2, 1) * 15;
    insights.push({
      id: nextId(),
      type: 'warning',
      icon: '💰',
      priority: 3,
      title: 'Commission Rising',
      text: `Commission WoW change +${wow.commissionDeltaPct}%. Consider shifting traffic to direct channel.`,
      confidence: confidence(dev, cond3.filter((c) => c.met).length),
      triggerRule: 'Fire if WoW commission change > +0.2%.',
      conditions: cond3,
    });
  }

  // --- 4. Churn Risk ---
  const orders = commissionService.getOrdersWithCommission();
  const today = metrics.referenceToday || new Date().toISOString().slice(0, 10);
  const todayMs = new Date(today + 'T12:00:00.000Z').getTime();
  const cutoff = todayMs - 14 * 24 * 60 * 60 * 1000;
  const customerLastOrder = new Map();
  const customerLtv = new Map();
  for (const o of orders) {
    const t = new Date(o.createdAt).getTime();
    if (t > (customerLastOrder.get(o.customerId) ?? 0)) customerLastOrder.set(o.customerId, t);
    customerLtv.set(o.customerId, (customerLtv.get(o.customerId) ?? 0) + o.totalAmount);
  }
  const churnRisks = [...customerLastOrder.entries()].filter(([, last]) => last < cutoff);
  const ltvThreshold = 500;
  const atRisk = churnRisks.filter(([cid]) => (customerLtv.get(cid) ?? 0) >= ltvThreshold);
  const totalLtvAtRisk = atRisk.reduce((s, [cid]) => s + (customerLtv.get(cid) ?? 0), 0);
  const avgDaysInactive = churnRisks.length > 0
    ? churnRisks.reduce((s, [, last]) => s + Math.floor((todayMs - last) / (24 * 60 * 60 * 1000)), 0) / churnRisks.length
    : 0;
  const churnFire = atRisk.length > 0;
  const cond4 = [
    { condition: 'Customers with last_order > 14 days', met: churnRisks.length > 0, detail: `${churnRisks.length} customers` },
    { condition: `LTV > ${ltvThreshold}`, met: atRisk.length > 0, detail: `${atRisk.length} at risk` },
  ];
  if (churnFire) {
    insights.push({
      id: nextId(),
      type: 'critical',
      icon: '⚠️',
      priority: 4,
      title: 'Churn Risk',
      text: `${atRisk.length} high-value customers inactive 14+ days. Total LTV at risk: ₹${Number(totalLtvAtRisk).toFixed(0)}. Avg days inactive: ${Number(avgDaysInactive).toFixed(0)}.`,
      confidence: confidence(10, 2),
      triggerRule: 'Fire if any customers have last_order > 14 days AND LTV > threshold.',
      conditions: cond4,
    });
  }

  // --- 5. Reorder Prediction ---
  const fiveDaysAgo = new Date(today + 'T00:00:00.000Z').getTime() - 5 * 24 * 60 * 60 * 1000;
  const customerOrderCount = new Map();
  const customerLastOrderDate = new Map();
  for (const o of orders) {
    customerOrderCount.set(o.customerId, (customerOrderCount.get(o.customerId) ?? 0) + 1);
    const t = new Date(o.createdAt).getTime();
    if (t > (customerLastOrderDate.get(o.customerId) ?? 0)) customerLastOrderDate.set(o.customerId, t);
  }
  const reorderCandidates = [...customerOrderCount.entries()].filter(
    ([cid, count]) => count >= 3 && (customerLastOrderDate.get(cid) ?? 0) >= fiveDaysAgo
  );
  const capturableRevenue = reorderCandidates.reduce((s, [cid]) => s + (customerLtv.get(cid) ?? 0) / Math.max(1, customerOrderCount.get(cid)), 0);
  const reorderFire = reorderCandidates.length > 0;
  const cond5 = [
    { condition: 'last_order ≤ 5 days', met: reorderCandidates.length > 0, detail: `${reorderCandidates.length} customers` },
    { condition: 'total_orders ≥ 3', met: reorderCandidates.length > 0, detail: 'Yes' },
  ];
  if (reorderFire) {
    insights.push({
      id: nextId(),
      type: 'opportunity',
      icon: '🔄',
      priority: 5,
      title: 'Reorder Prediction',
      text: `${reorderCandidates.length} customers likely to reorder (active ≤5 days, 3+ orders). Estimated capturable revenue: ₹${Number(capturableRevenue).toFixed(0)}.`,
      confidence: 78,
      triggerRule: 'Fire if customers have last_order ≤ 5 days AND total_orders ≥ 3.',
      conditions: cond5,
    });
  }

  // --- 6. Low-Margin SKUs ---
  const skuMargins = profitEngine.getSkuMargins();
  const lowMargin = skuMargins.filter((s) => s.marginPercent != null && s.marginPercent < 25);
  const worst = lowMargin.length > 0 ? lowMargin.reduce((a, b) => (a.marginPercent < b.marginPercent ? a : b)) : null;
  const skuNames = new Map(skuService.getAllSkus().map((s) => [s.id, s.name]));
  const cond6 = [
    { condition: 'Any item margin < 25%', met: lowMargin.length > 0, detail: `${lowMargin.length} items` },
  ];
  if (worst) {
    insights.push({
      id: nextId(),
      type: 'warning',
      icon: '📦',
      priority: 6,
      title: 'Low-Margin SKUs',
      text: `${lowMargin.length} items below 25% margin. Worst: ${skuNames.get(worst.skuId) || worst.skuId} at ${Number(worst.marginPercent).toFixed(1)}%.`,
      confidence: confidence(15, 1),
      triggerRule: 'Fire if any items have margin < 25%.',
      conditions: cond6,
    });
  }

  // --- 7. Store Performance Gap ---
  const storeRates = perStore.map((s) => ({ name: s.storeName, id: s.storeId, rate: s.last7.repeatRate }));
  let maxGap = 0;
  let laggingStore = null;
  for (let i = 0; i < storeRates.length; i++) {
    for (let j = 0; j < storeRates.length; j++) {
      if (i === j) continue;
      const gap = Math.abs(storeRates[i].rate - storeRates[j].rate);
      if (gap > maxGap && gap > 1.5) {
        maxGap = gap;
        laggingStore = storeRates[i].rate < storeRates[j].rate ? storeRates[i] : storeRates[j];
      }
    }
  }
  const cond7 = [
    { condition: 'Repeat rate gap between stores > 1.5%', met: maxGap > 1.5, detail: maxGap > 1.5 ? `${maxGap.toFixed(1)}%` : 'No' },
  ];
  if (laggingStore) {
    insights.push({
      id: nextId(),
      type: 'warning',
      icon: '🏪',
      priority: 7,
      title: 'Store Performance Gap',
      text: `Repeat rate gap ${maxGap.toFixed(1)}%. Lagging store: ${laggingStore.name} (${laggingStore.rate}%).`,
      confidence: confidence(12, 1),
      triggerRule: 'Fire if repeat rate gap between any two stores > 1.5%.',
      conditions: cond7,
    });
  }

  // --- 8. Dormant Segment Size ---
  const dormantCount = churnRisks.length;
  const dormantThreshold = 50;
  const winBackEstimate = dormantCount * 200 * 0.15;
  const cond8 = [
    { condition: 'Dormant (14+ days inactive) > threshold', met: dormantCount > dormantThreshold, detail: `${dormantCount} dormant` },
  ];
  if (dormantCount > dormantThreshold) {
    insights.push({
      id: nextId(),
      type: 'opportunity',
      icon: '💤',
      priority: 8,
      title: 'Dormant Segment Size',
      text: `${dormantCount} dormant customers (14+ days). Win-back revenue estimate at 15% recovery: ₹${Number(winBackEstimate).toFixed(0)}/month.`,
      confidence: confidence(10, 1),
      triggerRule: 'Fire if dormant customers > threshold.',
      conditions: cond8,
    });
  }

  // --- 9. Champion Health (always fire, success) ---
  const championCount = [...customerOrderCount.entries()].filter(([, c]) => c >= 10).length;
  const championLtv = [...customerOrderCount.entries()]
    .filter(([, c]) => c >= 10)
    .reduce((s, [cid]) => s + (customerLtv.get(cid) ?? 0), 0);
  const avgChampionLtv = championCount > 0 ? championLtv / championCount : 0;
  insights.push({
    id: nextId(),
    type: 'success',
    icon: '🏆',
    priority: 9,
    title: 'Champion Health',
    text: `${championCount} high-value customers (10+ orders). Avg LTV: ₹${Number(avgChampionLtv).toFixed(0)}.`,
    confidence: 85,
    triggerRule: 'Always fire. Show count of high-value customers and avg LTV.',
    conditions: [
      { condition: 'Customers with 10+ orders', met: true, detail: `${championCount} champions` },
    ],
  });

  return insights;
}
