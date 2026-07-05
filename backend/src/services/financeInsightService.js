/**
 * Finance Insight Service — margin leakage, discount misuse, negative profit, low SKU margin.
 * Rule-based; no AI. EvaluatedAt from max order date. All insights logged.
 */

import * as profitEngine from './profitEngine.js';
import * as financeService from './financeService.js';
import * as commissionService from './commissionService.js';

const MARGIN_LEAKAGE_THRESHOLD_PERCENT = 5;
const MARGIN_LEAKAGE_CRITICAL_PERCENT = 10;
const LOW_SKU_MARGIN_THRESHOLD_PERCENT = 10;

/**
 * @typedef {Object} FinanceInsight
 * @property {string} type
 * @property {'STORE'|'BRAND'|'SKU'} entityType
 * @property {string} entityId
 * @property {string} message
 * @property {'info'|'warning'|'critical'} severity
 * @property {string} evaluatedAt
 */

/** @type {FinanceInsight[]} */
let insights = [];

function emitInsight(insight) {
  console.log('[FINANCE_INSIGHT]', JSON.stringify(insight));
}

function getEvaluatedAt() {
  const orders = commissionService.getOrdersWithCommission();
  if (orders.length === 0) return new Date().toISOString();
  const maxDate = orders.map((o) => o.createdAt.slice(0, 10)).reduce((a, b) => (a > b ? a : b), '');
  return new Date(maxDate + 'T12:00:00.000Z').toISOString();
}

/**
 * Initialize finance insights. Must be called after profitEngine.
 */
export function initFinanceInsightService() {
  const evaluatedAt = getEvaluatedAt();
  insights = [];
  const summary = profitEngine.getFinanceSummary();
  const baselineMargin =
    summary?.totalGrossRevenue > 0 ? (summary.totalProfit / summary.totalGrossRevenue) * 100 : 0;

  const storeList = profitEngine.getStoreProfitability();
  const brandList = profitEngine.getBrandProfitability();
  const skuList = profitEngine.getSkuMargins();
  const orderFinancials = financeService.getOrderFinancials();
  const discountByOrderId = new Map(orderFinancials.filter((f) => f.hasDiscount).map((f) => [f.orderId, true]));
  const orders = commissionService.getOrdersWithCommission();
  const ordersByCustomer = new Map();
  for (const o of orders) {
    if (!ordersByCustomer.has(o.customerId)) ordersByCustomer.set(o.customerId, []);
    ordersByCustomer.get(o.customerId).push(o);
  }

  for (const s of storeList) {
    if (s.marginPercent < baselineMargin - MARGIN_LEAKAGE_CRITICAL_PERCENT) {
      const insight = {
        type: 'MARGIN_LEAKAGE',
        entityType: 'STORE',
        entityId: s.storeId,
        message: `Store margin (${s.marginPercent.toFixed(1)}%) is more than ${MARGIN_LEAKAGE_CRITICAL_PERCENT}% below baseline (${baselineMargin.toFixed(1)}%).`,
        severity: 'critical',
        evaluatedAt,
      };
      insights.push(insight);
      emitInsight(insight);
    } else if (s.marginPercent < baselineMargin - MARGIN_LEAKAGE_THRESHOLD_PERCENT) {
      const insight = {
        type: 'MARGIN_LEAKAGE',
        entityType: 'STORE',
        entityId: s.storeId,
        message: `Store margin (${s.marginPercent.toFixed(1)}%) is more than ${MARGIN_LEAKAGE_THRESHOLD_PERCENT}% below baseline (${baselineMargin.toFixed(1)}%).`,
        severity: 'warning',
        evaluatedAt,
      };
      insights.push(insight);
      emitInsight(insight);
    }
    if (s.profit < 0) {
      const insight = {
        type: 'NEGATIVE_PROFIT',
        entityType: 'STORE',
        entityId: s.storeId,
        message: `Store profit is negative (${s.profit}).`,
        severity: 'critical',
        evaluatedAt,
      };
      insights.push(insight);
      emitInsight(insight);
    }
  }

  for (const b of brandList) {
    if (b.profit < 0) {
      const insight = {
        type: 'NEGATIVE_PROFIT',
        entityType: 'BRAND',
        entityId: b.brandId,
        message: `Brand profit is negative (${b.profit}).`,
        severity: 'critical',
        evaluatedAt,
      };
      insights.push(insight);
      emitInsight(insight);
    }
  }

  for (const sku of skuList) {
    if (sku.revenue > 0 && sku.marginPercent < LOW_SKU_MARGIN_THRESHOLD_PERCENT) {
      const insight = {
        type: 'LOW_SKU_MARGIN',
        entityType: 'SKU',
        entityId: sku.skuId,
        message: `SKU contribution margin (${sku.marginPercent.toFixed(1)}%) is below ${LOW_SKU_MARGIN_THRESHOLD_PERCENT}%.`,
        severity: 'info',
        evaluatedAt,
      };
      insights.push(insight);
      emitInsight(insight);
    }
  }

  for (const [customerId, customerOrders] of ordersByCustomer) {
    if (customerOrders.length !== 1) continue;
    const orderId = customerOrders[0].orderId;
    if (discountByOrderId.get(orderId)) {
      const insight = {
        type: 'DISCOUNT_MISUSE',
        entityType: 'STORE',
        entityId: customerOrders[0].storeId,
        message: `Discount applied to order ${orderId} but customer has no repeat orders (no uplift).`,
        severity: 'warning',
        evaluatedAt,
      };
      insights.push(insight);
      emitInsight(insight);
    }
  }
}

export function getFinanceInsights() {
  return insights;
}
