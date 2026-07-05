/**
 * Brand data access. Seeded data is injected at boot.
 */

/** @type {import('../models/index.js').Brand[]} */
let brands = [];

/**
 * @param {import('../models/index.js').Brand[]} data
 */
export function initBrandService(data) {
  brands = data;
}

/**
 * @returns {import('../models/index.js').Brand[]}
 */
export function getAllBrands() {
  return brands;
}

/**
 * @param {string} id
 * @returns {import('../models/index.js').Brand | undefined}
 */
export function getBrandById(id) {
  return brands.find((b) => b.id === id);
}

/**
 * @param {string} storeId
 * @returns {import('../models/index.js').Brand[]}
 */
export function getBrandsByStoreId(storeId) {
  return brands.filter((b) => b.storeId === storeId);
}
