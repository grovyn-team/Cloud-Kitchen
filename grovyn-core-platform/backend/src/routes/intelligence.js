/**
 * AI Intelligence APIs: metrics, insights, actions, dashboard, simulate, customer segments, SKU margin.
 */

import * as metricsEngine from '../engines/metricsEngine.js';
import * as insightEngine from '../engines/insightEngine.js';
import * as actionEngine from '../engines/actionEngine.js';
import * as simulatorEngine from '../engines/simulatorEngine.js';
import * as commissionService from '../services/commissionService.js';
import * as customerService from '../services/customerService.js';
import * as profitEngine from '../services/profitEngine.js';
import * as skuService from '../services/skuService.js';

export function getMetrics(req, res) {
  const data = metricsEngine.getFullMetrics();
  res.json(data);
}

export function getInsights(req, res) {
  const metrics = metricsEngine.getFullMetrics();
  const data = insightEngine.generateInsights(metrics);
  res.json({ data, meta: { count: data.length } });
}

export function getActions(req, res) {
  const data = actionEngine.getTopActions();
  res.json({ data, meta: { count: data.length } });
}

export function getDashboard(req, res) {
  const metrics = metricsEngine.getFullMetrics();
  const insights = insightEngine.generateInsights(metrics);
  const actions = actionEngine.getTopActions();
  res.json({ metrics, insights, actions });
}

export function getSimulate(req, res) {
  const stores = Number(req.query.stores) || 3;
  const data = simulatorEngine.simulate(stores);
  res.json(data);
}

/**
 * Customer segments: champion (10+), loyal (5-9), new (1-4 active), dormant (14+ days). Plus churn risks.
 */
export function getCustomerSegments(req, res) {
  const orders = commissionService.getOrdersWithCommission();
  const metrics = metricsEngine.getFullMetrics();
  const today = metrics.referenceToday || new Date().toISOString().slice(0, 10);
  const todayMs = new Date(today + 'T12:00:00.000Z').getTime();
  const dormantCutoff = todayMs - 14 * 24 * 60 * 60 * 1000;

  const customerOrderCount = new Map();
  const customerLastOrder = new Map();
  const customerLtv = new Map();
  for (const o of orders) {
    customerOrderCount.set(o.customerId, (customerOrderCount.get(o.customerId) ?? 0) + 1);
    const t = new Date(o.createdAt).getTime();
    if (t > (customerLastOrder.get(o.customerId) ?? 0)) customerLastOrder.set(o.customerId, t);
    customerLtv.set(o.customerId, (customerLtv.get(o.customerId) ?? 0) + o.totalAmount);
  }

  let champion = 0, loyal = 0, new_ = 0, dormant = 0;
  const churnRisks = [];

  for (const [cid, count] of customerOrderCount) {
    const last = customerLastOrder.get(cid) ?? 0;
    if (count >= 10) champion++;
    else if (count >= 5) loyal++;
    else if (count >= 1) new_++;
    if (last < dormantCutoff) dormant++;
    if (last < dormantCutoff && (customerLtv.get(cid) ?? 0) >= 500) {
      churnRisks.push({
        customerId: cid,
        name: `Customer ${cid.slice(-6)}`,
        ltv: Number((customerLtv.get(cid) ?? 0).toFixed(2)),
        orders: count,
        lastOrderDaysAgo: Math.floor((todayMs - last) / (24 * 60 * 60 * 1000)),
        avgValue: Number(((customerLtv.get(cid) ?? 0) / count).toFixed(2)),
        risk: 'high',
      });
    }
  }

  const total = customerOrderCount.size;
  const repeatRate7d = metrics.last7?.repeatRate ?? 0;
  const wowRepeat = metrics.wow?.repeatDeltaPct ?? 0;
  const predictedReorders = [...customerOrderCount.entries()].filter(
    ([cid, count]) => count >= 3 && (customerLastOrder.get(cid) ?? 0) >= todayMs - 5 * 24 * 60 * 60 * 1000
  ).length;

  churnRisks.sort((a, b) => b.ltv - a.ltv);
  const topChurnRisks = churnRisks.slice(0, 8);

  res.json({
    totalCustomers: total,
    repeatRate7d,
    wowRepeatDeltaPct: wowRepeat,
    dormantCount: dormant,
    predictedReorders,
    segments: [
      { id: 'champion', label: 'Champions', icon: '🏆', count: champion, pct: total > 0 ? Number(((champion / total) * 100).toFixed(1)) : 0 },
      { id: 'loyal', label: 'Loyal', icon: '⭐', count: loyal, pct: total > 0 ? Number(((loyal / total) * 100).toFixed(1)) : 0 },
      { id: 'new', label: 'New', icon: '🆕', count: new_, pct: total > 0 ? Number(((new_ / total) * 100).toFixed(1)) : 0 },
      { id: 'dormant', label: 'Dormant', icon: '💤', count: dormant, pct: total > 0 ? Number(((dormant / total) * 100).toFixed(1)) : 0 },
    ],
    championAvgLtv: champion > 0
      ? Number([...customerOrderCount.entries()].filter(([, c]) => c >= 10).reduce((s, [cid]) => s + (customerLtv.get(cid) ?? 0), 0) / champion)
      : 0,
    dormantWinBackEstimate: Number((dormant * 200 * 0.15).toFixed(0)),
    churnRisks: topChurnRisks,
  });
}

/**
 * SKU margin analysis: all items sorted by margin%, with status badge.
 */
export function getSkusMarginAnalysis(req, res) {
  const margins = profitEngine.getSkuMargins();
  const skus = skuService.getAllSkus();
  const skuMap = new Map(skus.map((s) => [s.id, s]));

  const rows = margins.map((m) => {
    const sku = skuMap.get(m.skuId);
    return {
      skuId: m.skuId,
      name: sku?.name ?? m.skuId,
      revenue: m.revenue,
      cost: m.ingredientCost,
      margin: m.margin,
      marginPercent: m.marginPercent ?? 0,
      status: (m.marginPercent ?? 0) >= 25 ? 'OK' : 'ALERT',
      qtySold: 0,
      commission: m.commission ?? 0,
      net: m.margin,
    };
  });

  rows.sort((a, b) => a.marginPercent - b.marginPercent);
  res.json({ data: rows, meta: { count: rows.length } });
}
