/**
 * Inventory Insight Service — rule-based low stock, overstock, waste risk.
 * Reorder suggestions for LOW_STOCK. No AI/LLM; templates only. Deterministic.
 */

import * as inventoryService from './inventoryService.js';
import * as consumptionService from './consumptionService.js';
import * as skuService from './skuService.js';
import * as commissionService from './commissionService.js';

// --- Thresholds ---
const LOW_STOCK_DAYS_THRESHOLD = 2;
const OVERSTOCK_MULTIPLIER = 2; // currentStock > 2 × avg weekly consumption
const WASTE_LOW_ORDER_VOLUME_THRESHOLD = 30;

/**
 * @typedef {Object} InventoryInsight
 * @property {'LOW_STOCK'|'OVERSTOCK'|'WASTE_RISK'} type
 * @property {string} storeId
 * @property {string} ingredientId
 * @property {string} message
 * @property {'info'|'warning'|'critical'} severity
 * @property {string} evaluatedAt
 * @property {number} [suggestedReorderQuantity]
 */

/** @type {InventoryInsight[]} */
let insights = [];

/** Deterministic timestamp from evaluation */
let evaluatedAt = '';

function emitInsight(insight) {
  console.log('[INVENTORY_INSIGHT]', JSON.stringify(insight));
}

/**
 * Round to sensible units: kg/L to 2 decimals, pcs to integer.
 * @param {number} value
 * @param {string} unit
 * @returns {number}
 */
function roundToUnit(value, unit) {
  if (unit === 'pcs') return Math.max(0, Math.round(value));
  return Math.max(0, Math.round(value * 100) / 100);
}

/**
 * Build ingredientId -> [skuIds that use it] from all SKUs and BOMs.
 * @returns {Map<string, string[]>}
 */
function getIngredientToSkuIds() {
  const map = new Map();
  const skus = skuService.getAllSkus();
  for (const sku of skus) {
    const bom = inventoryService.getBOM(sku.id);
    for (const { ingredientId } of bom) {
      if (!map.has(ingredientId)) map.set(ingredientId, []);
      map.get(ingredientId).push(sku.id);
    }
  }
  return map;
}

/**
 * Initialize insights: run rules, cache results, log each. Must run after runConsumption().
 */
export function initInventoryInsightService() {
  const storeMap = inventoryService.getStoreInventoryMap();
  const orderCountBySku = consumptionService.getOrderCountBySkuId();
  const ingredientToSkuIds = getIngredientToSkuIds();

  const orders = commissionService.getOrdersWithCommission();
  const refDate =
    orders.length > 0
      ? orders.map((o) => o.createdAt.slice(0, 10)).reduce((a, b) => (a > b ? a : b), '')
      : new Date().toISOString().slice(0, 10);
  evaluatedAt = new Date(refDate + 'T12:00:00.000Z').toISOString();

  insights = [];

  for (const [storeId, inv] of storeMap) {
    for (const [ingredientId, row] of inv) {
      const meta = inventoryService.INGREDIENTS.find((i) => i.id === ingredientId);
      const unit = meta?.unit ?? 'kg';
      const avgDaily = row.avgDailyConsumption ?? 0;
      const avgWeekly = avgDaily * 7;
      const currentStock = row.currentStock;
      const daysRemaining = row.daysRemaining ?? (avgDaily > 0 ? currentStock / avgDaily : 999);

      // Low stock
      if (daysRemaining < LOW_STOCK_DAYS_THRESHOLD && daysRemaining < 999) {
        const suggestedReorder = roundToUnit(
          Math.max(0, avgWeekly - currentStock),
          unit
        );
        const insight = {
          type: 'LOW_STOCK',
          storeId,
          ingredientId,
          message: `Days of stock remaining (${daysRemaining.toFixed(1)}) below ${LOW_STOCK_DAYS_THRESHOLD}. Consider reordering.`,
          severity: daysRemaining < 1 ? 'critical' : 'warning',
          evaluatedAt,
          suggestedReorderQuantity: suggestedReorder,
        };
        insights.push(insight);
        emitInsight(insight);
      }

      // Overstock
      if (avgWeekly > 0 && currentStock > OVERSTOCK_MULTIPLIER * avgWeekly) {
        const insight = {
          type: 'OVERSTOCK',
          storeId,
          ingredientId,
          message: `Current stock (${currentStock.toFixed(2)} ${unit}) exceeds 2× average weekly consumption (${(avgWeekly).toFixed(2)} ${unit}).`,
          severity: 'info',
          evaluatedAt,
        };
        insights.push(insight);
        emitInsight(insight);
      }

      // Waste risk: ingredient used in SKUs with low order volume
      const skuIds = ingredientToSkuIds.get(ingredientId) ?? [];
      const totalOrdersForIngredient = skuIds.reduce((s, sid) => s + (orderCountBySku.get(sid) ?? 0), 0);
      if (skuIds.length > 0 && totalOrdersForIngredient < WASTE_LOW_ORDER_VOLUME_THRESHOLD) {
        const insight = {
          type: 'WASTE_RISK',
          storeId,
          ingredientId,
          message: `Ingredient used in SKUs with low total order volume (${totalOrdersForIngredient} orders). Risk of waste if not used.`,
          severity: totalOrdersForIngredient < 10 ? 'warning' : 'info',
          evaluatedAt,
        };
        insights.push(insight);
        emitInsight(insight);
      }
    }
  }
}

/**
 * @returns {InventoryInsight[]}
 */
export function getInventoryInsights() {
  return insights;
}
