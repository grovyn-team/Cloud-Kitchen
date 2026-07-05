/**
 * Order data access. Seeded data is injected at boot.
 */

/** @type {import('../models/index.js').Order[]} */
let orders = [];

/**
 * @param {import('../models/index.js').Order[]} data
 */
export function initOrderService(data) {
  orders = data;
}

/**
 * @returns {import('../models/index.js').Order[]}
 */
export function getAllOrders() {
  return orders;
}

/**
 * @param {string} id
 * @returns {import('../models/index.js').Order | undefined}
 */
export function getOrderById(id) {
  return orders.find((o) => o.id === id);
}

/**
 * @param {string} storeId
 * @returns {import('../models/index.js').Order[]}
 */
export function getOrdersByStoreId(storeId) {
  return orders.filter((o) => o.storeId === storeId);
}
