/**
 * Vercel serverless entry. Boots seed + services, then exports the Express app.
 * For local dev, run node src/server.js instead.
 */
import { runBootstrap } from '../src/bootstrap.js';
import app from '../src/app.js';

runBootstrap();
export default app;
