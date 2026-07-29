// P1-00 RLS-pooling spike — Prisma harness.
// Connects as the non-bypass `grovyn_app` role (gate 5 precondition), pool
// size 10, and runs gates 1-4 + the 50-concurrent-request test (gate 3) +
// the interactive-transaction latency budget.
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const APP_URL = 'postgresql://grovyn_app:app_runtime_pw@localhost:55432/rls_spike_prisma';
const POOL_SIZE = 10;

const TENANTS = [
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555',
];

const pool = new pg.Pool({ connectionString: APP_URL, max: POOL_SIZE });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const results = { gate1: null, gate2: null, gate3: null, gate4: null, latency: null };

// NOTE: Postgres `SET`/`SET LOCAL` does not accept a bound parameter for its
// value -- a raw/unsafe execution path is unavoidable for this one statement
// regardless of ORM. Tenant id MUST be validated as a strict UUID before
// interpolation since it cannot be parameter-bound (real app-layer
// responsibility either way; see identical note in the Drizzle harness).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function setTenant(tx, tenantId) {
  if (!UUID_RE.test(tenantId)) throw new Error('refusing to interpolate non-UUID tenant id');
  await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant = '${tenantId}'`);
}

// --- Gate 1: transaction<->connection affinity ---
async function gate1() {
  const out = await prisma.$transaction(async (tx) => {
    await setTenant(tx, TENANTS[0]);
    const row = await tx.$queryRawUnsafe(
      `SELECT current_setting('app.current_tenant', true) AS guc, pg_backend_pid() AS pid1`
    );
    const row2 = await tx.$queryRawUnsafe(`SELECT pg_backend_pid() AS pid2`);
    return { guc: row[0].guc, pid1: row[0].pid1, pid2: row2[0].pid2 };
  });
  const pass = out.guc === TENANTS[0] && out.pid1 === out.pid2;
  results.gate1 = { pass, detail: out };
}

// --- Gate 2: no cross-checkout leakage ---
async function gate2() {
  // Txn A sets tenant A, commits.
  await prisma.$transaction(async (tx) => {
    await setTenant(tx, TENANTS[0]);
    await tx.$queryRawUnsafe(`SELECT 1`);
  });
  // Fresh query, no txn, no context set at all.
  const rows = await prisma.$queryRawUnsafe(`SELECT current_setting('app.current_tenant', true) AS guc`);
  const rowsData = await prisma.rlsTest.findMany();
  const pass = (rows[0].guc === '' || rows[0].guc === null) && rowsData.length === 0;
  results.gate2 = { pass, guc: rows[0].guc, rowCount: rowsData.length };
}

// --- Gate 4: fail-closed on missing context (no txn, no SET LOCAL at all) ---
async function gate4() {
  const rows = await prisma.rlsTest.findMany();
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
      prisma.$transaction(async (tx) => {
        await setTenant(tx, tenant);
        const rows = await tx.rlsTest.findMany();
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

// --- Latency budget: wrapped-transaction overhead vs bare pooled query ---
async function latency() {
  const N = 50;
  const bare = [];
  const wrapped = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    await prisma.$queryRawUnsafe(`SELECT 1`);
    bare.push(performance.now() - t0);
  }
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    await prisma.$transaction(async (tx) => {
      await setTenant(tx, TENANTS[0]);
      await tx.$queryRawUnsafe(`SELECT 1`);
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

// --- Gate 5 (privilege separation) is verified via direct SQL, not through Prisma ---

async function main() {
  await gate1();
  await gate2();
  await gate4();
  await gate3();
  await latency();
  console.log(JSON.stringify(results, null, 2));
  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error('HARNESS ERROR', e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
