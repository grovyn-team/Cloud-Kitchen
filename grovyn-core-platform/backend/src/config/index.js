/**
 * Central configuration. All secrets and deployment-specific values from env.
 */

const isProduction = process.env.NODE_ENV === 'production';

// P1-04 / D-005 / SEC-01: SESSION_SECRET previously defaulted to a public
// literal ('demo-secret-change-in-production') if unset -- the baseline
// OWASP review's SEC-01 finding. That default is removed entirely, no
// fallback of any kind: an unset SESSION_SECRET now fails the process at
// import time (fail loudly at boot), the same "fail closed on missing
// config" discipline `src/db/pool.js` already applies to DATABASE_APP_URL.
// This still gates the legacy in-memory HMAC session signer
// (`src/middleware/authMiddleware.js`, used by the demo-only login path
// gated below) -- it has nothing to do with the real DB-backed session
// tokens (`src/services/sessionService.js`), which are random + hashed, not
// signed.
if (!process.env.SESSION_SECRET) {
  throw new Error(
    '[config] SESSION_SECRET is not set. The app refuses to boot without it ' +
      '(D-005 / SEC-01 -- previously fell back to a public default literal, ' +
      'a critical finding in SECURITY_REVIEWS/000-baseline-owasp.md). Set a ' +
      'long random value, e.g.: ' +
      "node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\" " +
      'and put it in SESSION_SECRET. See backend/.env.example.'
  );
}

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3001,
  /** Comma-separated allowed origins. Production default: autopilot.grovyn.in, Netlify app + local dev. */
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
  /** Signs the legacy in-memory demo session tokens ONLY. No fallback -- see the boot check above. */
  sessionSecret: process.env.SESSION_SECRET,
  auth: {
    // P1-08 / item 10: the old demo/seed login path (shared password,
    // client-asserted role) must be genuinely unreachable unless explicitly
    // opted into -- defaults DISABLED. `=== 'true'` (not a truthy check) so
    // any value other than the literal string 'true' (including a typo, or
    // being merely *set* to something) stays disabled -- fail closed on
    // ambiguous config, not fail open.
    demoModeEnabled: process.env.AUTH_DEMO_MODE === 'true',
  },
};
