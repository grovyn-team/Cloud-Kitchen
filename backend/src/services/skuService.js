/**
 * SKU data access. Seeded data is injected at boot.
 */

/** @type {import('../models/index.js').SKU[]} */
let skus = [];

/**
 * @param {import('../models/index.js').SKU[]} data
 */
export function initSkuService(data) {
  skus = data;
}

/**
 * @returns {import('../models/index.js').SKU[]}
 */
export function getAllSkus() {
  return skus;
}

/**
 * @param {string} id
 * @returns {import('../models/index.js').SKU | undefined}
 */
export function getSkuById(id) {
  return skus.find((s) => s.id === id);
}

/**
 * @param {string} brandId
 * @returns {import('../models/index.js').SKU[]}
 */
export function getSkusByBrandId(brandId) {
  return skus.filter((s) => s.brandId === brandId);
}
