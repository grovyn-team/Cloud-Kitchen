/**
 * Dashboard + Finance aggregation backend task (2026-07-30) —
 * real-Postgres verification for:
 *   - src/routes/dashboard.js (getSummary, getByBranch)
 *   - src/routes/financeManagement.js (getSummary)
 *   - src/services/dashboardService.js / financeManagementService.js
 *   - src/services/saleService.js's new getCurrentPeriodSummary/getBranchBreakdown
 *   - src/services/inventoryManagementService.js's new getLowStockCount
 *   - src/services/notificationService.js's new getUnresolvedCount
 *
 * NOT part of `npm run verify` (no DB dependency there). Run explicitly:
 *
 *   npm run test:dashboard-finance
 *
 * against a real Postgres with migrations 0000-0010 + bootstrap-roles.sql
 * applied (same throwaway `postgres:16-alpine` container the sibling
 * P1/P2/P3/P4 suites use). This suite SELF-SEEDS its own fixtures (two
 * tenants) DIRECTLY VIA SQL for sale/sale_line_item/inventory_item/
 * notification rows (mimicking the exact shapes the Sales/Inventory/
 * Notifications modules' own real-Postgres suites already prove those
 * modules produce correctly) rather than driving this suite through every
 * upstream module's own HTTP endpoints — this suite's job is proving the
 * AGGREGATION endpoints' correctness/access-control, not re-proving
 * creation logic already covered by `sales.pgtest.mjs`/
 * `inventory.pgtest.mjs`/`notifications.pgtest.mjs`. Uses `ffffffff-...`
 * prefixed ids, distinct from every sibling suite's fixture prefix
 * (`99999999`=sales, `88888888`=inventory, `cccccccc`=customers,
 * `dddddddd`=staffManagement, `eeeeeeee`=notifications) so all suites can
 * run against the same shared database without colliding.
 *
 * Sale dates are anchored to the DB SERVER's own `CURRENT_DATE` (not Node's
 * clock) at seed time, matching exactly how `getCurrentPeriodSummary`/
 * `getBranchBreakdown`/`financeManagementService.getFinanceSummary` compute
 * their period window (`date_trunc(period, CURRENT_DATE::timestamp)`) — so
 * "today's" fixture rows are guaranteed to fall inside the window the
 * queries under test compute, regardless of which timezone the test runner
 * happens to be in.
 *
 * No test framework, plain Node ESM + a `check()` helper — matches the
 * sibling suites' convention exactly. Test app mounts the REAL route
 * handlers/middleware in the REAL composition order `routes/v1/index.js`
 * uses, including the router-level ADMIN-only gates.
 */

import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';

import { login } from '../src/routes/auth.js';
import { requireSession, requireRole as requireSessionRole } from '../src/middleware/sessionAuth.js';
import { getSummary as getDashboardSummary, getByBranch as getDashboardByBranch } from '../src/routes/dashboard.js';
import { getSummary as getFinanceSummary } from '../src/routes/financeManagement.js';
import { hashPassword } from '../src/services/passwordService.js';

const APP_URL =
  process.env.PGTEST_APP_URL || 'postgresql://grovyn_app:CHANGE_ME_APP@localhost:55433/grovyn';
const MIGRATOR_URL =
  process.env.PGTEST_MIGRATOR_URL ||
  'postgresql://grovyn_migrator:CHANGE_ME_MIGRATOR@localhost:55433/grovyn';

const TENANT_A = 'ffffffff-5555-1111-1111-111111111111';
const TENANT_A_SLUG = 'dashfin-p2-a';
const TENANT_B = 'ffffffff-6666-1111-1111-111111111111';
const TENANT_B_SLUG = 'dashfin-p2-b';

const BRANCH_A1 = 'ffffffff-5555-2222-1111-111111111111'; // A-North
const BRANCH_A2 = 'ffffffff-5555-2222-2222-222222222222'; // A-South
const BRANCH_A3 = 'ffffffff-5555-2222-3333-333333333333'; // A-Empty (zero sales, proves by-branch includes it)
const BRANCH_B1 = 'ffffffff-6666-2222-1111-111111111111'; // B-Only

const ADMIN_A_EMAIL = 'admin@dashfin-p2-a.example';
const STAFF_A1_EMAIL = 'staff1@dashfin-p2-a.example';
const ADMIN_B_EMAIL = 'admin@dashfin-p2-b.example';
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
      console.log('[seed] dashboard/finance fixture tenants already present, skipping seed.');
      return;
    }

    const pwHash = await hashPassword(REAL_PASSWORD);

    await client.query('BEGIN');

    await client.query('INSERT INTO tenant (id, name, slug) VALUES ($1,$2,$3), ($4,$5,$6)', [
      TENANT_A,
      'DashFin Fixture A',
      TENANT_A_SLUG,
      TENANT_B,
      'DashFin Fixture B',
      TENANT_B_SLUG,
    ]);
    await client.query(
      'INSERT INTO branch (id, tenant_id, name) VALUES ($1,$2,$3), ($4,$2,$5), ($6,$2,$7), ($8,$9,$10)',
      [
        BRANCH_A1,
        TENANT_A,
        'A-North',
        BRANCH_A2,
        'A-South',
        BRANCH_A3,
        'A-Empty',
        BRANCH_B1,
        TENANT_B,
        'B-Only',
      ]
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

    // --- Inventory items (COGS + low-stock fixtures) -----------------------
    const ITEM_A1_RICE = crypto.randomUUID(); // branch A1, costPerUnit=20.00, BELOW threshold -> low stock
    const ITEM_A1_OIL = crypto.randomUUID(); // branch A1, costPerUnit=NULL, NOT low stock
    const ITEM_A2_PANEER = crypto.randomUUID(); // branch A2, costPerUnit=150.00, BELOW threshold -> low stock
    await client.query(
      `INSERT INTO inventory_item (id, tenant_id, branch_id, name, unit, current_stock, low_stock_threshold, cost_per_unit)
       VALUES
       ($1,$2,$3,'Rice','kg',5,10,20.00),
       ($4,$2,$3,'Cooking Oil','ltr',50,5,NULL),
       ($5,$2,$6,'Paneer','kg',2,3,150.00)`,
      [ITEM_A1_RICE, TENANT_A, BRANCH_A1, ITEM_A1_OIL, ITEM_A2_PANEER, BRANCH_A2]
    );

    // --- Sales + line items, dated via the DB SERVER's own CURRENT_DATE ----
    // (matches exactly how the aggregation queries under test compute "today").
    async function insertSale({ id, branchId, dateExpr, subtotal, tax, total, deleted = false }) {
      await client.query(
        `INSERT INTO sale (id, tenant_id, branch_id, sale_date, source, subtotal_amount, tax_amount, total_amount, created_by_user_id, deleted_at)
         VALUES ($1,$2,$3,${dateExpr},'manual',$4,$5,$6,$7,${deleted ? 'now()' : 'NULL'})`,
        [id, TENANT_A, branchId, subtotal, tax, total, adminAId]
      );
    }
    async function insertLine({ saleId, inventoryItemId, quantity, unitPrice, lineSubtotal }) {
      await client.query(
        `INSERT INTO sale_line_item (id, tenant_id, sale_id, inventory_item_id, item_name, quantity, unit_price, line_subtotal)
         VALUES ($1,$2,$3,$4,'Fixture Line',$5,$6,$7)`,
        [crypto.randomUUID(), TENANT_A, saleId, inventoryItemId, quantity, unitPrice, lineSubtotal]
      );
    }

    // S1: branch A1, TODAY, costed line (RICE, cost 20.00 x5 = 100.00)
    const S1 = crypto.randomUUID();
    await insertSale({ id: S1, branchId: BRANCH_A1, dateExpr: 'CURRENT_DATE', subtotal: 100.0, tax: 10.0, total: 110.0 });
    await insertLine({ saleId: S1, inventoryItemId: ITEM_A1_RICE, quantity: 5, unitPrice: 20.0, lineSubtotal: 100.0 });

    // S2: branch A1, TODAY, NO inventory link at all (free-text/uncatalogued line)
    const S2 = crypto.randomUUID();
    await insertSale({ id: S2, branchId: BRANCH_A1, dateExpr: 'CURRENT_DATE', subtotal: 50.0, tax: 5.0, total: 55.0 });
    await insertLine({ saleId: S2, inventoryItemId: null, quantity: 2, unitPrice: 25.0, lineSubtotal: 50.0 });

    // S3: branch A2, TODAY, costed line (PANEER, cost 150.00 x1 = 150.00)
    const S3 = crypto.randomUUID();
    await insertSale({ id: S3, branchId: BRANCH_A2, dateExpr: 'CURRENT_DATE', subtotal: 200.0, tax: 20.0, total: 220.0 });
    await insertLine({ saleId: S3, inventoryItemId: ITEM_A2_PANEER, quantity: 1, unitPrice: 200.0, lineSubtotal: 200.0 });

    // S4: branch A1, TODAY, line LINKED to an item but that item has NO cost_per_unit
    const S4 = crypto.randomUUID();
    await insertSale({ id: S4, branchId: BRANCH_A1, dateExpr: 'CURRENT_DATE', subtotal: 30.0, tax: 3.0, total: 33.0 });
    await insertLine({ saleId: S4, inventoryItemId: ITEM_A1_OIL, quantity: 3, unitPrice: 10.0, lineSubtotal: 30.0 });

    // S5: branch A1, 60 days ago -- proves the period window EXCLUDES old sales
    // (60 days is outside day/week/month windows uniformly, no edge-of-month risk).
    const S5 = crypto.randomUUID();
    await insertSale({
      id: S5,
      branchId: BRANCH_A1,
      dateExpr: "(CURRENT_DATE - INTERVAL '60 days')::date",
      subtotal: 999.0,
      tax: 99.0,
      total: 1098.0,
    });
    await insertLine({ saleId: S5, inventoryItemId: null, quantity: 1, unitPrice: 999.0, lineSubtotal: 999.0 });

    // S6: branch A1, TODAY, but SOFT-DELETED -- proves deleted sales are excluded.
    const S6 = crypto.randomUUID();
    await insertSale({
      id: S6,
      branchId: BRANCH_A1,
      dateExpr: 'CURRENT_DATE',
      subtotal: 500.0,
      tax: 50.0,
      total: 550.0,
      deleted: true,
    });
    await insertLine({ saleId: S6, inventoryItemId: null, quantity: 1, unitPrice: 500.0, lineSubtotal: 500.0 });

    // Tenant B: one TODAY sale -- proves cross-tenant isolation is real (not
    // just "empty because nothing exists").
    const SB1 = crypto.randomUUID();
    await client.query(
      `INSERT INTO sale (id, tenant_id, branch_id, sale_date, source, subtotal_amount, tax_amount, total_amount, created_by_user_id)
       VALUES ($1,$2,$3,CURRENT_DATE,'manual',900.00,90.00,990.00,$4)`,
      [SB1, TENANT_B, BRANCH_B1, adminBId]
    );

    // --- Notifications (unresolved-count fixtures) --------------------------
    const relatedItemId = crypto.randomUUID();
    await client.query(
      `INSERT INTO notification (id, tenant_id, branch_id, type, title, message, status)
       VALUES ($1,$2,$3,'low_stock','Low stock: Rice','Rice is low.','unread')`,
      [crypto.randomUUID(), TENANT_A, BRANCH_A1]
    );
    await client.query(
      `INSERT INTO notification (id, tenant_id, branch_id, type, title, message, status)
       VALUES ($1,$2,$3,'inventory_request','Restock request','Please restock.','read')`,
      [crypto.randomUUID(), TENANT_A, BRANCH_A1]
    );
    await client.query(
      `INSERT INTO notification (id, tenant_id, branch_id, type, title, message, status)
       VALUES ($1,$2,$3,'low_stock','Resolved one','Already handled.','resolved')`,
      [crypto.randomUUID(), TENANT_A, BRANCH_A1]
    );
    await client.query(
      `INSERT INTO notification (id, tenant_id, branch_id, type, title, message, status)
       VALUES ($1,$2,$3,'low_stock','Low stock: Paneer','Paneer is low.','unread')`,
      [crypto.randomUUID(), TENANT_A, BRANCH_A2]
    );
    void relatedItemId;

    await client.query('COMMIT');
    console.log('[seed] dashboard/finance fixture tenants + rows seeded.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
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

  const dashboardAuth = [requireSession(pool), requireSessionRole(['ADMIN', 'STAFF'])];
  app.get('/api/v1/dashboard/summary', ...dashboardAuth, getDashboardSummary(pool));
  app.get('/api/v1/dashboard/by-branch', ...dashboardAuth, requireSessionRole(['ADMIN']), getDashboardByBranch(pool));

  const financeAuth = [requireSession(pool), requireSessionRole(['ADMIN'])];
  app.get('/api/v1/finance/summary', ...financeAuth, getFinanceSummary(pool));

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

async function loginAs(base, tenantSlug, email) {
  const r = await postJson(`${base}/api/v1/auth/login`, { tenantSlug, email, password: REAL_PASSWORD });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(r)}`);
  return r.data.sessionToken;
}

// ---------------------------------------------------------------------------
async function main() {
  await seed();

  const pool = new pg.Pool({ connectionString: APP_URL, max: 5 });
  await withServer(pool, async (base) => {
    const adminAToken = await loginAs(base, TENANT_A_SLUG, ADMIN_A_EMAIL);
    const staffA1Token = await loginAs(base, TENANT_A_SLUG, STAFF_A1_EMAIL);
    const adminBToken = await loginAs(base, TENANT_B_SLUG, ADMIN_B_EMAIL);

    // =====================================================================
    // GET /dashboard/summary — validation
    // =====================================================================
    const badPeriod = await getJson(`${base}/api/v1/dashboard/summary?period=year`, adminAToken);
    check('dashboard/summary: invalid period -> 400', badPeriod.status === 400, badPeriod);

    const missingPeriod = await getJson(`${base}/api/v1/dashboard/summary`, adminAToken);
    check('dashboard/summary: missing period -> 400', missingPeriod.status === 400, missingPeriod);

    const badBranchFormat = await getJson(`${base}/api/v1/dashboard/summary?period=day&branchId=not-a-uuid`, adminAToken);
    check('dashboard/summary: malformed branchId -> 400', badBranchFormat.status === 400, badBranchFormat);

    // =====================================================================
    // GET /dashboard/summary — STAFF: MOST IMPORTANT PROPERTY. Response body
    // must structurally LACK revenue/aov keys, not just show a smaller number.
    // =====================================================================
    const staffSummary = await getJson(`${base}/api/v1/dashboard/summary?period=day`, staffA1Token);
    check('dashboard/summary: staff (own branch implicit) -> 200', staffSummary.status === 200, staffSummary);
    check(
      'dashboard/summary: STAFF response body has NO "revenue" key at all',
      !Object.prototype.hasOwnProperty.call(staffSummary.data ?? {}, 'revenue'),
      staffSummary.data
    );
    check(
      'dashboard/summary: STAFF response body has NO "aov" key at all',
      !Object.prototype.hasOwnProperty.call(staffSummary.data ?? {}, 'aov'),
      staffSummary.data
    );
    check(
      'dashboard/summary: STAFF sees correct operational figures for their own branch (A1): orderCount=3',
      staffSummary.data?.orderCount === 3,
      staffSummary.data
    );
    check(
      'dashboard/summary: STAFF lowStockCount = 1 (Rice only, branch A1)',
      staffSummary.data?.lowStockCount === 1,
      staffSummary.data
    );
    check(
      'dashboard/summary: STAFF unresolvedNotificationCount = 2 (unread + read, not resolved, branch A1)',
      staffSummary.data?.unresolvedNotificationCount === 2,
      staffSummary.data
    );

    const staffOutsideBranch = await getJson(`${base}/api/v1/dashboard/summary?period=day&branchId=${BRANCH_A2}`, staffA1Token);
    check('dashboard/summary: STAFF filtering by a branch outside their scope -> 403', staffOutsideBranch.status === 403, staffOutsideBranch);

    // =====================================================================
    // GET /dashboard/summary — ADMIN: financial fields present, correct values.
    // =====================================================================
    const adminSummaryAll = await getJson(`${base}/api/v1/dashboard/summary?period=day`, adminAToken);
    check('dashboard/summary: admin (no branchId) -> 200', adminSummaryAll.status === 200, adminSummaryAll);
    check(
      'dashboard/summary: admin sees revenue key with the correct cross-branch total (198+220=418)',
      closeEnough(adminSummaryAll.data?.revenue, 418.0),
      adminSummaryAll.data
    );
    check('dashboard/summary: admin orderCount = 4 (S1,S2,S3,S4; excludes S5 old + S6 deleted)', adminSummaryAll.data?.orderCount === 4, adminSummaryAll.data);
    check('dashboard/summary: admin aov = 418/4 = 104.50', closeEnough(adminSummaryAll.data?.aov, 104.5), adminSummaryAll.data);
    check('dashboard/summary: admin lowStockCount = 2 (Rice + Paneer, cross-branch)', adminSummaryAll.data?.lowStockCount === 2, adminSummaryAll.data);
    check(
      'dashboard/summary: admin unresolvedNotificationCount = 3 (2 on A1 + 1 on A2, excludes resolved)',
      adminSummaryAll.data?.unresolvedNotificationCount === 3,
      adminSummaryAll.data
    );

    const adminSummaryA1 = await getJson(`${base}/api/v1/dashboard/summary?period=day&branchId=${BRANCH_A1}`, adminAToken);
    check('dashboard/summary: admin branchId=A1 revenue = 198.00 (S1+S2+S4)', closeEnough(adminSummaryA1.data?.revenue, 198.0), adminSummaryA1.data);
    check('dashboard/summary: admin branchId=A1 orderCount = 3', adminSummaryA1.data?.orderCount === 3, adminSummaryA1.data);
    check('dashboard/summary: admin branchId=A1 aov = 66.00', closeEnough(adminSummaryA1.data?.aov, 66.0), adminSummaryA1.data);

    // Period consistency: with this fixture, day/week/month should all
    // produce the SAME revenue (only "today" sales fall in any of the three
    // windows -- S5 is 60 days old, outside all of them).
    const adminSummaryWeek = await getJson(`${base}/api/v1/dashboard/summary?period=week`, adminAToken);
    const adminSummaryMonth = await getJson(`${base}/api/v1/dashboard/summary?period=month`, adminAToken);
    check(
      'dashboard/summary: period=week matches period=day revenue for this fixture',
      closeEnough(adminSummaryWeek.data?.revenue, adminSummaryAll.data?.revenue),
      { week: adminSummaryWeek.data, day: adminSummaryAll.data }
    );
    check(
      'dashboard/summary: period=month matches period=day revenue for this fixture',
      closeEnough(adminSummaryMonth.data?.revenue, adminSummaryAll.data?.revenue),
      { month: adminSummaryMonth.data, day: adminSummaryAll.data }
    );

    const crossTenantBranchSmuggle = await getJson(`${base}/api/v1/dashboard/summary?period=day&branchId=${BRANCH_B1}`, adminAToken);
    check('dashboard/summary: cross-tenant branch-id smuggling rejected -> 403', crossTenantBranchSmuggle.status === 403, crossTenantBranchSmuggle);

    // Tenant isolation: tenant B admin sees ONLY tenant B's own data.
    const adminBSummary = await getJson(`${base}/api/v1/dashboard/summary?period=day`, adminBToken);
    check(
      "dashboard/summary: tenant B admin sees ONLY tenant B's own revenue (990.00 total_amount), never tenant A's",
      closeEnough(adminBSummary.data?.revenue, 990.0) && adminBSummary.data?.orderCount === 1,
      adminBSummary.data
    );

    // =====================================================================
    // GET /dashboard/by-branch — ADMIN-only, per-branch breakdown, includes
    // zero-order branches.
    // =====================================================================
    const byBranchAsStaff = await getJson(`${base}/api/v1/dashboard/by-branch?period=day`, staffA1Token);
    check('dashboard/by-branch: STAFF -> 403 (ADMIN-only)', byBranchAsStaff.status === 403, byBranchAsStaff);

    const byBranchBadPeriod = await getJson(`${base}/api/v1/dashboard/by-branch?period=nope`, adminAToken);
    check('dashboard/by-branch: invalid period -> 400', byBranchBadPeriod.status === 400, byBranchBadPeriod);

    const byBranch = await getJson(`${base}/api/v1/dashboard/by-branch?period=day`, adminAToken);
    check('dashboard/by-branch: admin -> 200', byBranch.status === 200, byBranch);
    const rows = byBranch.data?.data ?? [];
    check('dashboard/by-branch: returns exactly 3 rows (A1, A2, A3 -- tenant A only, never tenant B)', rows.length === 3, rows);

    const rowA1 = rows.find((r) => r.branchId === BRANCH_A1);
    const rowA2 = rows.find((r) => r.branchId === BRANCH_A2);
    const rowA3 = rows.find((r) => r.branchId === BRANCH_A3);
    check('dashboard/by-branch: branch A1 revenue=198.00, orderCount=3, aov=66.00', Boolean(rowA1) && closeEnough(rowA1.revenue, 198.0) && rowA1.orderCount === 3 && closeEnough(rowA1.aov, 66.0), rowA1);
    check('dashboard/by-branch: branch A2 revenue=220.00, orderCount=1, aov=220.00', Boolean(rowA2) && closeEnough(rowA2.revenue, 220.0) && rowA2.orderCount === 1 && closeEnough(rowA2.aov, 220.0), rowA2);
    check(
      'dashboard/by-branch: branch A3 (zero sales) is STILL included, revenue=0, orderCount=0, aov=0',
      Boolean(rowA3) && closeEnough(rowA3.revenue, 0) && rowA3.orderCount === 0 && closeEnough(rowA3.aov, 0),
      rowA3
    );

    const byBranchAsTenantB = await getJson(`${base}/api/v1/dashboard/by-branch?period=day`, adminBToken);
    check(
      "dashboard/by-branch: tenant B admin sees ONLY tenant B's own branch (1 row), never tenant A's",
      byBranchAsTenantB.data?.data?.length === 1 && byBranchAsTenantB.data.data[0]?.branchId === BRANCH_B1,
      byBranchAsTenantB.data
    );

    // =====================================================================
    // GET /finance/summary — ADMIN-only, revenue/tax/COGS.
    // =====================================================================
    const financeAsStaff = await getJson(`${base}/api/v1/finance/summary?period=day`, staffA1Token);
    check('finance/summary: STAFF -> 403 (ADMIN-only, whole route)', financeAsStaff.status === 403, financeAsStaff);

    const financeBadPeriod = await getJson(`${base}/api/v1/finance/summary?period=eon`, adminAToken);
    check('finance/summary: invalid period -> 400', financeBadPeriod.status === 400, financeBadPeriod);

    const financeCrossTenantBranch = await getJson(`${base}/api/v1/finance/summary?period=day&branchId=${BRANCH_B1}`, adminAToken);
    check('finance/summary: cross-tenant branch-id smuggling rejected -> 403', financeCrossTenantBranch.status === 403, financeCrossTenantBranch);

    const financeAll = await getJson(`${base}/api/v1/finance/summary?period=day`, adminAToken);
    check('finance/summary: admin (no branchId) -> 200', financeAll.status === 200, financeAll);
    check('finance/summary: revenue = 418.00', closeEnough(financeAll.data?.revenue, 418.0), financeAll.data);
    check('finance/summary: orderCount = 4', financeAll.data?.orderCount === 4, financeAll.data);
    check('finance/summary: taxCollected = 38.00 (10+5+20+3, excludes S5/S6)', closeEnough(financeAll.data?.taxCollected, 38.0), financeAll.data);
    check(
      'finance/summary: cogs.value = 250.00 (S1 100.00 + S3 150.00; S2 no link + S4 linked-no-cost excluded)',
      closeEnough(financeAll.data?.cogs?.value, 250.0),
      financeAll.data?.cogs
    );
    check('finance/summary: cogs.totalLineItemCount = 4', financeAll.data?.cogs?.totalLineItemCount === 4, financeAll.data?.cogs);
    check('finance/summary: cogs.costedLineItemCount = 2', financeAll.data?.cogs?.costedLineItemCount === 2, financeAll.data?.cogs);
    check('finance/summary: cogs.isPartial = true (2 of 4 lines costed)', financeAll.data?.cogs?.isPartial === true, financeAll.data?.cogs);
    check('finance/summary: cogs.note is a non-empty documentation string', typeof financeAll.data?.cogs?.note === 'string' && financeAll.data.cogs.note.length > 20, financeAll.data?.cogs);
    check('finance/summary: grossMarginEstimate = 418.00 - 250.00 = 168.00', closeEnough(financeAll.data?.grossMarginEstimate, 168.0), financeAll.data);

    const financeA1 = await getJson(`${base}/api/v1/finance/summary?period=day&branchId=${BRANCH_A1}`, adminAToken);
    check('finance/summary: branchId=A1 revenue = 198.00', closeEnough(financeA1.data?.revenue, 198.0), financeA1.data);
    check('finance/summary: branchId=A1 cogs.value = 100.00 (only S1 costed)', closeEnough(financeA1.data?.cogs?.value, 100.0), financeA1.data?.cogs);
    check('finance/summary: branchId=A1 cogs.totalLineItemCount = 3, costedLineItemCount = 1', financeA1.data?.cogs?.totalLineItemCount === 3 && financeA1.data?.cogs?.costedLineItemCount === 1, financeA1.data?.cogs);

    const financeA2 = await getJson(`${base}/api/v1/finance/summary?period=day&branchId=${BRANCH_A2}`, adminAToken);
    check('finance/summary: branchId=A2 revenue = 220.00, cogs.value = 150.00, isPartial = false (fully costed)', closeEnough(financeA2.data?.revenue, 220.0) && closeEnough(financeA2.data?.cogs?.value, 150.0) && financeA2.data?.cogs?.isPartial === false, financeA2.data);

    const financeAsTenantB = await getJson(`${base}/api/v1/finance/summary?period=day`, adminBToken);
    check(
      "finance/summary: tenant B admin sees ONLY tenant B's own revenue (990.00 total_amount) and tax (90.00), never tenant A's",
      closeEnough(financeAsTenantB.data?.revenue, 990.0) && closeEnough(financeAsTenantB.data?.taxCollected, 90.0),
      financeAsTenantB.data
    );
  });
  await pool.end();

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
