/**
 * Central configuration for the Core Data Service.
 * Kept minimal for Milestone 1; extend for env-based config later.
 */

export const config = {
  port: Number(process.env.PORT) || 3000,
  seed: {
    /** Fixed seed for deterministic synthetic data. Do not change. */
    randomSeed: 42,
    cities: 2,
    storesPerCity: 3,
    brandsPerStore: 2,
    skusPerBrand: 30,
    customers: 4000,
    orders: 5000,
  },
  api: {
    version: 'v1',
    prefix: '/api/v1',
  },
};
