/**
 * Express app. No seed or server logic here; only middleware and route mounting.
 */

import express from 'express';
import cors from 'cors';
import v1Router from './routes/v1/index.js';
import { config } from './config/index.js';

const app = express();

const corsOptions = (() => {
  const o = config.corsOrigin;
  if (!o || o === '*') return { origin: true };
  const origins = o.split(',').map((s) => s.trim()).filter(Boolean);
  return { origin: origins.length ? origins : true, credentials: true };
})();
app.use(cors(corsOptions));
app.use(express.json());

app.use(v1Router);

// Generic error handler (P2-02). Previously missing entirely -- any error
// passed to `next(err)` (e.g. `withTenantContext`'s catch path,
// `middleware/tenantContext.js`) fell through to Express's own default
// handler, which sends the error message (and, outside production, a stack
// trace) as an HTML response. That violates this codebase's own "no leaking
// stack traces or internal details to clients" rule and is exactly the
// shape `tests/auth.pgtest.mjs`'s test harness already works around with its
// own local error handler -- mounted here for real so every route (not just
// a test app) gets the same generic, no-detail-leaked JSON shape.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[app] unhandled error', err);
  res.status(500).json({ error: 'InternalServerError', message: 'Something went wrong.' });
});

export default app;
