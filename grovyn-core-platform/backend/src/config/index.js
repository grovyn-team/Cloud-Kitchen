/**
 * Central configuration. All secrets and deployment-specific values from env.
 */

const isProduction = process.env.NODE_ENV === 'production';

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3001,
  /** Comma-separated allowed origins. Production default: Netlify app + local dev (localhost:5173). */
  corsOrigin:
    process.env.CORS_ORIGIN ||
    (isProduction
      ? 'https://grovyn-autopilot.netlify.app,http://localhost:5173'
      : '*'),
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
