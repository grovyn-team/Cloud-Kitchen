/**
 * Store data access. Seeded data is injected at boot.
 */

/** @type {import('../models/index.js').Store[]} */
let stores = [];

/**
 * @param {import('../models/index.js').Store[]} data
 */
export function initStoreService(data) {
  stores = data;
}

/**
 * @returns {import('../models/index.js').Store[]}
 */
export function getAllStores() {
  return stores;
}

/**
 * @param {string} id
 * @returns {import('../models/index.js').Store | undefined}
 */
export function getStoreById(id) {
  return stores.find((s) => s.id === id);
}

/**
 * @param {string} cityId
 * @returns {import('../models/index.js').Store[]}
 */
export function getStoresByCityId(cityId) {
  return stores.filter((s) => s.cityId === cityId);
}

/**
 * Parse operatingHours string (e.g. "08:00-22:00") to hours per day.
 * Used for baseline capacity and load factor calculations.
 * @param {string} operatingHours
 * @returns {number} Hours per day (e.g. 14)
 */
export function getOperatingHoursAsHours(operatingHours) {
  if (!operatingHours || typeof operatingHours !== 'string') return 0;
  const match = operatingHours.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  const [, sh, sm, eh, em] = match.map(Number);
  const startMins = sh * 60 + sm;
  const endMins = eh * 60 + em;
  const durationMins = endMins > startMins ? endMins - startMins : 24 * 60 - startMins + endMins;
  return Math.round((durationMins / 60) * 100) / 100;
}
