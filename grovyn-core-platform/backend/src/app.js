/**
 * Express app. No seed or server logic here; only middleware and route mounting.
 */

import express from 'express';
import cors from 'cors';
import v1Router from './routes/v1/index.js';

const app = express();

app.use(cors({ origin: true })); // allow same-origin and dev (e.g. http://localhost:5173)
app.use(express.json());

app.use(v1Router);

export default app;
