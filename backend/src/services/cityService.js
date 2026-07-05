/**
 * City data access. Routes do not touch data directly; they use this service.
 * Seeded data is injected at boot.
 */

/** @type {import('../models/index.js').City[]} */
let cities = [];

/**
 * @param {import('../models/index.js').City[]} data
 */
export function initCityService(data) {
  cities = data;
}

/**
 * @returns {import('../models/index.js').City[]}
 */
export function getAllCities() {
  return cities;
}

/**
 * @param {string} id
 * @returns {import('../models/index.js').City | undefined}
 */
export function getCityById(id) {
  return cities.find((c) => c.id === id);
}
