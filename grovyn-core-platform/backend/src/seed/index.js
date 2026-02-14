/**
 * Seed entry point. Runs the deterministic generator and returns the dataset.
 * Called once at server boot; data is passed into services.
 */

import { config } from '../config/index.js';
import { generateSeedData } from './generator.js';

/**
 * Run seed with config seed options. Throws if generation fails.
 * @returns {ReturnType<typeof generateSeedData>}
 */
export function runSeed() {
  const opts = {
    randomSeed: config.seed.randomSeed,
    cities: config.seed.cities,
    storesPerCity: config.seed.storesPerCity,
    brandsPerStore: config.seed.brandsPerStore,
    skusPerBrand: config.seed.skusPerBrand,
    customers: config.seed.customers,
    orders: config.seed.orders,
  };

  const data = generateSeedData(opts);

  if (!data.cities?.length || !data.stores?.length || !data.brands?.length ||
      !data.skus?.length || !data.customers?.length || !data.orders?.length) {
    throw new Error('Seed generation failed: one or more collections are empty. Check seed config.');
  }

  return data;
}

export { generateSeedData } from './generator.js';
export { createSeededRandom, int, pick, float } from './seededRandom.js';
