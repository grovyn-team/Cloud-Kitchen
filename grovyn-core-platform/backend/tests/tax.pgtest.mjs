/**
 * Phase 6 — Tax (GST) module backend task (2026-07-31) — real-Postgres
 * verification for:
 *   - src/routes/tax.js (getSummary, getExport)
 *   - src/services/taxService.js (computeGstFromSales, resolveGstRate,
 *     upsertPeriodSummary, getOrComputePeriodSummary, buildCsvExport)
 *   - the `tax_period_summary.branch_id` composite-FK fix
 *     (`drizzle/0012_tax_period_summary_branch_composite_fk.sql`)
 *
 * NOT part of `npm run verify` (no DB dependency there). Run explicitly:
 *
 *   npm run test:tax
 *
 * against a real Postgres with migrations 0000-0012 + bootstrap-roles.sql
 * applied (same throwaway `postgres:16-alpine` container the sibling P1-P4/
 * P2-03/P2-06 suites use). This suite SELF-SEEDS its own fixtures (two
 * tenants) directly via SQL for sale rows (mimicking exactly the shapes
 * `saleService.js`'s own suite already proves that module produces
 * correctly) rather than driving this suite through the Sales module's own
 * HTTP endpoints. Uses `facefeed-...` prefixed ids, distinct from every
 * sibling suite's fixture prefix (`99999999`=sales, `88888888`=inventory,
 * `cccccccc`=customers, `dddddddd`=staffManagement, `eeeeeeee`=notifications,
 * `ffffffff`=dashboard/finance, `77777777`=expansion) so all suites can run
 * against the same shared database without colliding.
 *
 * Period window is a FIXED calendar range (2026-01-01..2026-01-31), not
 * anchored to the DB server's `CURRENT_DATE` the way Dashboard/Finance's
 * rolling-window suites are — `periodStart`/`periodEnd` are explicit
 * caller-supplied dates for this module, so a fixed fixture window is both
 * simpler and a more faithful match of the real query shape under test.
 *
 * No test framework, plain Node ESM + a `check()` helper — matches the
 * sibling suites' convention exactly. Test app mounts the REAL route
 * handlers/middleware in the REAL composition order `routes/v1/index.js`
 * uses (ADMIN-only router-level gate).
 */

import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';

import { login } from '../src/routes/auth.js';
import { requireSession, requireRole as requireSessionRole } from '../src/middleware/sessionAuth.js';
import { getSummary as getTaxSummary, getExport as getTaxExport } from '../src/routes/tax.js';
import { hashPassword } from '../src/services/passwordService.js';
import { CA_REVIEW_DISCLAIMER } from '../src/services/taxService.js';

const APP_URL =
  process.env.PGTEST_APP_URL || 'postgresql://grovyn_app:CHANGE_ME_APP@localhost:55433/grovyn';
const MIGRATOR_URL =
  process.env.PGTEST_MIGRATOR_URL ||
  'postgresql://grovyn_migrator:CHANGE_ME_MIGRATOR@localhost:55433/grovyn';

const TENANT_A = 'facefeed-5555-1111-1111-111111111111';
const TENANT_A_SLUG = 'tax-p6-a';
const TENANT_B = 'facefeed-6666-1111-1111-111111111111';
const TENANT_B_SLUG = 'tax-p6-b';

const BRANCH_A1 = 'facefeed-5555-2222-1111-111111111111'; // A-North
const BRANCH_A2 = 'facefeed-5555-2222-2222-222222222222'; // A-South
const BRANCH_B1 = 'facefeed-6666-2222-1111-111111111111'; // B-Only

const ADMIN_A_EMAIL = 'admin@tax-p6-a.example';
const STAFF_A1_EMAIL = 'staff1@tax-p6-a.example';
const ADMIN_B_EMAIL = 'admin@tax-p6-b.example';
const REAL_PASSWORD = 'Correct-Horse-Battery-Staple-1!';

const PERIOD_START = '2026-01-01';
const PERIOD_END = '2026-01-31';

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

function closeEnough(a, b, eps = 0.005) {
  return Math.abs(Number(a) - Number(b)) < eps;
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
async function seed() {
  const client = new pg.Client({ connectionString: MIGRATOR_URL });
  await client.connect();
  try {
    const already = await client.query('SELECT count(*) AS n FROM tenant WHERE id = $1', [TENANT_A]);
    if (Number(already.rows[0].n) > 0) {
      console.log('[seed] tax fixture tenants already present, skipping seed.');
      return;
    }

    const pwHash = await hashPassword(REAL_PASSWORD);

    await client.query('BEGIN');

    await client.query(
      `INSERT INTO tenant (id, name, slug) VALUES ($1,$2,$3), ($4,$5,$6)`,
      [TENANT_A, 'Tax Fixture A', TENANT_A_SLUG, TENANT_B, 'Tax Fixture B', TENANT_B_SLUG]
    );
    // Integration Task 2/4, round 3: rate is now resolved per sale-line from
    // `tax_rate`, never from `tenant.settings.tax.gstRate` (removed) -- 5%
    // for tenant A, 12% for tenant B, proving the effective-dated rate
    // still varies correctly PER TENANT even though this fixture only ever
    // sets one rate per tenant (no mid-period change scenario here; that's
    // covered live in this task's report, not re-tested in this suite).
    await client.query(
      `INSERT INTO tax_rate (tenant_id, rate_percent, effective_from, effective_to) VALUES
       ($1, 5.00, DATE '2000-01-01', NULL),
       ($2, 12.00, DATE '2000-01-01', NULL)`,
      [TENANT_A, TENANT_B]
    );
    await client.query(
      'INSERT INTO branch (id, tenant_id, name) VALUES ($1,$2,$3), ($4,$2,$5), ($6,$7,$8)',
      [BRANCH_A1, TENANT_A, 'A-North', BRANCH_A2, 'A-South', BRANCH_B1, TENANT_B, 'B-Only']
    );

    const adminAId = crypto.randomUUID();
    const staffA1Id = crypto.randomUUID();
    const adminBId = crypto.randomUUID();
    await client.query(
      `INSERT INTO "user" (id, tenant_id, email, name, password_hash, role) VALUES ($1,$2,$3,'Fixture Admin A',$4,'ADMIN')`,
      [adminAId, TENANT_A, ADMIN_A_EMAIL, pwHash]
    );
    await client.query(
      `INSERT INTO "user" (id, tenant_id, email, name, password_hash, role) VALUES ($1,$2,$3,'Fixture Staff A1',$4,'STAFF')`,
      [staffA1Id, TENANT_A, STAFF_A1_EMAIL, pwHash]
    );
    await client.query(
      `INSERT INTO "user" (id, tenant_id, email, name, password_hash, role) VALUES ($1,$2,$3,'Fixture Admin B',$4,'ADMIN')`,
      [adminBId, TENANT_B, ADMIN_B_EMAIL, pwHash]
    );
    await client.query('INSERT INTO staff_branch_access (tenant_id, user_id, branch_id) VALUES ($1,$2,$3)', [
      TENANT_A,
      staffA1Id,
      BRANCH_A1,
    ]);

    // Integration Task 4, round 3: `taxService.computeGstFromSales` now
    // aggregates real `sale_line_item` rows (GROUP BY gst_rate_percent), not
    // `sale` header sums -- this fixture inserts ONE line item per sale,
    // subtotal/tax matching the header exactly (single-line sales), so the
    // pre-existing expected totals below still hold unchanged.
    async function insertSale({ id, tenantId, branchId, saleDate, subtotal, tax, total, rate, deleted = false }) {
      await client.query(
        `INSERT INTO sale (id, tenant_id, branch_id, sale_date, source, subtotal_amount, tax_amount, total_amount, deleted_at)
         VALUES ($1,$2,$3,$4,'manual',$5,$6,$7,${deleted ? 'now()' : 'NULL'})`,
        [id, tenantId, branchId, saleDate, subtotal, tax, total]
      );
      await client.query(
        `INSERT INTO sale_line_item (tenant_id, sale_id, item_name, quantity, unit_price, line_subtotal, gst_rate_percent, tax_amount, deleted_at)
         VALUES ($1,$2,'Fixture line',1,$3,$3,$4,$5,${deleted ? 'now()' : 'NULL'})`,
        [tenantId, id, subtotal, rate, tax]
      );
    }

    // Branch A1, inside the Jan-2026 fixture period -> expected sum:
    // taxable=1500.00, tax=75.00, saleCount=2.
    await insertSale({
      id: crypto.randomUUID(),
      tenantId: TENANT_A,
      branchId: BRANCH_A1,
      saleDate: '2026-01-05',
      subtotal: 1000.0,
      tax: 50.0,
      total: 1050.0,
      rate: 5.0,
    });
    await insertSale({
      id: crypto.randomUUID(),
      tenantId: TENANT_A,
      branchId: BRANCH_A1,
      saleDate: '2026-01-20',
      subtotal: 500.0,
      tax: 25.0,
      total: 525.0,
      rate: 5.0,
    });
    // Outside the fixture period -> must be EXCLUDED.
    await insertSale({
      id: crypto.randomUUID(),
      tenantId: TENANT_A,
      branchId: BRANCH_A1,
      saleDate: '2025-12-31',
      subtotal: 999.0,
      tax: 999.0,
      total: 1998.0,
      rate: 5.0,
    });
    // Inside the period but SOFT-DELETED -> must be EXCLUDED.
    await insertSale({
      id: crypto.randomUUID(),
      tenantId: TENANT_A,
      branchId: BRANCH_A1,
      saleDate: '2026-01-10',
      subtotal: 500.0,
      tax: 500.0,
      total: 1000.0,
      rate: 5.0,
      deleted: true,
    });

    // Branch A2, inside the period -> expected: taxable=2000.00, tax=100.00, saleCount=1.
    await insertSale({
      id: crypto.randomUUID(),
      tenantId: TENANT_A,
      branchId: BRANCH_A2,
      saleDate: '2026-01-15',
      subtotal: 2000.0,
      tax: 100.0,
      total: 2100.0,
      rate: 5.0,
    });

    // Tenant B, inside the period -> proves cross-tenant isolation + the
    // tenant's own `tax_rate`=12% (no longer a `tenant.settings` override).
    await insertSale({
      id: crypto.randomUUID(),
      tenantId: TENANT_B,
      branchId: BRANCH_B1,
      saleDate: '2026-01-12',
      subtotal: 300.0,
      tax: 15.0,
      total: 315.0,
      rate: 12.0,
    });

    await client.query('COMMIT');
    console.log('[seed] tax fixture tenants + rows seeded.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Composite-FK verification -- same test pattern as migration 0009's own
// verification: a direct SQL insert (via the BYPASSRLS migrator connection,
// so RLS itself is not what's being tested here) with a `tenant_id`/
// `branch_id` mismatch must be rejected by the FK CONSTRAINT ITSELF, not
// merely by RLS (which a BYPASSRLS connection ignores entirely).
// ---------------------------------------------------------------------------
async function verifyCompositeFk() {
  const client = new pg.Client({ connectionString: MIGRATOR_URL });
  await client.connect();
  try {
    let rejected = false;
    let errCode = null;
    try {
      // tenant_id = TENANT_A but branch_id = BRANCH_B1 (a REAL branch, but
      // owned by TENANT_B) -- must violate
      // tax_period_summary_branch_id_tenant_id_fk.
      await client.query(
        `INSERT INTO tax_period_summary
           (id, tenant_id, branch_id, period_start, period_end, gst_rate, taxable_amount, tax_amount, sale_count)
         VALUES ($1,$2,$3,$4,$5,5.00,100.00,5.00,1)`,
        [crypto.randomUUID(), TENANT_A, BRANCH_B1, PERIOD_START, PERIOD_END]
      );
    } catch (err) {
      rejected = true;
      errCode = err.code;
    }
    check(
      'composite FK: cross-tenant branch_id mismatch rejected at the FK level (23503)',
      rejected && errCode === '23503',
      { rejected, errCode }
    );

    // Sanity control: the SAME insert with a matching tenant_id/branch_id
    // pair succeeds (proves the constraint isn't just rejecting everything).
    const okId = crypto.randomUUID();
    await client.query(
      `INSERT INTO tax_period_summary
         (id, tenant_id, branch_id, period_start, period_end, gst_rate, taxable_amount, tax_amount, sale_count)
       VALUES ($1,$2,$3,$4,$5,5.00,100.00,5.00,1)`,
      [okId, TENANT_A, BRANCH_A1, '1999-01-01', '1999-01-31']
    );
    const { rows } = await client.query('SELECT id FROM tax_period_summary WHERE id = $1', [okId]);
    check('composite FK: matching tenant_id/branch_id pair is accepted', rows.length === 1, rows);
    // Cleanup so this doesn't collide with the idempotent-upsert check below.
    await client.query('DELETE FROM tax_period_summary WHERE id = $1', [okId]);
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Test app: mounts the REAL handlers in the REAL composition order.
// ---------------------------------------------------------------------------
function buildTestApp(pool) {
  const app = express();
  app.use(express.json());

  app.post('/api/v1/auth/login', login(pool));

  const taxAuth = [requireSession(pool), requireSessionRole(['ADMIN'])];
  app.get('/api/v1/tax/summary', ...taxAuth, getTaxSummary(pool));
  app.get('/api/v1/tax/export', ...taxAuth, getTaxExport(pool));

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
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  let data = null;
  try {
    data = await r.json();
  } catch {
    /* no body */
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

async function getText(url, token) {
  const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const text = await r.text();
  return { status: r.status, headers: r.headers, text };
}

async function loginAs(base, tenantSlug, email) {
  const r = await postJson(`${base}/api/v1/auth/login`, { tenantSlug, email, password: REAL_PASSWORD });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(r)}`);
  return r.data.sessionToken;
}

// ---------------------------------------------------------------------------
async function main() {
  await seed();
  await verifyCompositeFk();

  const pool = new pg.Pool({ connectionString: APP_URL, max: 5 });
  const migrator = new pg.Client({ connectionString: MIGRATOR_URL });
  await migrator.connect();

  await withServer(pool, async (base) => {
    const adminAToken = await loginAs(base, TENANT_A_SLUG, ADMIN_A_EMAIL);
    const staffA1Token = await loginAs(base, TENANT_A_SLUG, STAFF_A1_EMAIL);
    const adminBToken = await loginAs(base, TENANT_B_SLUG, ADMIN_B_EMAIL);

    const qs = (branchId) => `branchId=${branchId}&periodStart=${PERIOD_START}&periodEnd=${PERIOD_END}`;

    // =====================================================================
    // GET /tax/summary — validation
    // =====================================================================
    const missingBranch = await getJson(`${base}/api/v1/tax/summary?periodStart=${PERIOD_START}&periodEnd=${PERIOD_END}`, adminAToken);
    check('tax/summary: missing branchId -> 400', missingBranch.status === 400, missingBranch);

    const badBranchFormat = await getJson(
      `${base}/api/v1/tax/summary?branchId=not-a-uuid&periodStart=${PERIOD_START}&periodEnd=${PERIOD_END}`,
      adminAToken
    );
    check('tax/summary: malformed branchId -> 400', badBranchFormat.status === 400, badBranchFormat);

    const missingDates = await getJson(`${base}/api/v1/tax/summary?branchId=${BRANCH_A1}`, adminAToken);
    check('tax/summary: missing period dates -> 400', missingDates.status === 400, missingDates);

    const badDateFormat = await getJson(
      `${base}/api/v1/tax/summary?branchId=${BRANCH_A1}&periodStart=01-01-2026&periodEnd=${PERIOD_END}`,
      adminAToken
    );
    check('tax/summary: malformed date -> 400', badDateFormat.status === 400, badDateFormat);

    const invertedRange = await getJson(
      `${base}/api/v1/tax/summary?branchId=${BRANCH_A1}&periodStart=${PERIOD_END}&periodEnd=${PERIOD_START}`,
      adminAToken
    );
    check('tax/summary: periodStart after periodEnd -> 400', invertedRange.status === 400, invertedRange);

    // =====================================================================
    // GET /tax/summary — ADMIN-only, whole route. STAFF -> 403.
    // =====================================================================
    const staffAttempt = await getJson(`${base}/api/v1/tax/summary?${qs(BRANCH_A1)}`, staffA1Token);
    check('tax/summary: STAFF -> 403 (ADMIN-only, whole route)', staffAttempt.status === 403, staffAttempt);

    const staffExportAttempt = await getJson(`${base}/api/v1/tax/export?${qs(BRANCH_A1)}&format=csv`, staffA1Token);
    check('tax/export: STAFF -> 403 (ADMIN-only, whole route)', staffExportAttempt.status === 403, staffExportAttempt);

    // =====================================================================
    // GET /tax/summary — cross-tenant branch-id smuggling rejected.
    // =====================================================================
    const crossTenantSmuggle = await getJson(`${base}/api/v1/tax/summary?${qs(BRANCH_B1)}`, adminAToken);
    check('tax/summary: cross-tenant branch-id smuggling rejected -> 403', crossTenantSmuggle.status === 403, crossTenantSmuggle);

    // =====================================================================
    // GET /tax/summary — computation correctness against hand-computed
    // fixture totals.
    // =====================================================================
    // Integration Task 4, round 3: response shape is now `{rates: [...], total*}`
    // -- one entry per distinct GST rate in force during the window. This
    // fixture only ever has ONE rate per tenant, so `rates` has exactly one
    // entry and `total*` equals that entry's own values; checks below use
    // `total*` (a direct like-for-like replacement of the old single-value
    // fields) plus an explicit `rates.length === 1` + `rates[0].gstRate`
    // check to prove the per-rate breakdown itself is populated correctly,
    // not just the sum.
    const summaryA1 = await getJson(`${base}/api/v1/tax/summary?${qs(BRANCH_A1)}`, adminAToken);
    check('tax/summary: branch A1 -> 200', summaryA1.status === 200, summaryA1);
    check('tax/summary: branch A1 taxableAmount = 1500.00 (1000+500, excludes Dec + soft-deleted)', closeEnough(summaryA1.data?.totalTaxableAmount, 1500.0), summaryA1.data);
    check('tax/summary: branch A1 taxAmount = 75.00 (50+25)', closeEnough(summaryA1.data?.totalTaxAmount, 75.0), summaryA1.data);
    check('tax/summary: branch A1 saleCount = 2', summaryA1.data?.totalSaleCount === 2, summaryA1.data);
    check(
      'tax/summary: branch A1 rates = one bucket at 5.00% (tenant tax_rate, no mid-period change)',
      summaryA1.data?.rates?.length === 1 && closeEnough(summaryA1.data.rates[0]?.gstRate, 5.0),
      summaryA1.data
    );
    check(
      'tax/summary: response carries the CA-review disclaimer verbatim',
      summaryA1.data?.disclaimer === CA_REVIEW_DISCLAIMER,
      summaryA1.data?.disclaimer
    );
    check('tax/summary: periodStart/periodEnd echoed back', summaryA1.data?.periodStart === PERIOD_START && summaryA1.data?.periodEnd === PERIOD_END, summaryA1.data);

    const summaryA2 = await getJson(`${base}/api/v1/tax/summary?${qs(BRANCH_A2)}`, adminAToken);
    check('tax/summary: branch A2 taxableAmount = 2000.00', closeEnough(summaryA2.data?.totalTaxableAmount, 2000.0), summaryA2.data);
    check('tax/summary: branch A2 taxAmount = 100.00', closeEnough(summaryA2.data?.totalTaxAmount, 100.0), summaryA2.data);
    check('tax/summary: branch A2 saleCount = 1', summaryA2.data?.totalSaleCount === 1, summaryA2.data);

    // Tenant B: isolation + tenant B's own tax_rate=12%.
    const summaryB1 = await getJson(`${base}/api/v1/tax/summary?${qs(BRANCH_B1)}`, adminBToken);
    check('tax/summary: tenant B branch B1 taxableAmount = 300.00 (never sees tenant A data)', closeEnough(summaryB1.data?.totalTaxableAmount, 300.0), summaryB1.data);
    check('tax/summary: tenant B branch B1 taxAmount = 15.00', closeEnough(summaryB1.data?.totalTaxAmount, 15.0), summaryB1.data);
    check(
      'tax/summary: tenant B rate bucket = 12.00% (tenant B\'s own tax_rate row)',
      summaryB1.data?.rates?.length === 1 && closeEnough(summaryB1.data.rates[0]?.gstRate, 12.0),
      summaryB1.data
    );

    // Empty-period branch (no sales at all in window, e.g. reuse A2's id with
    // an out-of-fixture-range period) -> zero, not an error, zero rate buckets.
    const emptyPeriod = await getJson(
      `${base}/api/v1/tax/summary?branchId=${BRANCH_A2}&periodStart=2030-01-01&periodEnd=2030-01-31`,
      adminAToken
    );
    check(
      'tax/summary: period with no sales -> 200 with zeros, not an error',
      emptyPeriod.status === 200 &&
        closeEnough(emptyPeriod.data?.totalTaxableAmount, 0) &&
        emptyPeriod.data?.totalSaleCount === 0 &&
        Array.isArray(emptyPeriod.data?.rates) &&
        emptyPeriod.data.rates.length === 0,
      emptyPeriod.data
    );

    // =====================================================================
    // Idempotent recompute: calling /tax/summary twice for the SAME
    // tenant/branch/period must not duplicate the persisted
    // tax_period_summary row.
    // =====================================================================
    const before = await migrator.query(
      'SELECT count(*)::int AS n FROM tax_period_summary WHERE tenant_id = $1 AND branch_id = $2 AND period_start = $3 AND period_end = $4',
      [TENANT_A, BRANCH_A1, PERIOD_START, PERIOD_END]
    );
    await getJson(`${base}/api/v1/tax/summary?${qs(BRANCH_A1)}`, adminAToken);
    await getJson(`${base}/api/v1/tax/summary?${qs(BRANCH_A1)}`, adminAToken);
    const after = await migrator.query(
      'SELECT count(*)::int AS n FROM tax_period_summary WHERE tenant_id = $1 AND branch_id = $2 AND period_start = $3 AND period_end = $4',
      [TENANT_A, BRANCH_A1, PERIOD_START, PERIOD_END]
    );
    check(
      'tax/summary: idempotent recompute -- exactly ONE persisted row after multiple calls',
      after.rows[0].n === 1,
      { before: before.rows[0].n, after: after.rows[0].n }
    );

    // =====================================================================
    // GET /tax/export — CSV shape, disclaimer, values.
    // =====================================================================
    const badFormat = await getJson(`${base}/api/v1/tax/export?${qs(BRANCH_A1)}&format=pdf`, adminAToken);
    check('tax/export: unsupported format -> 400', badFormat.status === 400, badFormat);

    const exportA1 = await getText(`${base}/api/v1/tax/export?${qs(BRANCH_A1)}&format=csv`, adminAToken);
    check('tax/export: branch A1 -> 200', exportA1.status === 200, exportA1.status);
    check(
      'tax/export: Content-Type is text/csv',
      (exportA1.headers.get('content-type') || '').includes('text/csv'),
      exportA1.headers.get('content-type')
    );
    check(
      'tax/export: Content-Disposition is an attachment with a filename',
      (exportA1.headers.get('content-disposition') || '').startsWith('attachment;'),
      exportA1.headers.get('content-disposition')
    );
    check(
      'tax/export: CSV body contains the CA-review disclaimer verbatim (not just in API docs)',
      exportA1.text.includes(CA_REVIEW_DISCLAIMER),
      exportA1.text
    );
    check('tax/export: CSV body contains the header row', exportA1.text.includes('Taxable Amount') && exportA1.text.includes('Tax Amount') && exportA1.text.includes('Sale Count'), exportA1.text);
    check('tax/export: CSV body contains the branch name', exportA1.text.includes('A-North'), exportA1.text);
    check('tax/export: CSV body contains the computed taxable amount (1500.00)', exportA1.text.includes('1500.00'), exportA1.text);
    check('tax/export: CSV body contains the computed tax amount (75.00)', exportA1.text.includes('75.00'), exportA1.text);

    const exportCrossTenant = await getText(`${base}/api/v1/tax/export?${qs(BRANCH_B1)}&format=csv`, adminAToken);
    check('tax/export: cross-tenant branch-id smuggling rejected -> 403', exportCrossTenant.status === 403, exportCrossTenant.status);
  });

  await pool.end();
  await migrator.end();

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
