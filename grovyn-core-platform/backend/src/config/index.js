/**
 * Central configuration. All secrets and deployment-specific values from env.
 */

const isProduction = process.env.NODE_ENV === 'production';

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3001,
  /** Comma-separated allowed origins. In production defaults to Netlify app if unset. */
  corsOrigin:
    process.env.CORS_ORIGIN ||
    (isProduction ? 'https://grovyn-autopilot.netlify.app' : '*'),
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
