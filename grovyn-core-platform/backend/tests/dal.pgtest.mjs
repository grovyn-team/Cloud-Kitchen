/**
 * P1-03 — real-Postgres verification for the fail-closed scoped DAL
 * (`src/db/dal.js`) and the three SECURITY_REVIEWS/003 / CRITIQUE 018
 * follow-ups closed alongside it in `src/middleware/tenantContext.js`:
 *   - SR3-01: pool timeouts (`src/db/pool.js`) don't wedge the whole pool.
 *   - SR3-02: `DISCARD ALL` on release clears session-level state before a
 *     connection is recycled to a different tenant's request.
 *   - SR3-04 / CRITIQUE 018 F1: the `reply(status, body)` branded envelope
 *     replaces the duck-typed `{status, body}` check, so a legitimate data
 *     object that happens to own `status`/`body` fields is no longer
 *     misinterpreted as an HTTP envelope.
 *
 * NOT part of `npm run verify` (no DB dependency there). Run explicitly:
 *
 *   npm run test:dal
 *
 * against a real Postgres with the P1-01/P1-02 migrations (0000, 0001, 0002)
 * + `bootstrap-roles.sql` already applied, and at least two seeded tenants +
 * one active user each -- same container/seed this task's sibling suite
 * (`tests/tenantContext.pgtest.mjs`) uses. Configure via the same env vars:
 *   PGTEST_APP_URL / PGTEST_MIGRATOR_URL
 *   PGTEST_TENANT_A / PGTEST_TENANT_A_USER_EMAIL
 *   PGTEST_TENANT_B / PGTEST_TENANT_B_USER_EMAIL
 *
 * No test framework, plain Node ESM + node:assert -- matches the sibling
 * suite's convention.
 */

import assert from 'node:assert';
import { eq } from 'drizzle-orm';
import express from 'express';
import pg from 'pg';
import { withTenantContext, reply } from '../src/middleware/tenantContext.js';
import { schema } from '../src/db/dal.js';

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
// Test app: exercises the DAL's Drizzle query builder, the relational query
// API, the `reply()` branded envelope, and (deliberately, for the leak test
// below) a raw session-level `SET` via `db.raw` -- something only a buggy
// handler would do, which is exactly the scenario SR3-02's `DISCARD ALL`
// guards against.
// ---------------------------------------------------------------------------
function buildTestApp(pool) {
  const app = express();
  app.use((req, _res, next) => {
    // TEST-ONLY tenant resolution shim (same caveat as the sibling suite):
    // production (P1-04) sets req.tenantId from a verified server-side
    // session, never a client-controlled header.
    req.tenantId = req.headers['x-test-tenant-id'];
    next();
  });

  // Drizzle query-builder path: `.select().from(schema.tenant)` with NO
  // tenant_id predicate written by the handler at all -- if the DAL's
  // fail-closed-by-construction property holds, this still returns exactly
  // the caller's own tenant row, because RLS applies transparently to
  // whatever SQL Drizzle generates on this already-scoped connection.
  app.get(
    '/tenant-via-builder',
    withTenantContext(pool)(async (req, db) => {
      const rows = await db.select().from(schema.tenant);
      return { rows };
    })
  );

  // Relational query API path (`db.query.<table>.findMany()`), a second,
  // distinct Drizzle surface from `.select()` -- also scoped by construction
  // via the same underlying client, no separate wiring needed.
  app.get(
    '/users-via-relational-api',
    withTenantContext(pool)(async (req, db) => {
      const rows = await db.query.user.findMany();
      return { rows: rows.map((r) => ({ id: r.id, tenantId: r.tenantId, email: r.email })) };
    })
  );

  // Drizzle builder WITH an explicit filter (eq) -- proves the DAL composes
  // normally with Drizzle's own predicate helpers; RLS still applies on top
  // regardless of what the handler's own WHERE clause says.
  app.get(
    '/user-by-email-via-builder',
    withTenantContext(pool)(async (req, db) => {
      const rows = await db
        .select({ id: schema.user.id, tenantId: schema.user.tenantId, email: schema.user.email })
        .from(schema.user)
        .where(eq(schema.user.email, String(req.query.email || '')));
      return { rows };
    })
  );

  // Returns a plain data object that legitimately owns `status`/`body`
  // fields (e.g. a support-ticket-shaped row) -- CRITIQUE 018 F1 / SR3-04.
  // Must be serialized AS-IS with a 200, not reinterpreted as an HTTP
  // envelope.
  app.get(
    '/ticket-shaped-data',
    withTenantContext(pool)(async () => ({ status: 'open', body: 'customer needs a refund' }))
  );

  // Uses the sanctioned `reply()` helper to send a non-200 status.
  app.get(
    '/created-via-reply',
    withTenantContext(pool)(async () => reply(201, { created: true }))
  );

  // Deliberately misbehaves: sets a SESSION-level (not transaction-local)
  // Postgres GUC via the raw escape hatch, then returns normally. A
  // session-level `SET` is NOT reset by COMMIT/ROLLBACK (unlike
  // `set_config(..., true)`/`SET LOCAL`) -- only a connection reset
  // (`DISCARD ALL`) or a brand-new physical connection clears it. This
  // simulates exactly the SR3-02 hazard: a buggy handler leaving session
  // state on a connection about to be recycled to a different tenant.
  app.get(
    '/leave-session-state',
    withTenantContext(pool)(async (req, db) => {
      await db.raw(`SET myapp.leftover_marker = 'leaked-from-tenant-request'`);
      return { ok: true };
    })
  );

  // Reads back the same custom GUC with no attempt to set it -- if
  // `DISCARD ALL` ran on the PRIOR request's release, this reads empty/NULL
  // even when handed the exact same physical connection (forced via a
  // max:1 pool in the check below).
  app.get(
    '/read-leftover-marker',
    withTenantContext(pool)(async (req, db) => {
      const r = await db.raw(`SELECT current_setting('myapp.leftover_marker', true) AS marker`);
      return { marker: r.rows[0].marker };
    })
  );

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
// D1: Drizzle query-builder + relational-API paths are tenant-scoped by
// construction -- no WHERE tenant_id written anywhere in the test app.
// ---------------------------------------------------------------------------
async function runBuilderIsolationChecks() {
  const pool = new pg.Pool({ connectionString: APP_URL, max: 2 });

  await withServer(pool, async (base) => {
    {
      const r = await fetch(`${base}/tenant-via-builder`, {
        headers: { 'x-test-tenant-id': TENANT_A },
      });
      const body = await r.json();
      check('D1.1 status 200', r.status === 200, r.status);
      check(
        'D1.1 .select().from(tenant) with NO app-written filter returns exactly caller\'s own tenant',
        body.rows.length === 1 && body.rows[0].id === TENANT_A,
        body.rows
      );
    }

    {
      const rA = await fetch(`${base}/users-via-relational-api`, {
        headers: { 'x-test-tenant-id': TENANT_A },
      });
      const bodyA = await rA.json();
      const rB = await fetch(`${base}/users-via-relational-api`, {
        headers: { 'x-test-tenant-id': TENANT_B },
      });
      const bodyB = await rB.json();
      check(
        'D1.2 relational query API: tenant A sees only its own user row',
        bodyA.rows.length === 1 && bodyA.rows[0].email === TENANT_A_EMAIL,
        bodyA.rows
      );
      check(
        'D1.2 relational query API: tenant B sees only its own user row',
        bodyB.rows.length === 1 && bodyB.rows[0].email === TENANT_B_EMAIL,
        bodyB.rows
      );
    }

    {
      // Ask tenant B's connection for tenant A's email via an explicit
      // Drizzle `.where(eq(...))` predicate -- if RLS (the backstop) were
      // somehow not applying under the query-builder path, this WOULD
      // return tenant A's row despite the caller being tenant B. It must
      // not.
      const r = await fetch(
        `${base}/user-by-email-via-builder?email=${encodeURIComponent(TENANT_A_EMAIL)}`,
        { headers: { 'x-test-tenant-id': TENANT_B } }
      );
      const body = await r.json();
      check(
        'D1.3 an explicit WHERE for another tenant\'s email still returns zero rows under tenant B\'s context (RLS backstop, not app-layer filtering)',
        body.rows.length === 0,
        body.rows
      );
    }
  });

  await pool.end();
}

// ---------------------------------------------------------------------------
// D2: SR3-04 / CRITIQUE 018 F1 -- branded reply() envelope vs. plain data
// that happens to own status/body fields.
// ---------------------------------------------------------------------------
async function runReplyEnvelopeChecks() {
  const pool = new pg.Pool({ connectionString: APP_URL, max: 1 });

  await withServer(pool, async (base) => {
    {
      const r = await fetch(`${base}/ticket-shaped-data`, {
        headers: { 'x-test-tenant-id': TENANT_A },
      });
      const body = await r.json();
      check(
        'D2.1 plain data object owning status/body fields is sent AS-IS with 200, not reinterpreted as an HTTP envelope',
        r.status === 200 && body.status === 'open' && body.body === 'customer needs a refund',
        { status: r.status, body }
      );
    }

    {
      const r = await fetch(`${base}/created-via-reply`, {
        headers: { 'x-test-tenant-id': TENANT_A },
      });
      const body = await r.json();
      check(
        'D2.2 reply(201, {created:true}) sends the intended non-200 status via the branded envelope',
        r.status === 201 && body.created === true,
        { status: r.status, body }
      );
    }
  });

  await pool.end();
}

// ---------------------------------------------------------------------------
// D3: SR3-02 -- DISCARD ALL on release actually clears session-level state
// before a connection is recycled. Forced onto the SAME physical connection
// via a max:1 pool and strictly sequential requests.
// ---------------------------------------------------------------------------
async function runDiscardAllChecks() {
  const pool = new pg.Pool({ connectionString: APP_URL, max: 1 });

  await withServer(pool, async (base) => {
    const rSet = await fetch(`${base}/leave-session-state`, {
      headers: { 'x-test-tenant-id': TENANT_A },
    });
    check('D3.1 handler that sets session-level state still succeeds', rSet.status === 200, rSet.status);

    const rRead = await fetch(`${base}/read-leftover-marker`, {
      headers: { 'x-test-tenant-id': TENANT_B },
    });
    const body = await rRead.json();
    check(
      'D3.2 session-level GUC set by a prior request does NOT survive onto the recycled connection (DISCARD ALL ran on release)',
      body.marker === '' || body.marker === null,
      body.marker
    );
  });

  await pool.end();
}

async function seedGuard() {
  const client = new pg.Client({ connectionString: MIGRATOR_URL });
  await client.connect();
  try {
    const t = await client.query('SELECT count(*) AS n FROM tenant WHERE id IN ($1, $2)', [
      TENANT_A,
      TENANT_B,
    ]);
    assert.strictEqual(
      Number(t.rows[0].n),
      2,
      `Expected seeded tenants ${TENANT_A} and ${TENANT_B} to exist. Apply migrations + seed first (see tests/tenantContext.pgtest.mjs's doc comment for the same container setup).`
    );
  } finally {
    await client.end();
  }
}

async function main() {
  await seedGuard();
  await runBuilderIsolationChecks();
  await runReplyEnvelopeChecks();
  await runDiscardAllChecks();

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
