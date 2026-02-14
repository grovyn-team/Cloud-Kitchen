/**
 * Customer data access. Seeded data is injected at boot.
 */

/** @type {import('../models/index.js').Customer[]} */
let customers = [];

/**
 * @param {import('../models/index.js').Customer[]} data
 */
export function initCustomerService(data) {
  customers = data;
}

/**
 * @returns {import('../models/index.js').Customer[]}
 */
export function getAllCustomers() {
  return customers;
}

/**
 * @param {string} id
 * @returns {import('../models/index.js').Customer | undefined}
 */
export function getCustomerById(id) {
  return customers.find((c) => c.id === id);
}
