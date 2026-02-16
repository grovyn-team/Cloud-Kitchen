/**
 * Vercel serverless entry. Boots seed + services, then exports the Express app.
 * For local dev, run node src/server.js instead.
 *
 * Vercel serves this at /api, so paths like /api/v1/health arrive as /v1/health.
 * We prepend /api so Express routes (mounted at /api/v1) match.
 */
import { runBootstrap } from '../src/bootstrap.js';
import app from '../src/app.js';

runBootstrap();

export default function handler(req, res) {
  const path = req.url || req.path || '/';
  req.url = path.startsWith('/api') ? path : `/api${path.startsWith('/') ? path : `/${path}`}`;
  return app(req, res);
}
