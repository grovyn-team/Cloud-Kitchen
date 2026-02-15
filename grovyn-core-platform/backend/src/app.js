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

export default app;
