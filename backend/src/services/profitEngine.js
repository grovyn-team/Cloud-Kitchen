/**
 * Profit Engine — store, brand, SKU profit and margin. Cost attribution from existing modules.
 * Deterministic; all numbers traceable and explainable.
 */

import * as financeService from './financeService.js';
import * as commissionService from './commissionService.js';
import * as consumptionService from './consumptionService.js';
import * as shiftService from './shiftService.js';
import * as inventoryService from './inventoryService.js';
import * as skuService from './skuService.js';

const BASE_HOURLY_RATE = 10;
const SHIFT_HOURS = 7;

/** Ingredient unit cost (per kg, per L, per pc). Deterministic constants. */
const INGREDIENT_UNIT_COST = {
  ing_chicken: 5,
  ing_rice: 2,
  ing_oil: 3,
  ing_spices: 8,
  ing_packaging: 0.5,
  ing_vegetables: 2,
  ing_sauce: 4,
  ing_flour: 1.5,
  ing_dairy: 2,
  ing_lentils: 3,
};

/** @type {Array<{ storeId: string, grossRevenue: number, netRevenue: number, ingredientCost: number, laborCost: number, profit: number, marginPercent: number }>} */
let storeProfitability = [];

/** @type {Array<{ brandId: string, grossRevenue: number, netRevenue: number, ingredientCost: number, laborCost: number, profit: number, marginPercent: number }>} */
let brandProfitability = [];

/** @type {Array<{ skuId: string, revenue: number, ingredientCost: number, margin: number, marginPercent?: number }>} */
let skuMargins = [];

/** Cached summary (total profit, margin %) */
let summaryCache = null;

function logLaborRate() {
  console.log('Base labor cost rate:', BASE_HOURLY_RATE, 'units/hour; shift hours:', SHIFT_HOURS);
}

/**
 * Store-level ingredient cost from consumption × unit cost.
 */
function getStoreIngredientCost(consumed) {
  let cost = 0;
  for (const [ingredientId, quantity] of consumed) {
    const unitCost = INGREDIENT_UNIT_COST[ingredientId] ?? 0;
    cost += quantity * unitCost;
  }
  return Number(cost.toFixed(2));
}

/**
 * Labor cost per store: sum over shifts of utilization × baseRate × shiftHours.
 */
function getStoreLaborCost(storeId) {
  const metrics = shiftService.getShiftMetricsByStore(storeId);
  let cost = 0;
  for (const m of metrics) {
    cost += m.utilization * BASE_HOURLY_RATE * SHIFT_HOURS;
  }
  return Number(cost.toFixed(2));
}

/**
 * Build store profitability.
 */
function runStoreProfitability() {
  const financials = financeService.getOrderFinancials();
  const consumed = consumptionService.getTotalConsumedByStoreIngredient();

  const byStore = new Map();
  for (const f of financials) {
    if (!byStore.has(f.storeId)) {
      byStore.set(f.storeId, { gross: 0, net: 0 });
    }
    const s = byStore.get(f.storeId);
    s.gross += f.grossRevenue;
    s.net += f.netRevenue;
  }

  storeProfitability = [];
  for (const [storeId, rev] of byStore) {
    const byIng = consumed.get(storeId);
    const ingredientCost = byIng ? getStoreIngredientCost(byIng) : 0;
    const laborCost = getStoreLaborCost(storeId);
    const profit = Number((rev.net - ingredientCost - laborCost).toFixed(2));
    const marginPercent = rev.gross > 0 ? Number(((profit / rev.gross) * 100).toFixed(2)) : 0;
    storeProfitability.push({
      storeId,
      grossRevenue: Number(rev.gross.toFixed(2)),
      netRevenue: Number(rev.net.toFixed(2)),
      ingredientCost,
      laborCost,
      profit,
      marginPercent,
    });
  }
}

/**
 * Brand profitability: net revenue by brand, allocate store ingredient + labor by revenue share.
 */
function runBrandProfitability() {
  const financials = financeService.getOrderFinancials();
  const storeProfit = new Map(storeProfitability.map((s) => [s.storeId, s]));

  const byBrand = new Map();
  const brandStoreGross = new Map();
  for (const f of financials) {
    const key = f.brandId;
    if (!byBrand.has(key)) {
      byBrand.set(key, { gross: 0, net: 0, byStore: new Map() });
    }
    const b = byBrand.get(key);
    b.gross += f.grossRevenue;
    b.net += f.netRevenue;
    b.byStore.set(f.storeId, (b.byStore.get(f.storeId) ?? 0) + f.grossRevenue);
  }

  brandProfitability = [];
  for (const [brandId, b] of byBrand) {
    let ingredientCost = 0;
    let laborCost = 0;
    for (const [storeId, brandGrossInStore] of b.byStore) {
      const store = storeProfit.get(storeId);
      if (!store || store.grossRevenue === 0) continue;
      const share = brandGrossInStore / store.grossRevenue;
      ingredientCost += store.ingredientCost * share;
      laborCost += store.laborCost * share;
    }
    const profit = Number((b.net - ingredientCost - laborCost).toFixed(2));
    const marginPercent = b.gross > 0 ? Number(((profit / b.gross) * 100).toFixed(2)) : 0;
    brandProfitability.push({
      brandId,
      grossRevenue: Number(b.gross.toFixed(2)),
      netRevenue: Number(b.net.toFixed(2)),
      ingredientCost: Number(ingredientCost.toFixed(2)),
      laborCost: Number(laborCost.toFixed(2)),
      profit,
      marginPercent,
    });
  }
}

/**
 * SKU contribution margin: revenue and ingredient cost per SKU (pre-labor).
 * Order->SKU assignment identical to consumption (same sort and index).
 */
function runSkuMargins() {
  const orders = commissionService.getOrdersWithCommission();
  const sorted = [...orders].sort((a, b) => {
    const d = a.createdAt.localeCompare(b.createdAt);
    return d !== 0 ? d : a.orderId.localeCompare(b.orderId);
  });
  const financialsByOrderId = new Map(financeService.getOrderFinancials().map((f) => [f.orderId, f]));
  const skuRevenue = new Map();
  const skuIngredientCost = new Map();
  const skuCommission = new Map();

  for (let i = 0; i < sorted.length; i++) {
    const order = sorted[i];
    const f = financialsByOrderId.get(order.orderId);
    if (!f) continue;
    const brandSkus = skuService.getSkusByBrandId(order.brandId);
    if (brandSkus.length === 0) continue;
    const sku = brandSkus[i % brandSkus.length];
    const skuId = sku.id;
    skuRevenue.set(skuId, (skuRevenue.get(skuId) ?? 0) + f.grossRevenue);
    skuCommission.set(skuId, (skuCommission.get(skuId) ?? 0) + f.commissionCost);
    const bom = inventoryService.getBOM(skuId);
    let cost = 0;
    for (const { ingredientId, quantityPerOrder } of bom) {
      cost += quantityPerOrder * (INGREDIENT_UNIT_COST[ingredientId] ?? 0);
    }
    skuIngredientCost.set(skuId, (skuIngredientCost.get(skuId) ?? 0) + cost);
  }

  skuMargins = [];
  const allSkuIds = new Set([...skuRevenue.keys(), ...skuIngredientCost.keys(), ...skuCommission.keys()]);
  for (const skuId of allSkuIds) {
    const revenue = Number((skuRevenue.get(skuId) ?? 0).toFixed(2));
    const ingredientCost = Number((skuIngredientCost.get(skuId) ?? 0).toFixed(2));
    const commission = Number((skuCommission.get(skuId) ?? 0).toFixed(2));
    const margin = Number((revenue - ingredientCost - commission).toFixed(2));
    const marginPercent = revenue > 0 ? Number(((margin / revenue) * 100).toFixed(2)) : 0;
    skuMargins.push({
      skuId,
      revenue,
      ingredientCost,
      commission,
      margin,
      marginPercent,
    });
  }
}

/**
 * Initialize profit engine: compute store, brand, SKU profitability.
 * Must be called after financeService, consumptionService, shiftService.
 */
export function initProfitEngine() {
  logLaborRate();
  runStoreProfitability();
  runBrandProfitability();
  runSkuMargins();
  const totals = financeService.getSummaryTotals();
  const totalProfit = storeProfitability.reduce((s, p) => s + p.profit, 0);
  summaryCache = {
    ...totals,
    totalProfit: Number(totalProfit.toFixed(2)),
    overallMarginPercent:
      totals.totalGrossRevenue > 0
        ? Number(((totalProfit / totals.totalGrossRevenue) * 100).toFixed(2))
        : 0,
  };
}

export function getFinanceSummary() {
  return summaryCache;
}

export function getStoreProfitability() {
  return storeProfitability;
}

export function getBrandProfitability() {
  return brandProfitability;
}

export function getSkuMargins() {
  return skuMargins;
}
