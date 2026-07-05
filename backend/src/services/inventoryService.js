/**
 * Inventory Service — ingredient-level stock per store, BOM (SKU → ingredients).
 * Seeded at boot; consumption reduces stock via consume(). Deterministic.
 */

import { createSeededRandom, float, int } from '../seed/seededRandom.js';
import { config } from '../config/index.js';

/** Global ingredient definitions. Same set for all stores. */
export const INGREDIENTS = [
  { id: 'ing_chicken', name: 'Chicken', unit: 'kg' },
  { id: 'ing_rice', name: 'Rice', unit: 'kg' },
  { id: 'ing_oil', name: 'Oil', unit: 'L' },
  { id: 'ing_spices', name: 'Spices', unit: 'kg' },
  { id: 'ing_packaging', name: 'Packaging', unit: 'pcs' },
  { id: 'ing_vegetables', name: 'Vegetables', unit: 'kg' },
  { id: 'ing_sauce', name: 'Sauce', unit: 'L' },
  { id: 'ing_flour', name: 'Flour', unit: 'kg' },
  { id: 'ing_dairy', name: 'Dairy', unit: 'L' },
  { id: 'ing_lentils', name: 'Lentils', unit: 'kg' },
];

/** @type {Map<string, { ingredientId: string, quantityPerOrder: number }[]>} */
const bomBySkuId = new Map();

/** @type {Map<string, Map<string, { currentStock: number, reorderThreshold: number, maxCapacity: number, avgDailyConsumption?: number, daysRemaining?: number }>>} */
const storeInventory = new Map();

/** Ingredient id → { name, unit } for snapshot */
const ingredientMeta = new Map(INGREDIENTS.map((i) => [i.id, { name: i.name, unit: i.unit }]));

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return h >>> 0;
}

/**
 * Build deterministic BOM for a SKU. Explicit mapping: 2–4 ingredients, sensible quantities.
 * @param {string} skuId
 * @returns {{ ingredientId: string, quantityPerOrder: number }[]}
 */
function buildBOM(skuId) {
  if (bomBySkuId.has(skuId)) return bomBySkuId.get(skuId);
  const seed = (hashString(skuId) + config.seed.randomSeed) >>> 0;
  const rng = createSeededRandom(seed);
  const numIngredients = int(rng, 2, 4);
  const picked = new Set();
  const list = [];
  while (list.length < numIngredients) {
    const ing = INGREDIENTS[int(rng, 0, INGREDIENTS.length - 1)];
    if (picked.has(ing.id)) continue;
    picked.add(ing.id);
    let qty;
    if (ing.unit === 'pcs') qty = int(rng, 1, 3);
    else if (ing.unit === 'L') qty = float(rng, 0.02, 0.15, 2);
    else qty = float(rng, 0.05, 0.4, 2);
    list.push({ ingredientId: ing.id, quantityPerOrder: qty });
  }
  bomBySkuId.set(skuId, list);
  return list;
}

/**
 * Get BOM for a SKU (ingredientId, quantityPerOrder). Deterministic.
 * @param {string} skuId
 * @returns {{ ingredientId: string, quantityPerOrder: number }[]}
 */
export function getBOM(skuId) {
  return buildBOM(skuId);
}

/**
 * Initialize inventory per store: seed currentStock between reorderThreshold and maxCapacity.
 * Must be called after initServices.
 * @param {import('./storeService.js')} storeSvc
 */
export function initInventoryService(storeSvc) {
  const stores = storeSvc.getAllStores();
  const seed = config.seed.randomSeed;

  for (const store of stores) {
    const inv = new Map();
    for (const ing of INGREDIENTS) {
      const rng = createSeededRandom((hashString(store.id + ing.id) + seed) >>> 0);
      const reorderThreshold = 5;
      const maxCapacity = 50 + int(rng, 0, 50);
      const currentStock = int(rng, reorderThreshold + 1, Math.max(reorderThreshold + 2, maxCapacity - 1));
      inv.set(ing.id, {
        currentStock,
        reorderThreshold,
        maxCapacity,
      });
    }
    storeInventory.set(store.id, inv);
  }
}

/**
 * Reduce stock by quantity. Floors at 0. Deterministic.
 * @param {string} storeId
 * @param {string} ingredientId
 * @param {number} quantity
 */
export function consume(storeId, ingredientId, quantity) {
  const inv = storeInventory.get(storeId);
  if (!inv) return;
  const row = inv.get(ingredientId);
  if (!row) return;
  row.currentStock = Math.max(0, Number((row.currentStock - quantity).toFixed(3)));
}

/**
 * @param {string} storeId
 * @param {string} ingredientId
 * @returns {number}
 */
export function getCurrentStock(storeId, ingredientId) {
  const inv = storeInventory.get(storeId);
  if (!inv) return 0;
  const row = inv.get(ingredientId);
  return row ? row.currentStock : 0;
}

/**
 * Set derived metrics after consumption run.
 * @param {string} storeId
 * @param {string} ingredientId
 * @param {number} avgDailyConsumption
 * @param {number} daysRemaining
 */
export function setDerivedMetrics(storeId, ingredientId, avgDailyConsumption, daysRemaining) {
  const inv = storeInventory.get(storeId);
  if (!inv) return;
  const row = inv.get(ingredientId);
  if (!row) return;
  row.avgDailyConsumption = avgDailyConsumption;
  row.daysRemaining = daysRemaining;
}

/**
 * Get full snapshot for API: store-wise inventory, ingredient stock, days remaining.
 * @returns {Array<{ storeId: string, ingredients: Array<{ ingredientId: string, ingredientName: string, unit: string, currentStock: number, reorderThreshold: number, maxCapacity: number, avgDailyConsumption?: number, daysRemaining?: number }> }>}
 */
export function getInventorySnapshot() {
  const out = [];
  for (const [storeId, inv] of storeInventory) {
    const ingredients = [];
    for (const [ingredientId, row] of inv) {
      const meta = ingredientMeta.get(ingredientId);
      ingredients.push({
        ingredientId,
        ingredientName: meta?.name ?? ingredientId,
        unit: meta?.unit ?? 'kg',
        currentStock: row.currentStock,
        reorderThreshold: row.reorderThreshold,
        maxCapacity: row.maxCapacity,
        ...(row.avgDailyConsumption != null && { avgDailyConsumption: Number(row.avgDailyConsumption.toFixed(4)) }),
        ...(row.daysRemaining != null && { daysRemaining: Number(row.daysRemaining.toFixed(2)) }),
      });
    }
    out.push({ storeId, ingredients });
  }
  return out;
}

/**
 * Get store inventory map for insight service (currentStock, avgDailyConsumption, etc.).
 * @returns {Map<string, Map<string, { currentStock: number, reorderThreshold: number, maxCapacity: number, avgDailyConsumption?: number, daysRemaining?: number }>>}
 */
export function getStoreInventoryMap() {
  return storeInventory;
}

/**
 * Total number of ingredients tracked (across all stores: unique ingredient ids).
 * @returns {number}
 */
export function getTotalIngredientsTracked() {
  return INGREDIENTS.length;
}

/**
 * Number of stores with inventory initialized.
 * @returns {number}
 */
export function getStoresWithInventoryCount() {
  return storeInventory.size;
}
