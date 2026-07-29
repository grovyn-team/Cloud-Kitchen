/**
 * P2-02/P2-03 — real-Postgres verification for the Sales module:
 *   - src/routes/sales.js (createSale, importSales, getRollup, listSales, getSale)
 *   - src/services/saleService.js (validation, createSale, listSales,
 *     getSaleById, getRollup, branchExistsInTenant)
 *   - src/services/salesCsvImportService.js (parse, validate-before-commit,
 *     insertSalesBatch)
 *   - src/services/csvSanitize.js (formula-injection defense)
 *   - src/middleware/csvUpload.js (multer memory storage, size/extension gate)
 *   - src/middleware/sessionAuth.js's isBranchAllowed extraction
 *
 * NOT part of `npm run verify` (no DB dependency there). Run explicitly:
 *
 *   npm run test:sales
 *
 * against a real Postgres with migrations 0000-0008 + bootstrap-roles.sql
 * applied (same container the sibling P1-02/P1-03/P1-04 suites use). This
 * suite SELF-SEEDS its own fixtures (two tenants, so cross-tenant isolation
 * is a real, provable HTTP-level check, not just branch scoping within one
 * tenant) via the migrator connection.
 *
 * No test framework, plain Node ESM + node:assert -- matches the sibling
 * suites' convention. Test app mounts the REAL route handlers/middleware in
 * the REAL composition order `routes/v1/index.js` uses (requireSession ->
 * requireRole -> [csvUpload.single + handleUploadError for import] ->
 * handler), not a re-implementation.
 */

import assert from 'node:assert';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';

import { login } from '../src/routes/auth.js';
import { requireSession, requireRole as requireSessionRole } from '../src/middleware/sessionAuth.js';
import { createSale, importSales, getRollup, listSales, getSale } from '../src/routes/sales.js';
import { csvUpload, handleUploadError } from '../src/middleware/csvUpload.js';
import { hashPassword } from '../src/services/passwordService.js';

const APP_URL =
  process.env.PGTEST_APP_URL || 'postgresql://grovyn_app:CHANGE_ME_APP@localhost:55433/grovyn';
const MIGRATOR_URL =
  process.env.PGTEST_MIGRATOR_URL ||
  'postgresql://grovyn_migrator:CHANGE_ME_MIGRATOR@localhost:55433/grovyn';

// Tenant A: the primary fixture (2 branches, 1 admin, 1 staff scoped to
// branch A1 only). Tenant B: a second, wholly separate tenant used ONLY to
// prove cross-tenant isolation (RLS blocks it entirely, not just a 403).
const TENANT_A = '99999999-5555-1111-1111-111111111111';
const TENANT_A_SLUG = 'sales-p202-a';
const TENANT_B = '99999999-6666-1111-1111-111111111111';
const TENANT_B_SLUG = 'sales-p202-b';

const BRANCH_A1 = '99999999-5555-2222-1111-111111111111';
const BRANCH_A2 = '99999999-5555-2222-2222-222222222222';
const BRANCH_B1 = '99999999-6666-2222-1111-111111111111';

const ADMIN_A_EMAIL = 'admin@sales-p202-a.example';
const STAFF_A1_EMAIL = 'staff1@sales-p202-a.example';
const ADMIN_B_EMAIL = 'admin@sales-p202-b.example';
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
// Seed
// ---------------------------------------------------------------------------
async function seed() {
  const client = new pg.Client({ connectionString: MIGRATOR_URL });
  await client.connect();
  try {
    const already = await client.query('SELECT count(*) AS n FROM tenant WHERE id = $1', [TENANT_A]);
    if (Number(already.rows[0].n) > 0) {
      console.log('[seed] sales fixture tenants already present, skipping seed.');
      return;
    }

    const pwHash = await hashPassword(REAL_PASSWORD);

    await client.query('BEGIN');
    await client.query('INSERT INTO tenant (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)', [
      TENANT_A,
      'Sales P2-02 Fixture A',
      TENANT_A_SLUG,
      TENANT_B,
      'Sales P2-02 Fixture B',
      TENANT_B_SLUG,
    ]);
    await client.query('INSERT INTO branch (id, tenant_id, name) VALUES ($1,$2,$3), ($4,$2,$5), ($6,$7,$8)', [
      BRANCH_A1,
      TENANT_A,
      'A-North',
      BRANCH_A2,
      'A-South',
      BRANCH_B1,
      TENANT_B,
      'B-Only',
    ]);

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
    await client.query('COMMIT');
    console.log('[seed] sales fixture tenants seeded:', { adminAId, staffA1Id, adminBId });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

// Direct-DB helpers (migrator connection, bypasses RLS -- used only to
// verify what actually landed in the table, independent of what the API
// reports back).
async function withMigrator(fn) {
  const client = new pg.Client({ connectionString: MIGRATOR_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function countSales({ tenantId, branchId, saleDate }) {
  return withMigrator(async (client) => {
    const r = await client.query(
      'SELECT count(*)::int AS n FROM sale WHERE tenant_id = $1 AND branch_id = $2 AND sale_date = $3',
      [tenantId, branchId, saleDate]
    );
    return r.rows[0].n;
  });
}

async function salesByImportBatch(importBatchRef) {
  return withMigrator(async (client) => {
    const r = await client.query('SELECT * FROM sale WHERE import_batch_ref = $1 ORDER BY created_at', [importBatchRef]);
    return r.rows;
  });
}

async function lineItemsBySaleId(saleId) {
  return withMigrator(async (client) => {
    const r = await client.query('SELECT * FROM sale_line_item WHERE sale_id = $1', [saleId]);
    return r.rows;
  });
}

// ---------------------------------------------------------------------------
// Test app: mounts the REAL handlers in the REAL composition order.
// ---------------------------------------------------------------------------
function buildTestApp(pool) {
  const app = express();
  app.use(express.json());

  app.post('/api/v1/auth/login', login(pool));

  const salesAuth = [requireSession(pool), requireSessionRole(['ADMIN', 'STAFF'])];
  app.post('/api/v1/sales', ...salesAuth, createSale(pool));
  app.post('/api/v1/sales/import', ...salesAuth, csvUpload.single('file'), handleUploadError, importSales(pool));
  app.get('/api/v1/sales/rollup', ...salesAuth, getRollup(pool));
  app.get('/api/v1/sales', ...salesAuth, listSales(pool));
  app.get('/api/v1/sales/:id', ...salesAuth, getSale(pool));

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

async function postMultipart(url, { branchId, filename, content, fieldName = 'file' }, token) {
  const form = new FormData();
  if (branchId !== undefined) form.append('branchId', branchId);
  form.append(fieldName, new Blob([content], { type: 'text/csv' }), filename);
  const r = await fetch(url, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
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

    // -----------------------------------------------------------------
    // Manual entry: happy path, server-computed totals, ignores a
    // client-sent total, MAX line item cap, branch-scope enforcement.
    // -----------------------------------------------------------------
    const createRes = await postJson(
      `${base}/api/v1/sales`,
      {
        branchId: BRANCH_A1,
        saleDate: '2026-02-01',
        paymentMethod: 'cash',
        taxAmount: 5,
        totalAmount: '999999.99', // client-sent total -- must be ignored
        lineItems: [
          { itemName: 'Veg Thali', quantity: 2, unitPrice: 150 },
          { itemName: 'Lassi', quantity: 3, unitPrice: 40 },
        ],
      },
      staffA1Token
    );
    check('Manual entry: staff creates sale in own branch -> 201', createRes.status === 201, createRes);
    const expectedSubtotal = (2 * 150 + 3 * 40).toFixed(2); // 420.00
    const expectedTotal = (420 + 5).toFixed(2); // 425.00
    check(
      'Manual entry: header total computed server-side from line items (client-sent total ignored)',
      createRes.data?.subtotalAmount === expectedSubtotal && createRes.data?.totalAmount === expectedTotal,
      { got: createRes.data, expectedSubtotal, expectedTotal }
    );
    check('Manual entry: 2 line items returned', createRes.data?.lineItems?.length === 2, createRes.data);
    const createdSaleId = createRes.data?.id;

    const staffWrongBranch = await postJson(
      `${base}/api/v1/sales`,
      { branchId: BRANCH_A2, saleDate: '2026-02-01', lineItems: [{ itemName: 'X', quantity: 1, unitPrice: 1 }] },
      staffA1Token
    );
    check('Manual entry: staff blocked from a branch they are not assigned to -> 403', staffWrongBranch.status === 403, staffWrongBranch);

    const adminOtherBranch = await postJson(
      `${base}/api/v1/sales`,
      { branchId: BRANCH_A2, saleDate: '2026-02-01', lineItems: [{ itemName: 'Y', quantity: 1, unitPrice: 10 }] },
      adminAToken
    );
    check('Manual entry: admin has implicit all-branch access within own tenant -> 201', adminOtherBranch.status === 201, adminOtherBranch);

    const missingLineItems = await postJson(`${base}/api/v1/sales`, { branchId: BRANCH_A1, saleDate: '2026-02-01', lineItems: [] }, staffA1Token);
    check('Manual entry: empty lineItems rejected -> 400', missingLineItems.status === 400, missingLineItems);

    const badBranch = await postJson(`${base}/api/v1/sales`, { branchId: 'not-a-uuid', saleDate: '2026-02-01', lineItems: [{ itemName: 'X', quantity: 1, unitPrice: 1 }] }, staffA1Token);
    check('Manual entry: malformed branchId rejected -> 400', badBranch.status === 400, badBranch);

    // Cross-tenant branch-id smuggling: ADMIN_B (tenant B) tries to write a
    // sale using tenant A's real branch id. isBranchAllowed() alone would
    // pass (ADMIN role), but branchExistsInTenant() must reject it because
    // BRANCH_A1 does not belong to tenant B.
    const crossTenantBranch = await postJson(
      `${base}/api/v1/sales`,
      { branchId: BRANCH_A1, saleDate: '2026-02-01', lineItems: [{ itemName: 'Smuggled', quantity: 1, unitPrice: 1 }] },
      adminBToken
    );
    check(
      'Manual entry: cross-tenant branch-id smuggling rejected -> 403 (not silently written with mismatched tenant_id/branch_id)',
      crossTenantBranch.status === 403,
      crossTenantBranch
    );

    // -----------------------------------------------------------------
    // Manual-entry transaction atomicity: a line item with a well-formed
    // but non-existent inventoryItemId trips the FK constraint AFTER the
    // sale header would already have been inserted in the same request --
    // proves the whole request is one transaction, not "header commits,
    // then line items fail".
    // -----------------------------------------------------------------
    const atomicityDate = '2031-01-01'; // rare date, easy to isolate
    const beforeCount = await countSales({ tenantId: TENANT_A, branchId: BRANCH_A1, saleDate: atomicityDate });
    const atomicityRes = await postJson(
      `${base}/api/v1/sales`,
      {
        branchId: BRANCH_A1,
        saleDate: atomicityDate,
        lineItems: [
          { itemName: 'Valid Item', quantity: 1, unitPrice: 10 },
          { itemName: 'Bad FK Item', quantity: 1, unitPrice: 10, inventoryItemId: crypto.randomUUID() },
        ],
      },
      staffA1Token
    );
    check('Atomicity: FK violation on a line item surfaces as 500 (generic, no stack leak)', atomicityRes.status === 500, atomicityRes);
    check(
      'Atomicity: 500 body has no internal detail leak',
      atomicityRes.data?.error === 'InternalServerError' && !JSON.stringify(atomicityRes.data).toLowerCase().includes('constraint'),
      atomicityRes.data
    );
    const afterCount = await countSales({ tenantId: TENANT_A, branchId: BRANCH_A1, saleDate: atomicityDate });
    check(
      'Atomicity: the sale header row that would have been inserted before the failing line item was ROLLED BACK (row count unchanged)',
      beforeCount === afterCount,
      { beforeCount, afterCount }
    );

    // -----------------------------------------------------------------
    // Detail / list: tenant isolation + branch scope, including the
    // no-existence-leak 404 posture.
    // -----------------------------------------------------------------
    const detailAsOwner = await getJson(`${base}/api/v1/sales/${createdSaleId}`, staffA1Token);
    check('Detail: staff can read their own branch sale -> 200', detailAsOwner.status === 200, detailAsOwner);
    check('Detail: line items included', Array.isArray(detailAsOwner.data?.lineItems) && detailAsOwner.data.lineItems.length === 2, detailAsOwner.data);

    const otherBranchSaleId = adminOtherBranch.data?.id;
    const detailWrongBranch = await getJson(`${base}/api/v1/sales/${otherBranchSaleId}`, staffA1Token);
    check('Detail: staff reading a sale outside their branch -> 404 (not 403, no existence leak)', detailWrongBranch.status === 404, detailWrongBranch);

    const detailCrossTenant = await getJson(`${base}/api/v1/sales/${createdSaleId}`, adminBToken);
    check('Detail: cross-tenant read of a real sale id -> 404 (RLS blocks it entirely)', detailCrossTenant.status === 404, detailCrossTenant);

    const listAsStaff = await getJson(`${base}/api/v1/sales?dateFrom=2026-02-01&dateTo=2026-02-01`, staffA1Token);
    check('List: staff (no branchId param) -> 200', listAsStaff.status === 200, listAsStaff);
    check(
      'List: staff result set contains ONLY their own branch (A1), never A2',
      listAsStaff.data?.data?.length > 0 && listAsStaff.data.data.every((s) => s.branchId === BRANCH_A1),
      listAsStaff.data
    );

    const listStaffOtherBranchFilter = await getJson(`${base}/api/v1/sales?branchId=${BRANCH_A2}`, staffA1Token);
    check('List: staff explicitly filtering by a branch outside their scope -> 403', listStaffOtherBranchFilter.status === 403, listStaffOtherBranchFilter);

    const listAsAdminB = await getJson(`${base}/api/v1/sales?dateFrom=2026-02-01&dateTo=2026-02-01`, adminBToken);
    check(
      'List: tenant B admin sees ZERO of tenant A\'s sales (RLS, not app filtering)',
      listAsAdminB.status === 200 && Array.isArray(listAsAdminB.data?.data) && listAsAdminB.data.data.length === 0,
      listAsAdminB.data
    );

    // -----------------------------------------------------------------
    // Rollup correctness against known seeded data.
    // -----------------------------------------------------------------
    const rollupDate = '2026-03-15';
    // Two sales in BRANCH_A1 on the same day: 100 + 200 = 300 revenue, 2 orders, AOV 150.
    await postJson(`${base}/api/v1/sales`, { branchId: BRANCH_A1, saleDate: rollupDate, lineItems: [{ itemName: 'R1', quantity: 1, unitPrice: 100 }] }, staffA1Token);
    await postJson(`${base}/api/v1/sales`, { branchId: BRANCH_A1, saleDate: rollupDate, lineItems: [{ itemName: 'R2', quantity: 1, unitPrice: 200 }] }, staffA1Token);

    const rollupRes = await getJson(`${base}/api/v1/sales/rollup?period=day&branchId=${BRANCH_A1}`, staffA1Token);
    check('Rollup: staff -> 200', rollupRes.status === 200, rollupRes);
    const rollupBucket = rollupRes.data?.data?.find((d) => d.periodStart?.startsWith(rollupDate));
    check(
      'Rollup: known-data correctness (revenue=300, orderCount=2, aov=150)',
      rollupBucket && rollupBucket.revenue === 300 && rollupBucket.orderCount === 2 && rollupBucket.aov === 150,
      rollupBucket
    );

    const rollupStaffOtherBranch = await getJson(`${base}/api/v1/sales/rollup?period=day&branchId=${BRANCH_A2}`, staffA1Token);
    check('Rollup: staff requesting a branch outside their scope -> 403', rollupStaffOtherBranch.status === 403, rollupStaffOtherBranch);

    const rollupMissingPeriod = await getJson(`${base}/api/v1/sales/rollup`, adminAToken);
    check('Rollup: missing period -> 400', rollupMissingPeriod.status === 400, rollupMissingPeriod);

    const rollupAdminAllBranches = await getJson(`${base}/api/v1/sales/rollup?period=day`, adminAToken);
    check('Rollup: admin omitting branchId -> 200 (all branches)', rollupAdminAllBranches.status === 200, rollupAdminAllBranches);
    check(
      'Rollup: admin all-branch result includes BOTH A1 and A2 branch ids',
      rollupAdminAllBranches.data?.data?.some((d) => d.branchId === BRANCH_A1) &&
        rollupAdminAllBranches.data?.data?.some((d) => d.branchId === BRANCH_A2),
      rollupAdminAllBranches.data
    );

    // -----------------------------------------------------------------
    // CSV import: structural validation, all-or-nothing, formula-injection
    // sanitization, file-size limit, row-count limit, extension check.
    // -----------------------------------------------------------------
    const importDate = '2026-04-01';
    const beforeImportCount = await countSales({ tenantId: TENANT_A, branchId: BRANCH_A1, saleDate: importDate });

    const missingColumnCsv = 'saleDate,itemName,quantity\n2026-04-01,Item,1\n';
    const missingColRes = await postMultipart(`${base}/api/v1/sales/import`, { branchId: BRANCH_A1, filename: 'bad.csv', content: missingColumnCsv }, staffA1Token);
    check('Import: missing required column -> 400 (structural, not row-level)', missingColRes.status === 400, missingColRes);

    const wrongExtRes = await postMultipart(`${base}/api/v1/sales/import`, { branchId: BRANCH_A1, filename: 'sales.txt', content: 'x' }, staffA1Token);
    check('Import: non-.csv extension rejected -> 400', wrongExtRes.status === 400, wrongExtRes);

    const missingBranchRes = await postMultipart(`${base}/api/v1/sales/import`, { filename: 'sales.csv', content: 'saleDate,itemName,quantity,unitPrice\n2026-04-01,X,1,1\n' }, staffA1Token);
    check('Import: missing branchId form field -> 400', missingBranchRes.status === 400, missingBranchRes);

    const staffWrongBranchImport = await postMultipart(
      `${base}/api/v1/sales/import`,
      { branchId: BRANCH_A2, filename: 'sales.csv', content: 'saleDate,itemName,quantity,unitPrice\n2026-04-01,X,1,1\n' },
      staffA1Token
    );
    check('Import: staff importing to a branch outside their scope -> 403', staffWrongBranchImport.status === 403, staffWrongBranchImport);

    const crossTenantImport = await postMultipart(
      `${base}/api/v1/sales/import`,
      { branchId: BRANCH_A1, filename: 'sales.csv', content: 'saleDate,itemName,quantity,unitPrice\n2026-04-01,X,1,1\n' },
      adminBToken
    );
    check('Import: cross-tenant branch-id smuggling on import -> 403', crossTenantImport.status === 403, crossTenantImport);

    // All-or-nothing: 3 valid rows + 1 invalid row (bad quantity) -> zero committed.
    const mixedCsv = [
      'saleDate,itemName,quantity,unitPrice,sku',
      '2026-04-01,Good Item 1,2,50,SKU1',
      '2026-04-01,Good Item 2,1,25,SKU2',
      '2026-04-01,Bad Item,not-a-number,25,SKU3',
      '2026-04-01,Good Item 3,3,10,SKU4',
    ].join('\n');
    const mixedRes = await postMultipart(`${base}/api/v1/sales/import`, { branchId: BRANCH_A1, filename: 'mixed.csv', content: mixedCsv }, staffA1Token);
    check('Import: mixed valid/invalid rows -> 422', mixedRes.status === 422, mixedRes);
    check('Import: importedCount is 0 on a rejected batch', mixedRes.data?.importedCount === 0, mixedRes.data);
    check('Import: exactly one row error reported', mixedRes.data?.errors?.length === 1, mixedRes.data);
    check('Import: row error references the correct 1-indexed-with-header row (row 4)', mixedRes.data?.errors?.[0]?.row === 4, mixedRes.data);

    const afterMixedCount = await countSales({ tenantId: TENANT_A, branchId: BRANCH_A1, saleDate: importDate });
    check('Import: all-or-nothing -- ZERO rows committed from the rejected batch', afterMixedCount === beforeImportCount, { beforeImportCount, afterMixedCount });

    // Fully valid batch, including a formula-injection payload in itemName.
    const goodCsv = [
      'saleDate,itemName,quantity,unitPrice,sku,paymentMethod',
      '2026-04-01,Good Item 1,2,50,SKU1,cash',
      '2026-04-01,=cmd|\'/c calc\'!A1,1,25,SKU2,upi',
      '2026-04-01,Good Item 3,3,10,SKU4,',
    ].join('\n');
    const goodRes = await postMultipart(`${base}/api/v1/sales/import`, { branchId: BRANCH_A1, filename: 'good.csv', content: goodCsv }, staffA1Token);
    check('Import: fully valid batch -> 201', goodRes.status === 201, goodRes);
    check('Import: importedCount === 3', goodRes.data?.importedCount === 3, goodRes.data);
    check('Import: errors is empty', Array.isArray(goodRes.data?.errors) && goodRes.data.errors.length === 0, goodRes.data);

    const importBatchRef = goodRes.data?.importBatchRef;
    const importedSales = await salesByImportBatch(importBatchRef);
    check('Import: all 3 rows share the same import_batch_ref', importedSales.length === 3, importedSales.length);
    check('Import: source is csv_import on every row', importedSales.every((s) => s.source === 'csv_import'), importedSales);

    const injectedSale = importedSales.find((s) => Number(s.subtotal_amount) === 25);
    const injectedLineItems = injectedSale ? await lineItemsBySaleId(injectedSale.id) : [];
    check(
      'Formula injection: stored itemName is prefixed with a literal-quote, never a raw "=" formula',
      injectedLineItems[0]?.item_name?.startsWith("'=cmd"),
      injectedLineItems[0]
    );

    const afterGoodCount = await countSales({ tenantId: TENANT_A, branchId: BRANCH_A1, saleDate: importDate });
    check('Import: exactly 3 new rows landed for this branch/date', afterGoodCount === beforeImportCount + 3, { beforeImportCount, afterGoodCount });

    // (b) file size limit: >5MB payload (via an oversized single cell) -> 413.
    const oversizedContent =
      'saleDate,itemName,quantity,unitPrice\n' + `2026-04-01,${'x'.repeat(6 * 1024 * 1024)},1,1\n`;
    const oversizedRes = await postMultipart(`${base}/api/v1/sales/import`, { branchId: BRANCH_A1, filename: 'huge.csv', content: oversizedContent }, staffA1Token);
    check('Import: file exceeding the 5MB limit -> 413', oversizedRes.status === 413, oversizedRes);

    // (c) row count limit: >10,000 rows (well under 5MB) -> 413, zero committed.
    const manyRowsHeader = 'saleDate,itemName,quantity,unitPrice';
    const manyRowsBody = Array.from({ length: 10001 }, (_, i) => `2026-04-02,Item ${i},1,10`).join('\n');
    const manyRowsCsv = `${manyRowsHeader}\n${manyRowsBody}\n`;
    const beforeRowLimitCount = await countSales({ tenantId: TENANT_A, branchId: BRANCH_A1, saleDate: '2026-04-02' });
    const rowLimitRes = await postMultipart(`${base}/api/v1/sales/import`, { branchId: BRANCH_A1, filename: 'toomany.csv', content: manyRowsCsv }, staffA1Token);
    check('Import: file exceeding the 10,000-row limit -> 413', rowLimitRes.status === 413, rowLimitRes);
    const afterRowLimitCount = await countSales({ tenantId: TENANT_A, branchId: BRANCH_A1, saleDate: '2026-04-02' });
    check('Import: row-limit rejection commits ZERO rows', afterRowLimitCount === beforeRowLimitCount, { beforeRowLimitCount, afterRowLimitCount });
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
