/**
 * Consumption Service — translates orders into ingredient consumption per store.
 * Groups orders by day, assigns each order to a SKU (by brand), reduces inventory via BOM.
 * Computes daily average consumption and days of stock remaining. Deterministic.
 */

import * as commissionService from './commissionService.js';
import * as inventoryService from './inventoryService.js';
import * as skuService from './skuService.js';

/** @type {Map<string, Map<string, number>>} storeId -> ingredientId -> totalConsumed */
const totalConsumedByStoreIngredient = new Map();

/** @type {Map<string, number>} skuId -> order count (for waste-risk insight) */
const orderCountBySkuId = new Map();

/**
 * Run full consumption simulation: for each order, assign SKU, apply BOM consumption, then set derived metrics.
 * Must be called after initInventoryService and commissionService (orders with commission).
 */
export function runConsumption() {
  const orders = commissionService.getOrdersWithCommission();
  if (orders.length === 0) return;

  const dateSet = new Set();
  for (const o of orders) dateSet.add(o.createdAt.slice(0, 10));
  const sortedDates = [...dateSet].sort();
  const minDate = sortedDates[0];
  const maxDate = sortedDates[sortedDates.length - 1];
  const numDays = sortedDates.length;

  // Sort orders by (createdAt, orderId) for deterministic processing
  const sortedOrders = [...orders].sort((a, b) => {
    const d = a.createdAt.localeCompare(b.createdAt);
    return d !== 0 ? d : a.orderId.localeCompare(b.orderId);
  });

  // Reset consumption totals for this run
  totalConsumedByStoreIngredient.clear();
  orderCountBySkuId.clear();

  for (let i = 0; i < sortedOrders.length; i++) {
    const order = sortedOrders[i];
    const brandSkus = skuService.getSkusByBrandId(order.brandId);
    if (brandSkus.length === 0) continue;
    const sku = brandSkus[i % brandSkus.length];
    orderCountBySkuId.set(sku.id, (orderCountBySkuId.get(sku.id) ?? 0) + 1);
    const bom = inventoryService.getBOM(sku.id);

    for (const { ingredientId, quantityPerOrder } of bom) {
      inventoryService.consume(order.storeId, ingredientId, quantityPerOrder);

      if (!totalConsumedByStoreIngredient.has(order.storeId)) {
        totalConsumedByStoreIngredient.set(order.storeId, new Map());
      }
      const byIng = totalConsumedByStoreIngredient.get(order.storeId);
      byIng.set(ingredientId, (byIng.get(ingredientId) ?? 0) + quantityPerOrder);
    }
  }

  // Set derived metrics: avgDailyConsumption, daysRemaining
  const storeMap = inventoryService.getStoreInventoryMap();
  for (const [storeId, byIngredient] of totalConsumedByStoreIngredient) {
    const inv = storeMap.get(storeId);
    if (!inv) continue;
    for (const [ingredientId, totalConsumed] of byIngredient) {
      const avgDailyConsumption = numDays > 0 ? totalConsumed / numDays : 0;
      const currentStock = inventoryService.getCurrentStock(storeId, ingredientId);
      const daysRemaining =
        avgDailyConsumption > 0 ? currentStock / avgDailyConsumption : (currentStock > 0 ? 999 : 0);
      inventoryService.setDerivedMetrics(storeId, ingredientId, avgDailyConsumption, daysRemaining);
    }
  }

  // Ensure all (store, ingredient) rows have derived metrics (some may have zero consumption)
  for (const [storeId, inv] of storeMap) {
    for (const [ingredientId, row] of inv) {
      if (row.avgDailyConsumption != null && row.daysRemaining != null) continue;
      const byIng = totalConsumedByStoreIngredient.get(storeId);
      const totalConsumed = byIng?.get(ingredientId) ?? 0;
      const avgDailyConsumption = numDays > 0 ? totalConsumed / numDays : 0;
      const daysRemaining =
        avgDailyConsumption > 0 ? row.currentStock / avgDailyConsumption : (row.currentStock > 0 ? 999 : 0);
      inventoryService.setDerivedMetrics(storeId, ingredientId, avgDailyConsumption, daysRemaining);
    }
  }
}

/**
 * Order count per SKU (from last consumption run). For waste-risk insight.
 * @returns {Map<string, number>}
 */
export function getOrderCountBySkuId() {
  return orderCountBySkuId;
}

/**
 * Total quantity consumed per (store, ingredient). For profit engine ingredient cost.
 * @returns {Map<string, Map<string, number>>} storeId -> ingredientId -> quantity
 */
export function getTotalConsumedByStoreIngredient() {
  const out = new Map();
  for (const [storeId, byIng] of totalConsumedByStoreIngredient) {
    out.set(storeId, new Map(byIng));
  }
  return out;
}
