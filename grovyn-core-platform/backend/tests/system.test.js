/**
 * Backend system verification — minimal DB-free boot smoke test.
 * Run from backend: npm run verify   OR   node tests/system.test.js
 * Optional: TEST_PORT=3099 to avoid conflict with a running backend (default port 3000).
 * Exit 0 = pass, 1 = fail. No test framework; plain Node ESM.
 *
 * REDUCED (Integration Task 2, retiring the legacy HMAC auth middleware):
 * this suite used to exercise a whole legacy in-memory API surface
 * (cities/stores/brands/skus/orders/store-health/aggregators/inventory/
 * staff/finance/autopilot), authenticated via the demo-login path
 * (`POST /api/v1/auth/demo-login`) that only that legacy middleware could
 * verify. Both the middleware and the demo-login route that was its only
 * token source are gone -- every route above them is unmounted, so there is
 * no longer any DB-free way to authenticate a request at all (real
 * `/auth/login` needs a live Postgres). What remains here is a genuine boot
 * check (server starts, health endpoint responds) plus a check that a
 * protected route correctly 401s with no token, without ever touching a
 * database. Real endpoint coverage for every DB-backed module now lives
 * entirely in `backend/tests/*.pgtest.mjs` (each spins up a throwaway
 * `postgres:16-alpine` container) -- this file cannot replace that
 * coverage and does not try to.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(__dirname, '..');
const PORT = Number(process.env.TEST_PORT) || 3000;
const BASE = `http://localhost:${PORT}`;
const HEALTH_URL = `${BASE}/api/v1/health`;
const WAIT_MS = 30;
const MAX_WAIT_MS = 15000;

let serverProcess = null;
const failures = [];

function fail(api, reason) {
  const msg = `${api}: ${reason}`;
  failures.push(msg);
  console.error('❌', msg);
}

function assertOk(condition, api, reason) {
  if (!condition) fail(api, reason);
}

async function waitForHealth() {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    try {
      const r = await fetch(HEALTH_URL);
      if (r.ok) return true;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, WAIT_MS));
  }
  return false;
}

function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn('node', ['src/server.js'], {
      cwd: BACKEND_ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        // `src/db/pool.js` throws at import time if this is unset (P1-04
        // wired it into the module graph `src/app.js` always loads) -- the
        // connection itself is opened lazily on first query, which this
        // DB-free suite never triggers, so a syntactically valid URL is
        // enough to boot.
        DATABASE_APP_URL: process.env.DATABASE_APP_URL || 'postgresql://unused:unused@localhost:5432/unused',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    serverProcess.stderr.on('data', (d) => { stderr += d; });
    serverProcess.on('error', reject);
    const check = async () => {
      if (await waitForHealth()) return resolve();
      reject(new Error('Server did not become healthy in time: ' + (stderr.slice(-500) || '(no stderr)')));
    };
    setTimeout(check, 500);
  });
}

function stopServer() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

async function get(url) {
  const r = await fetch(url);
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
  }
  return { status: r.status, data: body };
}

async function testHealth() {
  const { status, data } = await get(HEALTH_URL);
  assertOk(status === 200, HEALTH_URL, `expected 200 got ${status}`);
  assertOk(data.status === 'ok', '/api/v1/health', 'status === "ok"');
  assertOk(data.service != null, '/api/v1/health', 'service exists');
  assertOk(data.timestamp != null, '/api/v1/health', 'timestamp exists');
  assertOk(data.version != null, '/api/v1/health', 'version exists');
}

async function testProtectedRouteRejectsNoToken() {
  // No Authorization header at all -- requireSession must 401 before it
  // ever attempts a DB lookup, so this is legitimately DB-free.
  const { status } = await get(`${BASE}/api/v1/branches`);
  assertOk(status === 401, '/api/v1/branches (no token)', `expected 401 got ${status}`);
}

async function main() {
  console.log('Starting backend system verification (boot smoke test)...');
  console.log(`Backend root: ${BACKEND_ROOT}, port: ${PORT}`);

  try {
    await startServer();
    console.log('Backend started, health OK.');
  } catch (e) {
    console.error('Failed to start backend:', e.message);
    process.exit(1);
  }

  try {
    await testHealth();
    await testProtectedRouteRejectsNoToken();
    stopServer();
  } catch (e) {
    fail('SYSTEM', e.message);
    stopServer();
  }

  if (failures.length > 0) {
    console.error('\n❌ Backend system verification FAILED');
    failures.forEach((f) => console.error('  ', f));
    process.exit(1);
  }

  console.log('\n✅ Backend system verification PASSED (boot + health only -- see *.pgtest.mjs for real coverage)');
  process.exit(0);
}

main();
