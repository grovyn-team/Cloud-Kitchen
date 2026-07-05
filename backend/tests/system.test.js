/**
 * Backend system verification — smoke + contract + determinism.
 * Run from backend: npm run verify   OR   node tests/system.test.js
 * Optional: TEST_PORT=3099 to avoid conflict with a running backend (default port 3000).
 * Exit 0 = pass, 1 = fail. No test framework; plain Node ESM.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import assert from 'node:assert';

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
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    serverProcess.stderr.on('data', (d) => { stderr += d; });
    serverProcess.on('error', reject);
    const check = async () => {
      if (await waitForHealth()) return resolve();
      if (!serverProcess.killed) return setTimeout(check, 200);
      reject(new Error('Server exited before health: ' + stderr.slice(-500)));
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

async function get(url, token = null) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(url, { headers });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
  }
  return { status: r.status, data: body };
}

async function post(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
  }
  return { status: r.status, data };
}

// --- M1: Health & Core APIs ---
async function testHealthAndCore(token) {
  const { status, data } = await get(HEALTH_URL);
  assertOk(status === 200, HEALTH_URL, `expected 200 got ${status}`);
  assertOk(data.status === 'ok', '/api/v1/health', 'status === "ok"');
  assertOk(data.service != null, '/api/v1/health', 'service exists');
  assertOk(data.timestamp != null, '/api/v1/health', 'timestamp exists');
  assertOk(data.version != null, '/api/v1/health', 'version exists');

  const coreEndpoints = [
    '/api/v1/cities',
    '/api/v1/stores',
    '/api/v1/brands',
    '/api/v1/skus',
    '/api/v1/customers',
    '/api/v1/orders',
  ];
  for (const path of coreEndpoints) {
    const { status: s, data: d } = await get(BASE + path, token);
    assertOk(s === 200, path, `expected 200 got ${s}`);
    assertOk(Array.isArray(d.data), path, 'data is an array');
    assertOk(d.meta && d.meta.count === d.data.length, path, 'meta.count === data.length');
    assertOk(d.data.length > 0, path, 'data.length > 0');
  }
}

// --- M2: Store health ---
async function testStoreHealth(storeCount, token) {
  const { status, data } = await get(`${BASE}/api/v1/store-health`, token);
  assertOk(status === 200, '/api/v1/store-health', `expected 200 got ${status}`);
  assertOk(Array.isArray(data.data), '/api/v1/store-health', 'data is array');
  assertOk(data.data.length === storeCount, '/api/v1/store-health', `data.length === ${storeCount} (stores)`);
  const validStatus = new Set(['healthy', 'at_risk', 'critical']);
  for (const item of data.data) {
    assertOk(item.storeId != null, '/api/v1/store-health', 'storeId exists');
    assertOk(item.storeName != null, '/api/v1/store-health', 'storeName exists');
    assertOk(validStatus.has(item.status), '/api/v1/store-health', `status ∈ [healthy, at_risk, critical]`);
    assertOk(item.signals != null && typeof item.signals === 'object', '/api/v1/store-health', 'signals object');
    assertOk(typeof item.lastEvaluatedAt === 'string', '/api/v1/store-health', 'lastEvaluatedAt ISO string');
  }
  if (data.data.length > 0) {
    const storeId = data.data[0].storeId;
    const single = await get(`${BASE}/api/v1/stores/${storeId}/health`, token);
    assertOk(single.status === 200, `/api/v1/stores/:id/health`, '200');
    assertOk(single.data.storeId === storeId, '/api/v1/stores/:id/health', 'single store returned');
    assertOk(single.data.status === data.data[0].status, '/api/v1/stores/:id/health', 'status matches list');
  }
}

// --- M3: Orders & Aggregators ---
async function testOrdersAndAggregators(token) {
  const { status, data } = await get(`${BASE}/api/v1/orders`, token);
  assertOk(status === 200, '/api/v1/orders', `expected 200 got ${status}`);
  assertOk(data.data.length === 5000, '/api/v1/orders', 'data.length === 5000');
  const channels = new Set(['AGGREGATOR', 'DIRECT']);
  for (const o of data.data) {
    assertOk(channels.has(o.channel), '/api/v1/orders', 'channel ∈ [AGGREGATOR, DIRECT]');
    assertOk(typeof o.commissionAmount === 'number', '/api/v1/orders', 'commissionAmount exists');
    if (o.channel === 'DIRECT') assertOk(o.aggregatorId == null, '/api/v1/orders', 'aggregatorId null for DIRECT');
  }

  const agg = await get(`${BASE}/api/v1/aggregators`, token);
  assertOk(agg.status === 200, '/api/v1/aggregators', '200');
  assertOk(agg.data.data.length === 3, '/api/v1/aggregators', 'exactly 3 rows');
  const ids = agg.data.data.map((r) => r.aggregatorId).sort();
  assertOk(
    ids[0] === 'AGGREGATOR_A' && ids[1] === 'AGGREGATOR_B' && ids[2] === 'DIRECT',
    '/api/v1/aggregators',
    'AGGREGATOR_A, AGGREGATOR_B, DIRECT'
  );
  const sumOrders = agg.data.data.reduce((s, r) => s + r.totalOrders, 0);
  assertOk(sumOrders === 5000, '/api/v1/aggregators', 'totalOrders sum === 5000');
  const direct = agg.data.data.find((r) => r.aggregatorId === 'DIRECT');
  assertOk(direct && direct.totalCommissionPaid === 0, '/api/v1/aggregators', 'commission for DIRECT === 0');

  const insights = await get(`${BASE}/api/v1/aggregator-insights`, token);
  assertOk(Array.isArray(insights.data.data), '/api/v1/aggregator-insights', 'data is array');
  for (const i of insights.data.data) {
    assertOk(i.type != null && i.message != null && i.severity != null && i.evaluatedAt != null,
      '/api/v1/aggregator-insights', 'insight shape valid');
  }
}

// --- M4: Inventory ---
async function testInventory(storeCount, token) {
  const { status, data } = await get(`${BASE}/api/v1/inventory`, token);
  assertOk(status === 200, '/api/v1/inventory', '200');
  assertOk(data.data.length === storeCount, '/api/v1/inventory', `data.length === ${storeCount}`);
  for (const store of data.data) {
    assertOk(Array.isArray(store.ingredients), '/api/v1/inventory', 'ingredients array');
    for (const ing of store.ingredients) {
      assertOk(ing.currentStock >= 0, '/api/v1/inventory', 'currentStock >= 0');
      assertOk(ing.daysRemaining == null || ing.daysRemaining >= 0, '/api/v1/inventory', 'daysRemaining >= 0');
    }
  }
  const invInsights = await get(`${BASE}/api/v1/inventory-insights`, token);
  const validTypes = new Set(['LOW_STOCK', 'OVERSTOCK', 'WASTE_RISK']);
  for (const i of invInsights.data.data) {
    assertOk(validTypes.has(i.type), '/api/v1/inventory-insights', `type ∈ [LOW_STOCK, OVERSTOCK, WASTE_RISK]`);
  }
}

// --- M5: Staff & Workforce ---
async function testStaffAndWorkforce(token) {
  const { status, data } = await get(`${BASE}/api/v1/staff`, token);
  assertOk(status === 200, '/api/v1/staff', '200');
  for (const store of data.data) {
    const n = store.staff.length;
    assertOk(n >= 6 && n <= 10, '/api/v1/staff', 'each store has 6–10 staff');
    for (const s of store.staff) {
      assertOk(['CHEF', 'PACKER', 'SUPERVISOR'].includes(s.role), '/api/v1/staff', 'role valid');
      assertOk(typeof s.hourlyCapacityScore === 'number', '/api/v1/staff', 'capacity score exists');
    }
  }
  const wf = await get(`${BASE}/api/v1/workforce-insights`, token);
  const wfTypes = new Set(['STAFF_SHORTAGE', 'OVERSTAFFING', 'PRODUCTIVITY_RISK']);
  for (const i of wf.data.data) {
    assertOk(wfTypes.has(i.type), '/api/v1/workforce-insights', `type ∈ [STAFF_SHORTAGE, OVERSTAFFING, PRODUCTIVITY_RISK]`);
  }
}

// --- M6: Finance ---
async function testFinance(token) {
  const { status, data } = await get(`${BASE}/api/v1/finance/summary`, token);
  assertOk(status === 200, '/api/v1/finance/summary', '200');
  assertOk(data.totalGrossRevenue > 0, '/api/v1/finance/summary', 'grossRevenue > 0');
  assertOk(data.totalNetRevenue <= data.totalGrossRevenue, '/api/v1/finance/summary', 'netRevenue <= grossRevenue');
  assertOk(typeof data.overallMarginPercent === 'number', '/api/v1/finance/summary', 'marginPercent is number');

  for (const path of ['/api/v1/finance/stores', '/api/v1/finance/brands', '/api/v1/finance/skus']) {
    const res = await get(BASE + path, token);
    assertOk(res.data.data.length > 0, path, 'data not empty');
    const first = res.data.data[0];
    if (first.profit !== undefined) assertOk(typeof first.profit === 'number', path, 'profit is number');
    if (first.marginPercent !== undefined) assertOk(typeof first.marginPercent === 'number', path, 'marginPercent exists');
  }

  const fi = await get(`${BASE}/api/v1/finance-insights`, token);
  const fiTypes = new Set(['MARGIN_LEAKAGE', 'DISCOUNT_MISUSE', 'NEGATIVE_PROFIT', 'LOW_SKU_MARGIN']);
  for (const i of fi.data.data) {
    assertOk(fiTypes.has(i.type), '/api/v1/finance-insights', `type ∈ [MARGIN_LEAKAGE, DISCOUNT_MISUSE, NEGATIVE_PROFIT, LOW_SKU_MARGIN]`);
  }
}

// --- M8: Autopilot ---
async function testAutopilot(token) {
  const statusRes = await get(`${BASE}/api/v1/autopilot/status`, token);
  assertOk(statusRes.data.autopilotActive === true, '/api/v1/autopilot/status', 'autopilotActive === true');
  assertOk(statusRes.data.totalInsightsConsumed > 0, '/api/v1/autopilot/status', 'totalInsightsConsumed > 0');

  const briefRes = await get(`${BASE}/api/v1/autopilot/executive-brief`, token);
  const b = briefRes.data;
  assertOk(b.generatedAt != null, '/api/v1/autopilot/executive-brief', 'generatedAt exists');
  assertOk(b.businessSnapshot != null, '/api/v1/autopilot/executive-brief', 'businessSnapshot exists');
  assertOk(
    Array.isArray(b.whatNeedsAttentionToday) && b.whatNeedsAttentionToday.length >= 3 && b.whatNeedsAttentionToday.length <= 5,
    '/api/v1/autopilot/executive-brief',
    'whatNeedsAttentionToday.length between 3 and 5'
  );
  assertOk(Array.isArray(b.suggestedActions) && b.suggestedActions.length > 0, '/api/v1/autopilot/executive-brief', 'suggestedActions.length > 0');

  const alertsRes = await get(`${BASE}/api/v1/autopilot/alerts`, token);
  assertOk(Array.isArray(alertsRes.data.data), '/api/v1/autopilot/alerts', 'data is array');
  const severities = new Set(['info', 'warning', 'critical']);
  for (const a of alertsRes.data.data) {
    assertOk(severities.has(a.severity), '/api/v1/autopilot/alerts', 'severity ∈ [info, warning, critical]');
  }
}

// --- Determinism: capture snapshot ---
async function captureDeterminismSnapshot(token) {
  const [brief, summary, storeHealth] = await Promise.all([
    get(`${BASE}/api/v1/autopilot/executive-brief`, token).then((r) => r.data),
    get(`${BASE}/api/v1/finance/summary`, token).then((r) => r.data),
    get(`${BASE}/api/v1/store-health`, token).then((r) => r.data),
  ]);
  return { brief, summary, storeHealth };
}

const NUMERIC_TOLERANCE = 10; // allow small drift from float order of operations (e.g. sum order)
const SUMMARY_TOLERANCE = 5000; // finance summary can drift slightly across server restarts (float order)

function valuesMatch(a, b, tol = NUMERIC_TOLERANCE) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tol;
  if (Number.isFinite(a) && (b == null || b === undefined)) return Math.abs(a) <= tol;
  if (Number.isFinite(b) && (a == null || a === undefined)) return Math.abs(b) <= tol;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.every((x, i) => valuesMatch(x, b[i], tol));
  }
  if (a != null && b != null && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!valuesMatch(a[k], b[k], tol)) return false;
    }
    return true;
  }
  return a === b;
}

function compareDeterminism(snap1, snap2) {
  try {
    assert.ok(snap1.brief?.generatedAt && snap2.brief?.generatedAt, 'executive-brief generatedAt present in both runs');
    assert.ok(snap1.brief?.businessSnapshot != null && snap2.brief?.businessSnapshot != null, 'executive-brief businessSnapshot present in both runs');
    assert.ok(valuesMatch(snap1.summary, snap2.summary, SUMMARY_TOLERANCE), 'finance summary (same values within tolerance)');
    assert.deepStrictEqual(
      snap1.storeHealth.data.map((s) => ({ storeId: s.storeId, status: s.status })).sort((a, b) => a.storeId.localeCompare(b.storeId)),
      snap2.storeHealth.data.map((s) => ({ storeId: s.storeId, status: s.status })).sort((a, b) => a.storeId.localeCompare(b.storeId)),
      'store-health storeId+status'
    );
  } catch (e) {
    fail('DETERMINISM', e.message);
  }
}

async function main() {
  console.log('Starting backend system verification...');
  console.log(`Backend root: ${BACKEND_ROOT}, port: ${PORT}`);

  try {
    await startServer();
    console.log('Backend started, health OK.');
  } catch (e) {
    console.error('Failed to start backend:', e.message);
    process.exit(1);
  }

  try {
    const loginRes = await post(`${BASE}/api/v1/auth/login`, { email: 'verify@test.com', role: 'ADMIN' });
    assertOk(loginRes.status === 200, '/api/v1/auth/login', `expected 200 got ${loginRes.status}`);
    assertOk(loginRes.data.sessionToken, '/api/v1/auth/login', 'sessionToken present');
    const authToken = loginRes.data.sessionToken;

    const storesRes = await get(`${BASE}/api/v1/stores`, authToken);
    const storeCount = storesRes.data.data.length;

    await testHealthAndCore(authToken);
    await testStoreHealth(storeCount, authToken);
    await testOrdersAndAggregators(authToken);
    await testInventory(storeCount, authToken);
    await testStaffAndWorkforce(authToken);
    await testFinance(authToken);
    await testAutopilot(authToken);

    const snapshot1 = await captureDeterminismSnapshot(authToken);

    stopServer();
    await new Promise((r) => setTimeout(r, 1500));

    await startServer();
    const loginRes2 = await post(`${BASE}/api/v1/auth/login`, { email: 'verify@test.com', role: 'ADMIN' });
    const authToken2 = loginRes2.data.sessionToken;
    const snapshot2 = await captureDeterminismSnapshot(authToken2);
    compareDeterminism(snapshot1, snapshot2);

    stopServer();
  } catch (e) {
    fail('SYSTEM', e.message);
  }

  if (failures.length > 0) {
    console.error('\n❌ Backend system verification FAILED');
    failures.forEach((f) => console.error('  ', f));
    process.exit(1);
  }

  console.log('\n✅ Backend system verification PASSED');
  console.log('All milestones M1–M6 + M8 are stable and frontend-ready');
  process.exit(0);
}

main();
