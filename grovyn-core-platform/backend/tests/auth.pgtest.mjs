/**
 * P1-04 — real-Postgres verification for real authentication:
 *   - src/services/authService.js (login orchestration)
 *   - src/services/passwordService.js (argon2id hash/verify + timing-oracle
 *     mitigation)
 *   - src/services/sessionService.js (token issuance/refresh/revoke)
 *   - src/middleware/sessionAuth.js (requireSession, requireBranchAccess)
 *   - src/db/preContext.js (runPreContextQuery)
 *   - drizzle/0003-0005 (branch, staff_branch_access, the
 *     resolve_session_by_token_hash resolver)
 *   - src/config/index.js (mandatory SESSION_SECRET)
 *   - the AUTH_DEMO_MODE gate (P1-08)
 *
 * NOT part of `npm run verify` (no DB dependency there). Run explicitly:
 *
 *   npm run test:auth
 *
 * against a real Postgres with migrations 0000-0005 + bootstrap-roles.sql
 * applied (same container the sibling P1-02/P1-03 suites use). This suite
 * SELF-SEEDS its own fixtures (a dedicated tenant + admin/staff/deleted
 * users + two branches + one staff_branch_access grant, all under
 * TENANT_AUTH below) via the migrator connection, rather than requiring
 * external pre-seeding -- login needs real known passwords, which the DAL/
 * tenant-context suites' generic seed does not provide.
 *
 * No test framework, plain Node ESM + node:assert -- matches the sibling
 * suites' convention.
 */

import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';

import { login, refresh, logout, me, demoLogin, getDemoStoreOptions } from '../src/routes/auth.js';
import { requireSession, requireBranchAccess } from '../src/middleware/sessionAuth.js';
import { hashPassword } from '../src/services/passwordService.js';
import { hashToken } from '../src/services/sessionService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(__dirname, '..');

const APP_URL =
  process.env.PGTEST_APP_URL || 'postgresql://grovyn_app:CHANGE_ME_APP@localhost:55433/grovyn';
const MIGRATOR_URL =
  process.env.PGTEST_MIGRATOR_URL ||
  'postgresql://grovyn_migrator:CHANGE_ME_MIGRATOR@localhost:55433/grovyn';

const TENANT_AUTH = '99999999-1111-1111-1111-111111111111';
const TENANT_AUTH_SLUG = 'auth-p104-fixture';
const BRANCH_NORTH = '99999999-2222-1111-1111-111111111111';
const BRANCH_SOUTH = '99999999-2222-2222-2222-222222222222';
const ADMIN_EMAIL = 'admin@auth-p104.example';
const STAFF_EMAIL = 'staff@auth-p104.example';
const DELETED_EMAIL = 'gone@auth-p104.example';
const REAL_PASSWORD = 'Correct-Horse-Battery-Staple-1!';

const failures = [];
function check(label, condition, detail) {
  if (condition) {
    console.log('PASS', '-', label);
  } else {
    const msg = `${label}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`;
    failures.push(msg);
    console.error('FAIL', '-', msg);
  }
}

// ---------------------------------------------------------------------------
// Seed: a dedicated tenant/user/branch fixture, self-contained so this suite
// never depends on another suite having run first. Uses fresh UUIDs (99999999
// prefix) that don't collide with the sibling suites' 11111111/22222222
// fixtures, so this can run against the same container without cleanup.
// ---------------------------------------------------------------------------
async function seed() {
  const client = new pg.Client({ connectionString: MIGRATOR_URL });
  await client.connect();
  try {
    const already = await client.query('SELECT count(*) AS n FROM tenant WHERE id = $1', [TENANT_AUTH]);
    if (Number(already.rows[0].n) > 0) {
      console.log('[seed] auth fixture tenant already present, skipping seed.');
      return;
    }

    const adminHash = await hashPassword(REAL_PASSWORD);
    const staffHash = await hashPassword(REAL_PASSWORD);
    const deletedHash = await hashPassword(REAL_PASSWORD);

    await client.query('BEGIN');
    await client.query('INSERT INTO tenant (id, name, slug) VALUES ($1, $2, $3)', [
      TENANT_AUTH,
      'Auth P1-04 Fixture Co',
      TENANT_AUTH_SLUG,
    ]);
    const adminId = crypto.randomUUID();
    const staffId = crypto.randomUUID();
    const deletedId = crypto.randomUUID();
    await client.query(
      `INSERT INTO "user" (id, tenant_id, email, name, password_hash, role) VALUES ($1, $2, $3, 'Fixture Admin', $4, 'ADMIN')`,
      [adminId, TENANT_AUTH, ADMIN_EMAIL, adminHash]
    );
    await client.query(
      `INSERT INTO "user" (id, tenant_id, email, name, password_hash, role) VALUES ($1, $2, $3, 'Fixture Staff', $4, 'STAFF')`,
      [staffId, TENANT_AUTH, STAFF_EMAIL, staffHash]
    );
    await client.query(
      `INSERT INTO "user" (id, tenant_id, email, name, password_hash, role, deleted_at) VALUES ($1, $2, $3, 'Fixture Gone', $4, 'STAFF', now())`,
      [deletedId, TENANT_AUTH, DELETED_EMAIL, deletedHash]
    );
    await client.query('INSERT INTO branch (id, tenant_id, name) VALUES ($1, $2, $3), ($4, $2, $5)', [
      BRANCH_NORTH,
      TENANT_AUTH,
      'North',
      BRANCH_SOUTH,
      'South',
    ]);
    await client.query('INSERT INTO staff_branch_access (tenant_id, user_id, branch_id) VALUES ($1, $2, $3)', [
      TENANT_AUTH,
      staffId,
      BRANCH_NORTH,
    ]);
    await client.query('COMMIT');
    console.log('[seed] auth fixture tenant seeded:', { adminId, staffId, deletedId });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

async function auditRows(tenantId, action) {
  const migrator = new pg.Client({ connectionString: MIGRATOR_URL });
  await migrator.connect();
  try {
    const r = await migrator.query(
      'SELECT * FROM audit_log WHERE tenant_id = $1 AND action = $2 ORDER BY created_at DESC',
      [tenantId, action]
    );
    return r.rows;
  } finally {
    await migrator.end();
  }
}

// ---------------------------------------------------------------------------
// Test app: mounts the REAL route handlers/middleware, not a re-implementation.
// ---------------------------------------------------------------------------
function buildTestApp(pool) {
  const app = express();
  app.use(express.json());

  app.post('/api/v1/auth/login', login(pool));
  app.post('/api/v1/auth/refresh', requireSession(pool), refresh(pool));
  app.post('/api/v1/auth/logout', requireSession(pool), logout(pool));
  app.get('/api/v1/auth/me', requireSession(pool), me(pool));

  // Direct branch-scope proof, independent of any real business route
  // (P1-05 owns wiring this into real branch-scoped endpoints).
  app.get('/branch-check/:branchId', requireSession(pool), requireBranchAccess('branchId'), (req, res) => {
    res.status(200).json({ ok: true });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: 'InternalServerError', message: 'Something went wrong.' });
  });

  return app;
}

async function withServer(pool, run) {
  const app = buildTestApp(pool);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function postJson(url, body, token) {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  let data = null;
  try {
    data = await r.json();
  } catch {
    /* 204 has no body */
  }
  return { status: r.status, data };
}

async function getJson(url, token) {
  const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let data = null;
  try {
    data = await r.json();
  } catch {
    /* ignore */
  }
  return { status: r.status, data };
}

async function login_(base, body) {
  return postJson(`${base}/api/v1/auth/login`, body);
}

// ---------------------------------------------------------------------------
async function runLoginAndRoleChecks(base) {
  // Admin login: correct creds, no role field accepted/sent.
  const adminRes = await login_(base, { tenantSlug: TENANT_AUTH_SLUG, email: ADMIN_EMAIL, password: REAL_PASSWORD });
  check('Login: admin success -> 200', adminRes.status === 200, adminRes);
  check('Login: admin role from DB is ADMIN', adminRes.data?.user?.role === 'ADMIN', adminRes.data);
  const adminToken = adminRes.data?.sessionToken;
  check('Login: admin sessionToken present', typeof adminToken === 'string' && adminToken.length > 0, adminToken);

  // SEC-04 closure: staff user logs in while asserting role:'ADMIN' in the
  // body -- the field isn't even part of the contract, and even if a client
  // sends it, the response role MUST still come from the DB record.
  const staffRes = await login_(base, {
    tenantSlug: TENANT_AUTH_SLUG,
    email: STAFF_EMAIL,
    password: REAL_PASSWORD,
    role: 'ADMIN', // client-asserted role attempt -- must be ignored
  });
  check('Login: staff success -> 200', staffRes.status === 200, staffRes);
  check(
    'Login: client-asserted role:"ADMIN" in body is IGNORED -- DB role (STAFF) wins',
    staffRes.data?.user?.role === 'STAFF',
    staffRes.data
  );
  const staffToken = staffRes.data?.sessionToken;

  // /me reflects server-derived tenant/user/role/branch scope, never from
  // client input (requireSession sets req.* from the resolver row only).
  const adminMe = await getJson(`${base}/api/v1/auth/me`, adminToken);
  check('me: admin -> 200', adminMe.status === 200, adminMe);
  check('me: admin tenant id matches', adminMe.data?.tenant?.id === TENANT_AUTH, adminMe.data);
  check('me: admin role is ADMIN', adminMe.data?.user?.role === 'ADMIN', adminMe.data);

  const staffMe = await getJson(`${base}/api/v1/auth/me`, staffToken);
  check('me: staff -> 200', staffMe.status === 200, staffMe);
  check(
    'me: staff branchIds is exactly [North] (from staff_branch_access, not client input)',
    Array.isArray(staffMe.data?.branchIds) &&
      staffMe.data.branchIds.length === 1 &&
      staffMe.data.branchIds[0] === BRANCH_NORTH,
    staffMe.data
  );

  return { adminToken, staffToken };
}

async function runBranchScopeChecks(base, { adminToken, staffToken }) {
  const staffNorth = await getJson(`${base}/branch-check/${BRANCH_NORTH}`, staffToken);
  check('Branch scope: staff -> assigned branch (North) allowed', staffNorth.status === 200, staffNorth);

  const staffSouth = await getJson(`${base}/branch-check/${BRANCH_SOUTH}`, staffToken);
  check('Branch scope: staff -> unassigned branch (South) forbidden (403)', staffSouth.status === 403, staffSouth);

  const adminNorth = await getJson(`${base}/branch-check/${BRANCH_NORTH}`, adminToken);
  const adminSouth = await getJson(`${base}/branch-check/${BRANCH_SOUTH}`, adminToken);
  check('Branch scope: admin -> North allowed (implicit all-branch access)', adminNorth.status === 200, adminNorth);
  check('Branch scope: admin -> South allowed (implicit all-branch access)', adminSouth.status === 200, adminSouth);
}

async function runSessionLifecycleChecks(base) {
  const loginRes = await login_(base, { tenantSlug: TENANT_AUTH_SLUG, email: ADMIN_EMAIL, password: REAL_PASSWORD });
  const tokenA = loginRes.data.sessionToken;

  const meA = await getJson(`${base}/api/v1/auth/me`, tokenA);
  check('Lifecycle: token A valid before refresh', meA.status === 200, meA);

  const refreshRes = await postJson(`${base}/api/v1/auth/refresh`, {}, tokenA);
  check('Lifecycle: refresh -> 200', refreshRes.status === 200, refreshRes);
  const tokenB = refreshRes.data?.sessionToken;
  check('Lifecycle: refresh returns a NEW token (rotation, not the same one)', tokenB && tokenB !== tokenA, {
    tokenA,
    tokenB,
  });

  const meAAfterRefresh = await getJson(`${base}/api/v1/auth/me`, tokenA);
  check('Lifecycle: OLD token A rejected after rotation', meAAfterRefresh.status === 401, meAAfterRefresh);

  const meB = await getJson(`${base}/api/v1/auth/me`, tokenB);
  check('Lifecycle: NEW token B works', meB.status === 200, meB);

  const logoutRes = await postJson(`${base}/api/v1/auth/logout`, {}, tokenB);
  check('Lifecycle: logout -> 204', logoutRes.status === 204, logoutRes);

  const meBAfterLogout = await getJson(`${base}/api/v1/auth/me`, tokenB);
  check('Lifecycle: token B rejected after logout (revoked)', meBAfterLogout.status === 401, meBAfterLogout);
}

async function runDirectSessionRowChecks(base) {
  // Expired session: insert a session row directly with expires_at in the
  // past. requireSession must reject it even though revoked_at is NULL.
  const migrator = new pg.Client({ connectionString: MIGRATOR_URL });
  await migrator.connect();
  try {
    const expiredToken = crypto.randomBytes(32).toString('base64url');
    const usersRes = await migrator.query('SELECT id FROM "user" WHERE tenant_id = $1 AND email = $2', [
      TENANT_AUTH,
      ADMIN_EMAIL,
    ]);
    const adminId = usersRes.rows[0].id;

    await migrator.query(
      `INSERT INTO session (tenant_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() - interval '1 hour')`,
      [TENANT_AUTH, adminId, hashToken(expiredToken)]
    );
    const expiredMe = await getJson(`${base}/api/v1/auth/me`, expiredToken);
    check('Direct row: EXPIRED session rejected (401)', expiredMe.status === 401, expiredMe);

    const revokedToken = crypto.randomBytes(32).toString('base64url');
    await migrator.query(
      `INSERT INTO session (tenant_id, user_id, token_hash, expires_at, revoked_at) VALUES ($1, $2, $3, now() + interval '1 hour', now())`,
      [TENANT_AUTH, adminId, hashToken(revokedToken)]
    );
    const revokedMe = await getJson(`${base}/api/v1/auth/me`, revokedToken);
    check('Direct row: REVOKED session rejected (401)', revokedMe.status === 401, revokedMe);

    const deletedUserRes = await migrator.query('SELECT id FROM "user" WHERE tenant_id = $1 AND email = $2', [
      TENANT_AUTH,
      DELETED_EMAIL,
    ]);
    const deletedUserId = deletedUserRes.rows[0].id;
    const deletedUserToken = crypto.randomBytes(32).toString('base64url');
    await migrator.query(
      `INSERT INTO session (tenant_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [TENANT_AUTH, deletedUserId, hashToken(deletedUserToken)]
    );
    const deletedUserMe = await getJson(`${base}/api/v1/auth/me`, deletedUserToken);
    check(
      "Direct row: session for a soft-deleted user's account is rejected (401)",
      deletedUserMe.status === 401,
      deletedUserMe
    );

    const garbageMe = await getJson(`${base}/api/v1/auth/me`, 'not-a-real-token-at-all');
    check('Direct row: unknown/garbage token rejected (401)', garbageMe.status === 401, garbageMe);

    const noHeaderMe = await getJson(`${base}/api/v1/auth/me`);
    check('Direct row: missing Authorization header rejected (401)', noHeaderMe.status === 401, noHeaderMe);
  } finally {
    await migrator.end();
  }
}

// ---------------------------------------------------------------------------
// Login failure indistinguishability + the CRITIQUE 017 timing-oracle fix.
// ---------------------------------------------------------------------------
async function runFailureAndTimingChecks(base) {
  const unknownTenant = await login_(base, { tenantSlug: 'no-such-tenant-xyz', email: ADMIN_EMAIL, password: 'whatever' });
  const unknownUser = await login_(base, { tenantSlug: TENANT_AUTH_SLUG, email: 'nobody@auth-p104.example', password: 'whatever' });
  const wrongPassword = await login_(base, { tenantSlug: TENANT_AUTH_SLUG, email: ADMIN_EMAIL, password: 'definitely-wrong' });

  check('Failure: unknown tenant -> 401', unknownTenant.status === 401, unknownTenant);
  check('Failure: unknown user -> 401', unknownUser.status === 401, unknownUser);
  check('Failure: wrong password -> 401', wrongPassword.status === 401, wrongPassword);
  check(
    'Failure: all three failure bodies are byte-identical (no information leak about which stage failed)',
    JSON.stringify(unknownTenant.data) === JSON.stringify(unknownUser.data) &&
      JSON.stringify(unknownUser.data) === JSON.stringify(wrongPassword.data),
    { unknownTenant: unknownTenant.data, unknownUser: unknownUser.data, wrongPassword: wrongPassword.data }
  );

  // Timing: average N repeats per branch to smooth container/network jitter,
  // then assert the delta between "unknown user" and "wrong password" (both
  // do a full tenant+user resolution, one real vs. one dummy argon2id verify)
  // is small relative to the argon2id cost itself -- this is the exact
  // asymmetry CRITIQUE 017 found (fast 0-row miss vs slow verify-on-hit).
  const N = 12;
  async function timeBranch(body) {
    const samples = [];
    for (let i = 0; i < N; i++) {
      const start = process.hrtime.bigint();
      await login_(base, body);
      const end = process.hrtime.bigint();
      samples.push(Number(end - start) / 1e6); // ms
    }
    samples.sort((a, b) => a - b);
    // median -- robust to the odd slow outlier from GC/scheduling jitter.
    return samples[Math.floor(samples.length / 2)];
  }

  const tUnknownTenant = await timeBranch({ tenantSlug: 'no-such-tenant-xyz-timing', email: ADMIN_EMAIL, password: 'whatever' });
  const tUnknownUser = await timeBranch({ tenantSlug: TENANT_AUTH_SLUG, email: 'nobody2@auth-p104.example', password: 'whatever' });
  const tWrongPassword = await timeBranch({ tenantSlug: TENANT_AUTH_SLUG, email: ADMIN_EMAIL, password: 'definitely-wrong-2' });

  console.log('[timing] median ms — unknownTenant:', tUnknownTenant.toFixed(1), 'unknownUser:', tUnknownUser.toFixed(1), 'wrongPassword:', tWrongPassword.toFixed(1));

  // Sanity: prove the mitigation is doing real work, not just "everything is
  // fast so nothing can leak" -- an argon2id verify should take measurable
  // time (a few ms at minimum, typically tens of ms).
  check('Timing: unknown-user branch performed real argon2id work (>=5ms)', tUnknownUser >= 5, tUnknownUser);
  check('Timing: unknown-tenant branch performed real argon2id work (>=5ms)', tUnknownTenant >= 5, tUnknownTenant);

  const deltaUserVsPassword = Math.abs(tUnknownUser - tWrongPassword);
  check(
    'Timing: unknown-user vs wrong-password median delta is bounded (<40ms) -- the exact oracle CRITIQUE 017 found',
    deltaUserVsPassword < 40,
    { tUnknownUser, tWrongPassword, deltaUserVsPassword }
  );

  const deltaTenantVsPassword = Math.abs(tUnknownTenant - tWrongPassword);
  check(
    'Timing: unknown-tenant vs wrong-password median delta is bounded (<50ms; one fewer DB round trip, still dominated by the dummy verify)',
    deltaTenantVsPassword < 50,
    { tUnknownTenant, tWrongPassword, deltaTenantVsPassword }
  );
}

async function runAuditLogChecks() {
  const successRows = await auditRows(TENANT_AUTH, 'auth.login_success');
  check('Audit: at least one auth.login_success row for the fixture tenant', successRows.length >= 1, successRows.length);

  const failureRows = await auditRows(TENANT_AUTH, 'auth.login_failure');
  check(
    'Audit: at least two auth.login_failure rows (unknown user + wrong password; unknown-tenant is NOT tenant-attributable, by design)',
    failureRows.length >= 2,
    failureRows.length
  );
  check(
    'Audit: both login_failure reasons recorded (user_not_found, invalid_password)',
    failureRows.some((r) => r.after_data?.reason === 'user_not_found') &&
      failureRows.some((r) => r.after_data?.reason === 'invalid_password'),
    failureRows.map((r) => r.after_data)
  );

  const refreshRows = await auditRows(TENANT_AUTH, 'auth.session_refresh');
  check('Audit: at least one auth.session_refresh row', refreshRows.length >= 1, refreshRows.length);

  const logoutRows = await auditRows(TENANT_AUTH, 'auth.logout');
  check('Audit: at least one auth.logout row', logoutRows.length >= 1, logoutRows.length);
}

// ---------------------------------------------------------------------------
// Boot-time checks that need a fresh process: SESSION_SECRET is mandatory,
// and AUTH_DEMO_MODE gates the demo routes' very existence (404 vs reachable),
// not just their behavior.
// ---------------------------------------------------------------------------
function runSessionSecretBootCheck() {
  return new Promise((resolve) => {
    const probe = `import('../src/config/index.js').then(()=>{console.log('IMPORTED_OK');process.exit(0);}).catch(e=>{console.log('IMPORT_THREW: '+e.message);process.exit(0);});`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', probe], {
      cwd: join(BACKEND_ROOT, 'tests'),
      env: { ...process.env, SESSION_SECRET: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', () => {
      check(
        'Boot: importing config/index.js with SESSION_SECRET unset throws',
        out.includes('IMPORT_THREW') && out.includes('SESSION_SECRET'),
        out.trim()
      );
      resolve();
    });
  });
}

function waitForHealth(base, maxWaitMs = 15000) {
  const start = Date.now();
  return (async function poll() {
    while (Date.now() - start < maxWaitMs) {
      try {
        const r = await fetch(`${base}/api/v1/health`);
        if (r.ok) return true;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  })();
}

function spawnRealServer(port, extraEnv) {
  return spawn('node', ['src/server.js'], {
    cwd: BACKEND_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      SESSION_SECRET: process.env.SESSION_SECRET || 'auth-pgtest-not-a-real-secret',
      DATABASE_APP_URL: APP_URL,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function runDemoModeGateCheck() {
  const disabledPort = 45801;
  const disabledProc = spawnRealServer(disabledPort, { AUTH_DEMO_MODE: 'false' });
  try {
    const base = `http://127.0.0.1:${disabledPort}`;
    const up = await waitForHealth(base);
    check('DemoGate: server with AUTH_DEMO_MODE=false boots', up, up);
    if (up) {
      const r = await fetch(`${base}/api/v1/auth/demo-stores`);
      check('DemoGate: demo route is genuinely unreachable (404) when disabled', r.status === 404, r.status);
      const r2 = await fetch(`${base}/api/v1/auth/demo-login`, { method: 'POST' });
      check('DemoGate: demo-login route is genuinely unreachable (404) when disabled', r2.status === 404, r2.status);
    }
  } finally {
    disabledProc.kill();
  }

  const enabledPort = 45802;
  const enabledProc = spawnRealServer(enabledPort, { AUTH_DEMO_MODE: 'true' });
  try {
    const base = `http://127.0.0.1:${enabledPort}`;
    const up = await waitForHealth(base);
    check('DemoGate: server with AUTH_DEMO_MODE=true boots', up, up);
    if (up) {
      const r = await fetch(`${base}/api/v1/auth/demo-stores`);
      check('DemoGate: demo route reachable (200) when explicitly enabled', r.status === 200, r.status);
    }
  } finally {
    enabledProc.kill();
  }
}

async function main() {
  await seed();

  await runSessionSecretBootCheck();

  const pool = new pg.Pool({ connectionString: APP_URL, max: 5 });
  await withServer(pool, async (base) => {
    const tokens = await runLoginAndRoleChecks(base);
    await runBranchScopeChecks(base, tokens);
    await runSessionLifecycleChecks(base);
    await runDirectSessionRowChecks(base);
    await runFailureAndTimingChecks(base);
  });
  await pool.end();

  await runAuditLogChecks();
  await runDemoModeGateCheck();

  console.log('\n--- SUMMARY ---');
  if (failures.length) {
    console.error(`${failures.length} check(s) FAILED:`);
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
  }
  console.log('All checks passed.');
  process.exit(0);
}

main().catch((err) => {
  console.error('HARNESS ERROR', err);
  process.exit(1);
});
