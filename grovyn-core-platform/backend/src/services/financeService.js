/**
 * Finance Service — financial truth per order. Gross, commission, discount, net.
 * Payout simulation per aggregator. No payment gateways; simulation only.
 */

import * as commissionService from './commissionService.js';

const DISCOUNT_ORDER_MODULO = 10;
const DISCOUNT_RATE = 0.1;

/**
 * @typedef {Object} OrderFinancials
 * @property {string} orderId
 * @property {string} storeId
 * @property {string} brandId
 * @property {number} grossRevenue
 * @property {number} commissionCost
 * @property {number} discountCost
 * @property {number} netRevenue
 * @property {boolean} hasDiscount
 */

/** @type {OrderFinancials[]} */
let orderFinancials = [];

/** @type {Map<string, number>} aggregatorId -> payout (sum of netRevenue for that channel) */
let payoutsByAggregator = new Map();

function logDiscountRules() {
  console.log('Discount simulation: every 10th order (index % 10 === 0) gets 10% discount');
}

/**
 * Build order-level financials and aggregator payouts. Deterministic.
 */
function runFinance() {
  const orders = commissionService.getOrdersWithCommission();
  orderFinancials = [];
  payoutsByAggregator = new Map();

  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    const grossRevenue = o.totalAmount;
    const commissionCost = o.commissionAmount ?? 0;
    const hasDiscount = i % DISCOUNT_ORDER_MODULO === 0;
    const discountCost = hasDiscount ? Number((grossRevenue * DISCOUNT_RATE).toFixed(2)) : 0;
    const netRevenue = Number((grossRevenue - commissionCost - discountCost).toFixed(2));

    orderFinancials.push({
      orderId: o.orderId,
      storeId: o.storeId,
      brandId: o.brandId,
      grossRevenue,
      commissionCost,
      discountCost,
      netRevenue,
      hasDiscount,
    });

    const key = o.aggregatorId ?? 'DIRECT';
    payoutsByAggregator.set(key, (payoutsByAggregator.get(key) ?? 0) + netRevenue);
  }

  for (const [k, v] of payoutsByAggregator) {
    payoutsByAggregator.set(k, Number(v.toFixed(2)));
  }
}

/**
 * Initialize finance service. Must be called after commissionService.
 */
export function initFinanceService() {
  logDiscountRules();
  runFinance();
}

/**
 * @returns {OrderFinancials[]}
 */
export function getOrderFinancials() {
  return orderFinancials;
}

/**
 * @returns {Map<string, number>} aggregatorId -> payout
 */
export function getPayoutsByAggregator() {
  return payoutsByAggregator;
}

/**
 * Summary totals (gross, net, commission, discount). For summary API.
 */
export function getSummaryTotals() {
  let totalGross = 0;
  let totalNet = 0;
  let totalCommission = 0;
  let totalDiscount = 0;
  for (const f of orderFinancials) {
    totalGross += f.grossRevenue;
    totalNet += f.netRevenue;
    totalCommission += f.commissionCost;
    totalDiscount += f.discountCost;
  }
  return {
    totalGrossRevenue: Number(totalGross.toFixed(2)),
    totalNetRevenue: Number(totalNet.toFixed(2)),
    totalCommissionCost: Number(totalCommission.toFixed(2)),
    totalDiscountCost: Number(totalDiscount.toFixed(2)),
  };
}
