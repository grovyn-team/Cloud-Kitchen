/**
 * P1-02 S2/S3 — real-Postgres verification for the tenant-context middleware
 * (`src/middleware/tenantContext.js`) and the runtime connection pool
 * (`src/db/pool.js`).
 *
 * NOT part of `npm run verify` (that suite has no DB dependency and must
 * keep passing without Postgres available). Run this explicitly:
 *
 *   npm run test:tenant-context
 *
 * against a real Postgres with the P1-01/P1-02 migrations
 * (0000, 0001, 0002) + `bootstrap-roles.sql` already applied, and at least
 * two seeded tenants + one active user each (see the container setup this
 * task's report documents). Configure via env vars (all optional, default to
 * the throwaway-container values this task used):
 *   PGTEST_APP_URL      - grovyn_app connection string
 *   PGTEST_TENANT_A      / PGTEST_TENANT_A_USER_EMAIL
 *   PGTEST_TENANT_B      / PGTEST_TENANT_B_USER_EMAIL
 *
 * No test framework, plain Node ESM + node:assert -- matches
 * `tests/system.test.js`'s existing convention.
 */

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import pg from 'pg';
import { withTenantContext, isValidTenantId } from '../src/middleware/tenantContext.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(__dirname, '..');

const APP_URL =
  process.env.PGTEST_APP_URL || 'postgresql://grovyn_app:CHANGE_ME_APP@localhost:55433/grovyn';
const MIGRATOR_URL =
  process.env.PGTEST_MIGRATOR_URL ||
  'postgresql://grovyn_migrator:CHANGE_ME_MIGRATOR@localhost:55433/grovyn';

const TENANT_A = process.env.PGTEST_TENANT_A || '11111111-1111-1111-1111-111111111111';
const TENANT_B = process.env.PGTEST_TENANT_B || '22222222-2222-2222-2222-222222222222';
const TENANT_A_EMAIL = process.env.PGTEST_TENANT_A_USER_EMAIL || 'admin@acme.example';
const TENANT_B_EMAIL = process.env.PGTEST_TENANT_B_USER_EMAIL || 'admin@beta.example';

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
// Test app: a tenant-scoped route wired through withTenantContext(pool), and
// a TEST-ONLY (never production) middleware that lifts req.tenantId from a
// header. Production (P1-04) sets req.tenantId from the verified,
// server-side-resolved session -- NEVER from client input. This header shim
// exists only because P1-04 does not exist yet; it is not shipped/mounted in
// the real app (see report -- app.js/v1/index.js are untouched by this
// task).
// ---------------------------------------------------------------------------
function buildTestApp(pool) {
  const app = express();
  app.use((req, _res, next) => {
    // TEST-ONLY tenant resolution shim. Documented explicitly: this is
    // exactly the kind of client-trusting shortcut the architecture rules
    // forbid in real code -- P1-04 must set req.tenantId from a verified
    // server-side session, never a header/query param a client controls.
    req.tenantId = req.headers['x-test-tenant-id'];
    next();
  });

  app.get(
    '/whoami',
    withTenantContext(pool)(async (req, db) => {
      const guc = await db.raw(`SELECT current_setting('app.current_tenant', true) AS guc`);
      const tenantRow = await db.raw('SELECT id, name, slug FROM tenant');
      return { guc: guc.rows[0].guc, tenantRows: tenantRow.rows };
    })
  );

  app.get(
    '/users',
    withTenantContext(pool)(async (req, db) => {
      const users = await db.raw('SELECT id, tenant_id, email FROM "user"');
      const pidRow = await db.raw('SELECT pg_backend_pid() AS pid');
      // Small artificial delay so concurrent requests genuinely overlap
      // in-flight on a small pool, forcing real connection reuse mid-test
      // rather than requests resolving too fast to ever contend.
      await db.raw('SELECT pg_sleep(0.05)');
      return { rows: users.rows, pid: pidRow.rows[0].pid };
    })
  );

  app.get(
    '/boom',
    withTenantContext(pool)(async () => {
      throw new Error('intentional handler failure for rollback test');
    })
  );

  // Generic error handler: consistent shape, no stack trace leak (repo
  // architecture rule).
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

// ---------------------------------------------------------------------------
// S2 checks: single small pool, sequential + basic isolation behavior.
// ---------------------------------------------------------------------------
async function runS2Checks() {
  const pool = new pg.Pool({ connectionString: APP_URL, max: 2 });

  await withServer(pool, async (base) => {
    // Check 1: happy path -- GUC visible inside the transaction, tenant_self_access
    // policy returns exactly tenant A's own row (schema.js `tenant_self_access`).
    {
      const r = await fetch(`${base}/whoami`, { headers: { 'x-test-tenant-id': TENANT_A } });
      const body = await r.json();
      check('S2.1 status 200', r.status === 200, r.status);
      check('S2.1 GUC set to requested tenant inside tx', body.guc === TENANT_A, body.guc);
      check(
        'S2.1 tenant_self_access returns exactly one row, the caller\'s own tenant',
        body.tenantRows.length === 1 && body.tenantRows[0].id === TENANT_A,
        body.tenantRows
      );
    }

    // Check 2: cross-tenant isolation on `user` (tenant B must not see tenant A's user).
    {
      const rA = await fetch(`${base}/users`, { headers: { 'x-test-tenant-id': TENANT_A } });
      const bodyA = await rA.json();
      const rB = await fetch(`${base}/users`, { headers: { 'x-test-tenant-id': TENANT_B } });
      const bodyB = await rB.json();
      check(
        'S2.2 tenant A sees only its own user row',
        bodyA.rows.length === 1 && bodyA.rows[0].email === TENANT_A_EMAIL,
        bodyA.rows
      );
      check(
        'S2.2 tenant B sees only its own user row',
        bodyB.rows.length === 1 && bodyB.rows[0].email === TENANT_B_EMAIL,
        bodyB.rows
      );
    }

    // Check 3: missing / malformed tenant id -> 400, fail closed, no query runs.
    {
      const rMissing = await fetch(`${base}/whoami`);
      check('S2.3 missing tenantId -> 400', rMissing.status === 400, rMissing.status);
      const rBad = await fetch(`${base}/whoami`, {
        headers: { 'x-test-tenant-id': "not-a-uuid'; DROP TABLE tenant; --" },
      });
      check('S2.3 malformed tenantId -> 400 (not a 500/DB error)', rBad.status === 400, rBad.status);
    }

    // Check 4: handler throw -> ROLLBACK, generic 500, no stack trace leaked,
    // and the pool recovers for the next request (poisoned connection was
    // discarded via client.release(err), not silently reused).
    {
      const rBoom = await fetch(`${base}/boom`, { headers: { 'x-test-tenant-id': TENANT_A } });
      const boomBody = await rBoom.json();
      check('S2.4 handler throw -> 500', rBoom.status === 500, rBoom.status);
      check(
        'S2.4 error body has no stack trace / internal detail',
        boomBody.error === 'InternalServerError' && !('stack' in boomBody),
        boomBody
      );
      const rRecover = await fetch(`${base}/whoami`, { headers: { 'x-test-tenant-id': TENANT_A } });
      check('S2.4 pool recovers after a rolled-back/discarded connection', rRecover.status === 200, rRecover.status);
    }
  });

  // Check 5: GUC does not leak to a fresh checkout on the SAME pool after
  // the transaction that set it has committed. max:2 makes reuse of the
  // exact same underlying connection likely on a near-idle pool; force it
  // by draining to idle first.
  {
    const raw = await pool.query(`SELECT current_setting('app.current_tenant', true) AS guc`);
    check(
      'S2.5 no GUC leakage to a fresh checkout after commit',
      raw.rows[0].guc === '' || raw.rows[0].guc === null,
      raw.rows[0].guc
    );
  }

  await pool.end();
}

// ---------------------------------------------------------------------------
// S3.2: prove transaction-scoping holds under real pool oversubscription --
// pool size (3) strictly less than concurrent in-flight requests (24),
// round-robined across two tenants, forced to overlap via pg_sleep so
// connections are genuinely reused mid-test, not just returned to an idle
// pool between sequential calls.
// ---------------------------------------------------------------------------
async function runS3ConcurrencyCheck() {
  const POOL_SIZE = 3;
  const REQUESTS = 24;
  const pool = new pg.Pool({ connectionString: APP_URL, max: POOL_SIZE });

  await withServer(pool, async (base) => {
    const tenants = [TENANT_A, TENANT_B];
    const expectedEmail = { [TENANT_A]: TENANT_A_EMAIL, [TENANT_B]: TENANT_B_EMAIL };

    const calls = Array.from({ length: REQUESTS }, (_, i) => {
      const tenant = tenants[i % tenants.length];
      return fetch(`${base}/users`, { headers: { 'x-test-tenant-id': tenant } }).then(async (r) => ({
        tenant,
        status: r.status,
        body: await r.json(),
      }));
    });

    const settled = await Promise.allSettled(calls);

    let crossTenantLeaks = 0;
    let wrongCount = 0;
    let errors = 0;
    const pidsUsed = new Set();

    for (const s of settled) {
      if (s.status === 'rejected') {
        errors++;
        continue;
      }
      const { tenant, status, body } = s.value;
      if (status !== 200) {
        errors++;
        continue;
      }
      pidsUsed.add(body.pid);
      if (body.rows.length !== 1) wrongCount++;
      if (body.rows[0]?.email !== expectedEmail[tenant]) crossTenantLeaks++;
    }

    check('S3.2 all 24 concurrent requests completed without transport errors', errors === 0, errors);
    check('S3.2 every response saw exactly its own tenant\'s single user row', wrongCount === 0, wrongCount);
    check(
      'S3.2 zero cross-tenant leakage across 24 requests on a 3-connection pool',
      crossTenantLeaks === 0,
      crossTenantLeaks
    );
    check(
      'S3.2 real connection reuse occurred (fewer distinct backend PIDs than requests, pool=3 < N=24)',
      pidsUsed.size <= POOL_SIZE,
      { distinctPids: pidsUsed.size, poolSize: POOL_SIZE }
    );
  });

  await pool.end();
}

// ---------------------------------------------------------------------------
// Check: set_config is genuinely parameter-bound, not string-interpolated --
// exercised directly against the pool (bypassing the middleware's UUID
// gate on purpose) with a SQL-injection-shaped payload as the *value*. If
// this were string interpolation, this call would either error out trying
// to parse broken SQL, or -- far worse -- actually execute the injected
// statement and drop the `tenant` table. Bound parameters treat the whole
// string as an inert literal.
// ---------------------------------------------------------------------------
async function runBoundParameterInjectionCheck() {
  const pool = new pg.Pool({ connectionString: APP_URL, max: 1 });
  const client = await pool.connect();
  const payload = "x'; DROP TABLE tenant; --";
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [payload]);
    const echoed = await client.query(`SELECT current_setting('app.current_tenant', true) AS guc`);
    check(
      'InjectionCheck: malicious payload stored verbatim as an inert literal, not executed as SQL',
      echoed.rows[0].guc === payload,
      echoed.rows[0].guc
    );
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }

  // Use the BYPASSRLS migrator connection to check the table survived --
  // `pool` (grovyn_app, NOBYPASSRLS) correctly returns 0 rows here with no
  // tenant context set (fail-closed RLS, expected and unrelated to this
  // check), so it can't distinguish "table exists but RLS-empty" from
  // "table dropped".
  const migratorClient = new pg.Client({ connectionString: MIGRATOR_URL });
  await migratorClient.connect();
  try {
    const stillThere = await migratorClient.query('SELECT count(*) AS n FROM tenant');
    check(
      'InjectionCheck: tenant table still exists and is queryable (nothing was dropped)',
      Number(stillThere.rows[0].n) >= 2,
      stillThere.rows[0]
    );
  } finally {
    await migratorClient.end();
  }
  await pool.end();
}

// ---------------------------------------------------------------------------
// Check: pool.js fails loudly at import time when DATABASE_APP_URL is unset
// -- no fallback to DATABASE_URL/DATABASE_MIGRATOR_URL under any
// circumstance (SECURITY_REVIEWS/002 IR-03). Spawned in a child process
// because import-time throw can't be caught with a normal dynamic import in
// the same process the way this check wants to assert it (module caching).
// ---------------------------------------------------------------------------
function runPoolFailClosedCheck() {
  const poolModuleUrl = pathToFileURL(join(BACKEND_ROOT, 'src', 'db', 'pool.js')).href;
  const probe = `
    import(${JSON.stringify(poolModuleUrl)})
      .then(() => { console.log('IMPORTED_OK'); process.exit(0); })
      .catch((e) => { console.log('IMPORT_THREW: ' + e.message); process.exit(0); });
  `;
  const resultNoEnv = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, DATABASE_APP_URL: '', DATABASE_URL: 'postgresql://ignored', DATABASE_MIGRATOR_URL: 'postgresql://ignored' },
    encoding: 'utf8',
  });
  check(
    'PoolFailClosed: importing db/pool.js with DATABASE_APP_URL unset throws (even if DATABASE_URL/DATABASE_MIGRATOR_URL ARE set)',
    resultNoEnv.stdout.includes('IMPORT_THREW') && resultNoEnv.stdout.includes('DATABASE_APP_URL'),
    resultNoEnv.stdout.trim() || resultNoEnv.stderr.trim()
  );

  const resultWithEnv = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, DATABASE_APP_URL: APP_URL },
    encoding: 'utf8',
  });
  check(
    'PoolFailClosed: importing db/pool.js with DATABASE_APP_URL set succeeds',
    resultWithEnv.stdout.includes('IMPORTED_OK'),
    resultWithEnv.stdout.trim() || resultWithEnv.stderr.trim()
  );
}

async function seedGuard() {
  // Fail fast with a clear message if the container/migrations/seed this
  // test expects aren't present, instead of a wall of confusing failures.
  const client = new pg.Client({ connectionString: MIGRATOR_URL });
  await client.connect();
  try {
    const t = await client.query('SELECT count(*) AS n FROM tenant WHERE id IN ($1, $2)', [TENANT_A, TENANT_B]);
    assert.strictEqual(
      Number(t.rows[0].n),
      2,
      `Expected seeded tenants ${TENANT_A} and ${TENANT_B} to exist. Run the migrations + seed described in this task's report first.`
    );
  } finally {
    await client.end();
  }
}

async function main() {
  check('isValidTenantId rejects non-UUID', !isValidTenantId('not-a-uuid'), null);
  check('isValidTenantId accepts a well-formed UUID', isValidTenantId(TENANT_A), null);

  await seedGuard();
  runPoolFailClosedCheck();
  await runS2Checks();
  await runS3ConcurrencyCheck();
  await runBoundParameterInjectionCheck();

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
