/**
 * Core Data Service — unified data models.
 * These define what exists in the system. No ORM; plain structures.
 * Every future module (orders, inventory, staff, finance, AI) depends on these.
 */

/**
 * @typedef {Object} City
 * @property {string} id
 * @property {string} name
 * @property {string} country
 * @property {string} timezone
 */

/**
 * @typedef {Object} Store
 * @property {string} id
 * @property {string} cityId
 * @property {string} name
 * @property {'active'|'paused'|'maintenance'} status
 * @property {string} operatingHours
 */

/**
 * @typedef {Object} Brand
 * @property {string} id
 * @property {string} storeId
 * @property {string} name
 * @property {number} commissionRate
 */

/**
 * @typedef {Object} SKU
 * @property {string} id
 * @property {string} brandId
 * @property {string} name
 * @property {number} price
 * @property {number} cost
 */

/**
 * @typedef {Object} Customer
 * @property {string} id
 * @property {string} phone
 * @property {string} createdAt
 */

/**
 * @typedef {Object} Order
 * @property {string} id
 * @property {string} storeId
 * @property {string} brandId
 * @property {string} customerId
 * @property {number} totalAmount
 * @property {number} commissionAmount
 * @property {string} createdAt
 */

/** Field names for validation / documentation; not runtime enforcement in M1 */
export const modelNames = {
  City: 'City',
  Store: 'Store',
  Brand: 'Brand',
  SKU: 'SKU',
  Customer: 'Customer',
  Order: 'Order',
};

export {}; // keep ES module
