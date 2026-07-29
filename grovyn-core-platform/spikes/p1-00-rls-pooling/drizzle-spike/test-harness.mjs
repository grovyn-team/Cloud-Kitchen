// P1-00 RLS-pooling spike — Drizzle harness.
// Connects as the non-bypass `grovyn_app` role (gate 5 precondition), pool
// size 10, and runs gates 1-4 + the 50-concurrent-request test (gate 3) +
// the interactive-transaction latency budget.
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, eq } from 'drizzle-orm';
import pg from 'pg';
import { rlsTest } from './src/schema.js';

const APP_URL = 'postgresql://grovyn_app:app_runtime_pw@localhost:55432/rls_spike_drizzle';
const POOL_SIZE = 10;

const TENANTS = [
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555',
];

const pool = new pg.Pool({ connectionString: APP_URL, max: POOL_SIZE });
const db = drizzle(pool);

const results = { gate1: null, gate2: null, gate3: null, gate4: null, latency: null };

// NOTE: Postgres `SET`/`SET LOCAL` does not accept a bound parameter ($1) for
// its value -- this is a Postgres protocol limitation, not an ORM difference
// (the Prisma harness hits the identical constraint and also uses an unsafe/
// raw execution path for this one statement). In production this means the
// tenant-context value passed to SET LOCAL MUST be validated as a strict UUID
// (or similarly constrained format) before string interpolation, since it
// cannot go through parameterized binding -- this is a real app-layer
// responsibility for both ORM choices, not something either one solves for you.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function setTenant(tx, tenantId) {
  if (!UUID_RE.test(tenantId)) throw new Error('refusing to interpolate non-UUID tenant id');
  await tx.execute(sql.raw(`SET LOCAL app.current_tenant = '${tenantId}'`));
}

// --- Gate 1: transaction<->connection affinity ---
async function gate1() {
  const out = await db.transaction(async (tx) => {
    await setTenant(tx, TENANTS[0]);
    const row = await tx.execute(
      sql`SELECT current_setting('app.current_tenant', true) AS guc, pg_backend_pid() AS pid1`
    );
    const row2 = await tx.execute(sql`SELECT pg_backend_pid() AS pid2`);
    return { guc: row.rows[0].guc, pid1: row.rows[0].pid1, pid2: row2.rows[0].pid2 };
  });
  const pass = out.guc === TENANTS[0] && out.pid1 === out.pid2;
  results.gate1 = { pass, detail: out };
}

// --- Gate 2: no cross-checkout leakage ---
async function gate2() {
  await db.transaction(async (tx) => {
    await setTenant(tx, TENANTS[0]);
    await tx.execute(sql`SELECT 1`);
  });
  const row = await db.execute(sql`SELECT current_setting('app.current_tenant', true) AS guc`);
  const rowsData = await db.select().from(rlsTest);
  const pass = (row.rows[0].guc === '' || row.rows[0].guc === null) && rowsData.length === 0;
  results.gate2 = { pass, guc: row.rows[0].guc, rowCount: rowsData.length };
}

// --- Gate 4: fail-closed on missing context ---
async function gate4() {
  const rows = await db.select().from(rlsTest);
  const pass = rows.length === 0;
  results.gate4 = { pass, rowCount: rows.length };
}

// --- Gate 3: concurrency isolation, N=50 > pool=10, round-robin 5 tenants ---
async function gate3() {
  const REQS = 50;
  const promises = [];
  for (let i = 0; i < REQS; i++) {
    const tenant = TENANTS[i % TENANTS.length];
    promises.push(
      db.transaction(async (tx) => {
        await setTenant(tx, tenant);
        const rows = await tx.select().from(rlsTest);
        return { tenant, rows };
      })
    );
  }
  const settled = await Promise.allSettled(promises);
  let crossTenantLeaks = 0;
  let wrongCount = 0;
  let errors = 0;
  for (const s of settled) {
    if (s.status === 'rejected') {
      errors++;
      continue;
    }
    const { tenant, rows } = s.value;
    if (rows.length !== 20) wrongCount++;
    if (rows.some((r) => r.tenantId !== tenant)) crossTenantLeaks++;
  }
  const pass = crossTenantLeaks === 0 && wrongCount === 0 && errors === 0;
  results.gate3 = { pass, total: REQS, crossTenantLeaks, wrongCount, errors };
}

// --- Latency budget ---
async function latency() {
  const N = 50;
  const bare = [];
  const wrapped = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    await db.execute(sql`SELECT 1`);
    bare.push(performance.now() - t0);
  }
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    await db.transaction(async (tx) => {
      await setTenant(tx, TENANTS[0]);
      await tx.execute(sql`SELECT 1`);
    });
    wrapped.push(performance.now() - t0);
  }
  const pct = (arr, p) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor((p / 100) * s.length)];
  };
  const bareP50 = pct(bare, 50);
  const wrappedP50 = pct(wrapped, 50);
  const bareP95 = pct(bare, 95);
  const wrappedP95 = pct(wrapped, 95);
  results.latency = {
    bareP50: +bareP50.toFixed(2),
    wrappedP50: +wrappedP50.toFixed(2),
    overheadP50: +(wrappedP50 - bareP50).toFixed(2),
    bareP95: +bareP95.toFixed(2),
    wrappedP95: +wrappedP95.toFixed(2),
    overheadP95: +(wrappedP95 - bareP95).toFixed(2),
  };
}

async function main() {
  await gate1();
  await gate2();
  await gate4();
  await gate3();
  await latency();
  console.log(JSON.stringify(results, null, 2));
  await pool.end();
}

main().catch(async (e) => {
  console.error('HARNESS ERROR', e);
  await pool.end();
  process.exit(1);
});
