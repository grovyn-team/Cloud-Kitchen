/**
 * Central configuration. All secrets and deployment-specific values from env.
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

const isProduction = process.env.NODE_ENV === 'production';

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3001,
  /** Identifier reported by the health endpoint. Set per client for multi-tenant observability. */
  serviceName: process.env.SERVICE_NAME || 'grovyn-autopilot',
  /** Read from package.json so the health endpoint and config stay in sync with the deployed build. */
  version: pkg.version,
  /**
   * Comma-separated allowed origins. Falls back to this instance's known origins when unset —
   * every other client deployment MUST set CORS_ORIGIN explicitly (see .env.example).
   */
  corsOrigin:
    process.env.CORS_ORIGIN ||
    (isProduction
      ? 'https://autopilot.grovyn.in,https://grovyn-autopilot.netlify.app,http://localhost:5173'
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
  /** For stateless session tokens (required on serverless, e.g. Vercel). Set SESSION_SECRET in production. */
  sessionSecret: process.env.SESSION_SECRET || 'demo-secret-change-in-production',
  auth: {
    /** Demo email/password login. Override per client via env; set demoEnabled=false to disable it entirely. */
    demoPassword: process.env.AUTH_DEMO_PASSWORD || 'grovyn@123',
    demoEnabled: process.env.AUTH_DEMO_ENABLED !== 'false',
  },
};
