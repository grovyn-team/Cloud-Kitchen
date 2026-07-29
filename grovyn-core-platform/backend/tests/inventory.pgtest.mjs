/**
 * P2-05 backend (2026-07-30) — real-Postgres verification for the Inventory
 * module:
 *   - src/routes/inventoryManagement.js (createItem, updateItem, importItems,
 *     createRequest, listItems, getItem)
 *   - src/services/inventoryManagementService.js (validation, createItem,
 *     updateItem, listItems, getItemById, decrementForSaleLineItems,
 *     maybeCreateLowStockNotification)
 *   - src/services/inventoryImportService.js (CSV + XLSX parse,
 *     validate-before-commit, insertInventoryImportBatch)
 *   - src/services/branchAccessService.js (branchExistsInTenant, shared with
 *     Sales)
 *   - src/middleware/inventoryUpload.js (multer memory storage, size/
 *     extension gate)
 *   - saleService.createSale's sale-triggered inventory decrement wiring
 *     (cross-module: `src/routes/sales.js` + `src/services/saleService.js`)
 *
 * NOT part of `npm run verify` (no DB dependency there). Run explicitly:
 *
 *   npm run test:inventory
 *
 * against a real Postgres with migrations 0000-0010 + bootstrap-roles.sql
 * applied (same container the sibling P1-02/P1-03/P1-04/P2-02 suites use).
 * This suite SELF-SEEDS its own fixtures (two tenants) via the migrator
 * connection, using tenant/branch ids distinct from `sales.pgtest.mjs`'s
 * fixtures so both suites can run against the same shared database without
 * colliding.
 *
 * No test framework, plain Node ESM + node:assert -- matches the sibling
 * suites' convention. Test app mounts the REAL route handlers/middleware in
 * the REAL composition order `routes/v1/index.js` uses.
 */

import assert from 'node:assert';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';
import ExcelJS from 'exceljs';

import { login } from '../src/routes/auth.js';
import { requireSession, requireRole as requireSessionRole } from '../src/middleware/sessionAuth.js';
import { createSale } from '../src/routes/sales.js';
import {
  createItem,
  updateItem,
  importItems,
  createRequest,
  listItems,
  getItem,
} from '../src/routes/inventoryManagement.js';
import { inventoryUpload, handleInventoryUploadError } from '../src/middleware/inventoryUpload.js';
import { hashPassword } from '../src/services/passwordService.js';

const APP_URL =
  process.env.PGTEST_APP_URL || 'postgresql://grovyn_app:CHANGE_ME_APP@localhost:55433/grovyn';
const MIGRATOR_URL =
  process.env.PGTEST_MIGRATOR_URL ||
  'postgresql://grovyn_migrator:CHANGE_ME_MIGRATOR@localhost:55433/grovyn';

// Distinct ids/slugs from `sales.pgtest.mjs`'s fixtures so both suites can
// run against the same shared database without colliding.
const TENANT_A = '88888888-5555-1111-1111-111111111111';
const TENANT_A_SLUG = 'inventory-p205-a';
const TENANT_B = '88888888-6666-1111-1111-111111111111';
const TENANT_B_SLUG = 'inventory-p205-b';

const BRANCH_A1 = '88888888-5555-2222-1111-111111111111';
const BRANCH_A2 = '88888888-5555-2222-2222-222222222222';
const BRANCH_B1 = '88888888-6666-2222-1111-111111111111';

const ADMIN_A_EMAIL = 'admin@inventory-p205-a.example';
const STAFF_A1_EMAIL = 'staff1@inventory-p205-a.example';
const ADMIN_B_EMAIL = 'admin@inventory-p205-b.example';
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
      console.log('[seed] inventory fixture tenants already present, skipping seed.');
      return;
    }

    const pwHash = await hashPassword(REAL_PASSWORD);

    await client.query('BEGIN');
    await client.query('INSERT INTO tenant (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)', [
      TENANT_A,
      'Inventory P2-05 Fixture A',
      TENANT_A_SLUG,
      TENANT_B,
      'Inventory P2-05 Fixture B',
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
    console.log('[seed] inventory fixture tenants seeded:', { adminAId, staffA1Id, adminBId });
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

async function getItemRow(id) {
  return withMigrator(async (client) => {
    const r = await client.query('SELECT * FROM inventory_item WHERE id = $1', [id]);
    return r.rows[0] || null;
  });
}

async function movementsForItem(itemId) {
  return withMigrator(async (client) => {
    const r = await client.query('SELECT * FROM inventory_movement WHERE item_id = $1 ORDER BY created_at', [itemId]);
    return r.rows;
  });
}

async function movementsByImportBatch(importBatchRef) {
  return withMigrator(async (client) => {
    const r = await client.query('SELECT * FROM inventory_movement WHERE import_batch_ref = $1 ORDER BY created_at', [importBatchRef]);
    return r.rows;
  });
}

async function auditLogFor(entityType, entityId) {
  return withMigrator(async (client) => {
    const r = await client.query('SELECT * FROM audit_log WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at', [entityType, entityId]);
    return r.rows;
  });
}

async function notificationsFor(relatedEntityType, relatedEntityId) {
  return withMigrator(async (client) => {
    const r = await client.query(
      'SELECT * FROM notification WHERE related_entity_type = $1 AND related_entity_id = $2 ORDER BY created_at',
      [relatedEntityType, relatedEntityId]
    );
    return r.rows;
  });
}

async function notificationsByType(tenantId, branchId, type) {
  return withMigrator(async (client) => {
    const r = await client.query(
      'SELECT * FROM notification WHERE tenant_id = $1 AND branch_id = $2 AND type = $3 ORDER BY created_at',
      [tenantId, branchId, type]
    );
    return r.rows;
  });
}

async function countSaleRows(tenantId, branchId, saleDate) {
  return withMigrator(async (client) => {
    const r = await client.query('SELECT count(*)::int AS n FROM sale WHERE tenant_id = $1 AND branch_id = $2 AND sale_date = $3', [
      tenantId,
      branchId,
      saleDate,
    ]);
    return r.rows[0].n;
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

  const invAuth = [requireSession(pool), requireSessionRole(['ADMIN', 'STAFF'])];
  app.post('/api/v1/inventory/items', ...invAuth, createItem(pool));
  app.patch('/api/v1/inventory/items/:id', ...invAuth, updateItem(pool));
  app.post('/api/v1/inventory/import', ...invAuth, inventoryUpload.single('file'), handleInventoryUploadError, importItems(pool));
  app.post('/api/v1/inventory/requests', ...invAuth, createRequest(pool));
  app.get('/api/v1/inventory/items', ...invAuth, listItems(pool));
  app.get('/api/v1/inventory/items/:id', ...invAuth, getItem(pool));

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

async function patchJson(url, body, token) {
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  let data = null;
  try {
    data = await r.json();
  } catch {
    /* ignore */
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

async function postMultipart(url, { branchId, filename, content, fieldName = 'file', contentType = 'text/csv' }, token) {
  const form = new FormData();
  if (branchId !== undefined) form.append('branchId', branchId);
  form.append(fieldName, new Blob([content], { type: contentType }), filename);
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

async function buildXlsxBuffer(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Items');
  sheet.addRow(['name', 'unit', 'quantity', 'sku', 'lowStockThreshold', 'costPerUnit']);
  rows.forEach((r) => sheet.addRow([r.name, r.unit, r.quantity, r.sku ?? '', r.lowStockThreshold ?? '', r.costPerUnit ?? '']));
  return workbook.xlsx.writeBuffer();
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
    // Manual create: happy path, branch scope, cross-tenant smuggling,
    // audit_log write, initial-stock movement.
    // -----------------------------------------------------------------
    const createRes = await postJson(
      `${base}/api/v1/inventory/items`,
      { branchId: BRANCH_A1, name: 'Paneer', unit: 'kg', sku: 'PNR-1', lowStockThreshold: 10, costPerUnit: 250, initialStock: 50 },
      staffA1Token
    );
    check('Create: staff creates item in own branch -> 201', createRes.status === 201, createRes);
    check('Create: currentStock reflects initialStock', createRes.data?.currentStock === '50.000', createRes.data);
    check('Create: initialMovement returned (restock)', createRes.data?.initialMovement?.movementType === 'restock', createRes.data);
    const paneerItemId = createRes.data?.id;

    const auditForCreate = await auditLogFor('inventory_item', paneerItemId);
    check('Create: audit_log row written with action inventory.create', auditForCreate.some((a) => a.action === 'inventory.create'), auditForCreate);

    const createZeroStockRes = await postJson(
      `${base}/api/v1/inventory/items`,
      { branchId: BRANCH_A1, name: 'Salt', unit: 'kg' },
      staffA1Token
    );
    check('Create: zero initialStock -> no initialMovement', createZeroStockRes.status === 201 && createZeroStockRes.data?.initialMovement === null, createZeroStockRes.data);

    const staffWrongBranchCreate = await postJson(
      `${base}/api/v1/inventory/items`,
      { branchId: BRANCH_A2, name: 'X', unit: 'kg' },
      staffA1Token
    );
    check('Create: staff blocked from a branch they are not assigned to -> 403', staffWrongBranchCreate.status === 403, staffWrongBranchCreate);

    const adminOtherBranchCreate = await postJson(
      `${base}/api/v1/inventory/items`,
      { branchId: BRANCH_A2, name: 'Y', unit: 'kg' },
      adminAToken
    );
    check('Create: admin has implicit all-branch access within own tenant -> 201', adminOtherBranchCreate.status === 201, adminOtherBranchCreate);

    const missingName = await postJson(`${base}/api/v1/inventory/items`, { branchId: BRANCH_A1, unit: 'kg' }, staffA1Token);
    check('Create: missing name -> 400', missingName.status === 400, missingName);

    const badBranch = await postJson(`${base}/api/v1/inventory/items`, { branchId: 'not-a-uuid', name: 'X', unit: 'kg' }, staffA1Token);
    check('Create: malformed branchId -> 400', badBranch.status === 400, badBranch);

    const crossTenantCreate = await postJson(
      `${base}/api/v1/inventory/items`,
      { branchId: BRANCH_A1, name: 'Smuggled', unit: 'kg' },
      adminBToken
    );
    check('Create: cross-tenant branch-id smuggling rejected -> 403', crossTenantCreate.status === 403, crossTenantCreate);

    // -----------------------------------------------------------------
    // PATCH edit: metadata-only (no movement), stock adjustment (movement +
    // low-stock trigger + dedupe), negative-result rejection (no partial
    // write), branch/tenant scope 404s.
    // -----------------------------------------------------------------
    const renameRes = await patchJson(`${base}/api/v1/inventory/items/${paneerItemId}`, { name: 'Paneer (Fresh)' }, staffA1Token);
    check('PATCH: metadata-only edit -> 200', renameRes.status === 200, renameRes);
    check('PATCH: name updated', renameRes.data?.name === 'Paneer (Fresh)', renameRes.data);
    check('PATCH: metadata-only edit writes no movement', renameRes.data?.movement === null, renameRes.data);

    const movementsAfterRename = await movementsForItem(paneerItemId);
    check('PATCH: metadata-only edit -- movement row count still 1 (only the initial restock)', movementsAfterRename.length === 1, movementsAfterRename.length);

    const auditForUpdate = await auditLogFor('inventory_item', paneerItemId);
    check('PATCH: audit_log row written with action inventory.update', auditForUpdate.some((a) => a.action === 'inventory.update'), auditForUpdate);

    const emptyPatch = await patchJson(`${base}/api/v1/inventory/items/${paneerItemId}`, {}, staffA1Token);
    check('PATCH: empty body -> 400', emptyPatch.status === 400, emptyPatch);

    // Stock adjustment: 50 -> 45 (still above threshold 10).
    const adjustRes = await patchJson(
      `${base}/api/v1/inventory/items/${paneerItemId}`,
      { stockAdjustment: { quantityDelta: -5, reason: 'Spoilage' } },
      staffA1Token
    );
    check('PATCH: stock adjustment -> 200', adjustRes.status === 200, adjustRes);
    check('PATCH: currentStock updated to 45.000', adjustRes.data?.currentStock === '45.000', adjustRes.data);
    check('PATCH: movement row returned (correction, negative delta)', adjustRes.data?.movement?.movementType === 'correction', adjustRes.data);

    const noLowStockYet = await notificationsFor('inventory_item', paneerItemId);
    check('PATCH: no low-stock notification yet (45 > threshold 10)', noLowStockYet.length === 0, noLowStockYet);

    // Drive stock down to 8 (<= threshold 10) -> low-stock notification fires.
    const adjustLowRes = await patchJson(
      `${base}/api/v1/inventory/items/${paneerItemId}`,
      { stockAdjustment: { quantityDelta: -37 } },
      staffA1Token
    );
    check('PATCH: stock adjustment driving below threshold -> 200', adjustLowRes.status === 200, adjustLowRes);
    check('PATCH: currentStock is 8.000', adjustLowRes.data?.currentStock === '8.000', adjustLowRes.data);

    const lowStockNotifs1 = await notificationsFor('inventory_item', paneerItemId);
    check('PATCH: low-stock notification created (8 <= 10)', lowStockNotifs1.length === 1 && lowStockNotifs1[0].type === 'low_stock', lowStockNotifs1);

    // A second below-threshold adjustment must NOT create a second
    // notification (de-dupe: an unresolved low_stock notification already
    // exists for this item).
    const adjustLowAgainRes = await patchJson(
      `${base}/api/v1/inventory/items/${paneerItemId}`,
      { stockAdjustment: { quantityDelta: -1 } },
      staffA1Token
    );
    check('PATCH: second below-threshold adjustment -> 200', adjustLowAgainRes.status === 200, adjustLowAgainRes);
    const lowStockNotifs2 = await notificationsFor('inventory_item', paneerItemId);
    check('PATCH: de-dupe -- still exactly ONE low-stock notification', lowStockNotifs2.length === 1, lowStockNotifs2);

    // currentStock is now 7.000. A stockAdjustment of -100 would go
    // negative -> rejected, AND the rename attempted in the SAME request
    // must NOT be applied either (no partial write).
    const itemBeforeNegative = await getItemRow(paneerItemId);
    const movementsBeforeNegative = await movementsForItem(paneerItemId);
    const auditBeforeNegative = await auditLogFor('inventory_item', paneerItemId);
    const negativeRes = await patchJson(
      `${base}/api/v1/inventory/items/${paneerItemId}`,
      { name: 'Should Not Apply', stockAdjustment: { quantityDelta: -100 } },
      staffA1Token
    );
    check('PATCH: stockAdjustment driving stock negative -> 400', negativeRes.status === 400, negativeRes);
    const itemAfterNegative = await getItemRow(paneerItemId);
    check('PATCH: rejected adjustment -- name NOT changed (no partial write)', itemAfterNegative.name === itemBeforeNegative.name, {
      before: itemBeforeNegative.name,
      after: itemAfterNegative.name,
    });
    check(
      'PATCH: rejected adjustment -- currentStock unchanged',
      itemAfterNegative.current_stock === itemBeforeNegative.current_stock,
      { before: itemBeforeNegative.current_stock, after: itemAfterNegative.current_stock }
    );
    const movementsAfterNegative = await movementsForItem(paneerItemId);
    check('PATCH: rejected adjustment -- no new movement row', movementsAfterNegative.length === movementsBeforeNegative.length, {
      before: movementsBeforeNegative.length,
      after: movementsAfterNegative.length,
    });
    const auditAfterNegative = await auditLogFor('inventory_item', paneerItemId);
    check('PATCH: rejected adjustment -- no new audit_log row', auditAfterNegative.length === auditBeforeNegative.length, {
      before: auditBeforeNegative.length,
      after: auditAfterNegative.length,
    });

    // Clearing costPerUnit via explicit null (sku is deliberately left alone
    // here -- the CSV import test below matches-by-sku against this same
    // item and needs 'PNR-1' to still be set).
    const clearCostRes = await patchJson(`${base}/api/v1/inventory/items/${paneerItemId}`, { costPerUnit: null }, staffA1Token);
    check('PATCH: costPerUnit cleared via explicit null -> 200', clearCostRes.status === 200 && clearCostRes.data?.costPerUnit === null, clearCostRes.data);

    const patchStaffWrongBranch = await patchJson(`${base}/api/v1/inventory/items/${adminOtherBranchCreate.data.id}`, { name: 'Z' }, staffA1Token);
    check('PATCH: staff editing an item outside their branch -> 404 (no existence leak)', patchStaffWrongBranch.status === 404, patchStaffWrongBranch);

    const patchCrossTenant = await patchJson(`${base}/api/v1/inventory/items/${paneerItemId}`, { name: 'Z' }, adminBToken);
    check('PATCH: cross-tenant edit of a real item id -> 404', patchCrossTenant.status === 404, patchCrossTenant);

    // -----------------------------------------------------------------
    // List / detail.
    // -----------------------------------------------------------------
    const listAsStaff = await getJson(`${base}/api/v1/inventory/items`, staffA1Token);
    check('List: staff (no branchId) -> 200', listAsStaff.status === 200, listAsStaff);
    check(
      'List: staff result set contains ONLY their own branch (A1)',
      listAsStaff.data?.data?.length > 0 && listAsStaff.data.data.every((i) => i.branchId === BRANCH_A1),
      listAsStaff.data
    );

    const listStaffOtherBranch = await getJson(`${base}/api/v1/inventory/items?branchId=${BRANCH_A2}`, staffA1Token);
    check('List: staff filtering by a branch outside their scope -> 403', listStaffOtherBranch.status === 403, listStaffOtherBranch);

    const listLowStock = await getJson(`${base}/api/v1/inventory/items?branchId=${BRANCH_A1}&lowStock=true`, staffA1Token);
    check('List: lowStock=true -> 200', listLowStock.status === 200, listLowStock);
    check(
      'List: lowStock filter includes Paneer (7 <= threshold 10)',
      listLowStock.data?.data?.some((i) => i.id === paneerItemId),
      listLowStock.data
    );
    check(
      'List: lowStock filter excludes Salt (no threshold set)',
      !listLowStock.data?.data?.some((i) => i.name === 'Salt'),
      listLowStock.data
    );

    const listAsAdminB = await getJson(`${base}/api/v1/inventory/items`, adminBToken);
    check(
      "List: tenant B admin sees ZERO of tenant A's items (RLS, not app filtering)",
      listAsAdminB.status === 200 && Array.isArray(listAsAdminB.data?.data) && listAsAdminB.data.data.length === 0,
      listAsAdminB.data
    );

    const detailAsOwner = await getJson(`${base}/api/v1/inventory/items/${paneerItemId}`, staffA1Token);
    check('Detail: staff can read their own branch item -> 200', detailAsOwner.status === 200, detailAsOwner);
    check('Detail: recentMovements included', Array.isArray(detailAsOwner.data?.recentMovements) && detailAsOwner.data.recentMovements.length > 0, detailAsOwner.data);

    const detailWrongBranch = await getJson(`${base}/api/v1/inventory/items/${adminOtherBranchCreate.data.id}`, staffA1Token);
    check('Detail: staff reading an item outside their branch -> 404', detailWrongBranch.status === 404, detailWrongBranch);

    const detailCrossTenant = await getJson(`${base}/api/v1/inventory/items/${paneerItemId}`, adminBToken);
    check('Detail: cross-tenant read of a real item id -> 404', detailCrossTenant.status === 404, detailCrossTenant);

    // -----------------------------------------------------------------
    // CSV import: structural validation, all-or-nothing, formula-injection
    // sanitization, extension check, file-size + row-count caps,
    // create-vs-update matching by sku, shared import_batch_ref.
    // -----------------------------------------------------------------
    const missingColumnCsv = 'name,unit\nFlour,kg\n';
    const missingColRes = await postMultipart(`${base}/api/v1/inventory/import`, { branchId: BRANCH_A1, filename: 'bad.csv', content: missingColumnCsv }, staffA1Token);
    check('Import: missing required column -> 400', missingColRes.status === 400, missingColRes);

    const wrongExtRes = await postMultipart(`${base}/api/v1/inventory/import`, { branchId: BRANCH_A1, filename: 'items.txt', content: 'x' }, staffA1Token);
    check('Import: non-.csv/.xlsx extension rejected -> 400', wrongExtRes.status === 400, wrongExtRes);

    const missingBranchRes = await postMultipart(`${base}/api/v1/inventory/import`, { filename: 'items.csv', content: 'name,unit,quantity\nFlour,kg,10\n' }, staffA1Token);
    check('Import: missing branchId form field -> 400', missingBranchRes.status === 400, missingBranchRes);

    const staffWrongBranchImport = await postMultipart(
      `${base}/api/v1/inventory/import`,
      { branchId: BRANCH_A2, filename: 'items.csv', content: 'name,unit,quantity\nFlour,kg,10\n' },
      staffA1Token
    );
    check('Import: staff importing to a branch outside their scope -> 403', staffWrongBranchImport.status === 403, staffWrongBranchImport);

    const crossTenantImport = await postMultipart(
      `${base}/api/v1/inventory/import`,
      { branchId: BRANCH_A1, filename: 'items.csv', content: 'name,unit,quantity\nFlour,kg,10\n' },
      adminBToken
    );
    check('Import: cross-tenant branch-id smuggling -> 403', crossTenantImport.status === 403, crossTenantImport);

    // All-or-nothing: 2 valid rows + 1 invalid row (bad quantity) -> zero committed.
    const importSkuA = `IMP-A-${crypto.randomUUID().slice(0, 8)}`;
    const mixedCsv = [
      'name,unit,quantity,sku',
      `Good Item 1,kg,5,${importSkuA}`,
      'Bad Item,kg,not-a-number,IMP-BAD',
      'Good Item 2,kg,3,IMP-C',
    ].join('\n');
    const mixedRes = await postMultipart(`${base}/api/v1/inventory/import`, { branchId: BRANCH_A1, filename: 'mixed.csv', content: mixedCsv }, staffA1Token);
    check('Import: mixed valid/invalid rows -> 422', mixedRes.status === 422, mixedRes);
    check('Import: importedCount is 0 on a rejected batch', mixedRes.data?.importedCount === 0, mixedRes.data);
    check('Import: exactly one row error reported', mixedRes.data?.errors?.length === 1, mixedRes.data);
    check('Import: row error references row 3', mixedRes.data?.errors?.[0]?.row === 3, mixedRes.data);

    const itemsWithSkuABeforeGood = await withMigrator((c) => c.query('SELECT count(*)::int AS n FROM inventory_item WHERE sku = $1', [importSkuA]));
    check('Import: all-or-nothing -- ZERO rows committed from the rejected batch', Number(itemsWithSkuABeforeGood.rows[0].n) === 0, itemsWithSkuABeforeGood.rows[0]);

    // Fully valid batch: create Good Item 1 (new, formula-injection payload
    // in name) + update Paneer (existing, matched by sku) by adding stock.
    const paneerBeforeImport = await getItemRow(paneerItemId);
    const goodCsv = [
      'name,unit,quantity,sku,lowStockThreshold,costPerUnit',
      `=cmd|'/c calc'!A1,kg,5,${importSkuA},2,100`,
      'Paneer (Fresh),kg,20,PNR-1,,',
    ].join('\n');
    const goodRes = await postMultipart(`${base}/api/v1/inventory/import`, { branchId: BRANCH_A1, filename: 'good.csv', content: goodCsv }, staffA1Token);
    check('Import: fully valid batch -> 201', goodRes.status === 201, goodRes);
    check('Import: importedCount === 2', goodRes.data?.importedCount === 2, goodRes.data);
    check('Import: createdCount === 1, updatedCount === 1', goodRes.data?.createdCount === 1 && goodRes.data?.updatedCount === 1, goodRes.data);

    const importBatchRef = goodRes.data?.importBatchRef;
    const importMovements = await movementsByImportBatch(importBatchRef);
    check('Import: 2 movement rows share the same import_batch_ref', importMovements.length === 2, importMovements.length);
    check('Import: movement rows are movement_type=excel_import', importMovements.every((m) => m.movement_type === 'excel_import'), importMovements);

    const injectedItem = await withMigrator((c) => c.query('SELECT * FROM inventory_item WHERE sku = $1', [importSkuA]));
    check(
      'Formula injection (CSV): stored name is prefixed with a literal-quote, never a raw "=" formula',
      injectedItem.rows[0]?.name?.startsWith("'=cmd"),
      injectedItem.rows[0]
    );

    const paneerAfterImport = await getItemRow(paneerItemId);
    check(
      'Import: matched-by-sku row ADDS to existing stock (update, not overwrite)',
      Number(paneerAfterImport.current_stock) === Number(paneerBeforeImport.current_stock) + 20,
      { before: paneerBeforeImport.current_stock, after: paneerAfterImport.current_stock }
    );

    // (b) file size limit: >5MB payload -> 413.
    const oversizedContent = 'name,unit,quantity\n' + `${'x'.repeat(6 * 1024 * 1024)},kg,1\n`;
    const oversizedRes = await postMultipart(`${base}/api/v1/inventory/import`, { branchId: BRANCH_A1, filename: 'huge.csv', content: oversizedContent }, staffA1Token);
    check('Import: file exceeding the 5MB limit -> 413', oversizedRes.status === 413, oversizedRes);

    // (c) row count limit: >10,000 rows -> 413, zero committed.
    const manyRowsHeader = 'name,unit,quantity';
    const manyRowsBody = Array.from({ length: 10001 }, (_, i) => `Item ${i},kg,1`).join('\n');
    const manyRowsCsv = `${manyRowsHeader}\n${manyRowsBody}\n`;
    const rowLimitRes = await postMultipart(`${base}/api/v1/inventory/import`, { branchId: BRANCH_A1, filename: 'toomany.csv', content: manyRowsCsv }, staffA1Token);
    check('Import: file exceeding the 10,000-row limit -> 413', rowLimitRes.status === 413, rowLimitRes);

    // -----------------------------------------------------------------
    // XLSX import: real .xlsx round trip via exceljs, including a
    // formula-injection payload stored as a raw string cell (not an actual
    // Excel formula).
    // -----------------------------------------------------------------
    const importSkuXlsx = `IMP-X-${crypto.randomUUID().slice(0, 8)}`;
    const xlsxBuffer = await buildXlsxBuffer([
      { name: 'Xlsx Item', unit: 'kg', quantity: 7, sku: importSkuXlsx, lowStockThreshold: 1, costPerUnit: 50 },
      { name: '=1+1', unit: 'kg', quantity: 3, sku: `IMP-X2-${crypto.randomUUID().slice(0, 8)}` },
    ]);
    const xlsxRes = await postMultipart(
      `${base}/api/v1/inventory/import`,
      { branchId: BRANCH_A1, filename: 'items.xlsx', content: xlsxBuffer, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      staffA1Token
    );
    check('Import (XLSX): fully valid workbook -> 201', xlsxRes.status === 201, xlsxRes);
    check('Import (XLSX): importedCount === 2', xlsxRes.data?.importedCount === 2, xlsxRes.data);

    const xlsxItem = await withMigrator((c) => c.query('SELECT * FROM inventory_item WHERE sku = $1', [importSkuXlsx]));
    check('Import (XLSX): item created with correct stock', Number(xlsxItem.rows[0]?.current_stock) === 7, xlsxItem.rows[0]);

    const xlsxInjectedItem = await withMigrator((c) => c.query("SELECT * FROM inventory_item WHERE name LIKE '''=1%'"));
    check(
      'Formula injection (XLSX): stored name is prefixed with a literal-quote',
      xlsxInjectedItem.rows.length === 1,
      xlsxInjectedItem.rows
    );

    // -----------------------------------------------------------------
    // Staff request flow.
    // -----------------------------------------------------------------
    const requestRes = await postJson(
      `${base}/api/v1/inventory/requests`,
      { branchId: BRANCH_A1, itemName: 'Paneer', message: 'Running low, need 10kg more by Friday.' },
      staffA1Token
    );
    check('Request: staff raises a stock request -> 201', requestRes.status === 201, requestRes);
    check('Request: notification type is inventory_request', requestRes.data?.type === 'inventory_request', requestRes.data);

    const requestNotifs = await notificationsByType(TENANT_A, BRANCH_A1, 'inventory_request');
    check('Request: notification row persisted, branch-scoped', requestNotifs.some((n) => n.id === requestRes.data.id), requestNotifs);

    const requestMissingMessage = await postJson(`${base}/api/v1/inventory/requests`, { branchId: BRANCH_A1 }, staffA1Token);
    check('Request: missing message -> 400', requestMissingMessage.status === 400, requestMissingMessage);

    const requestWrongBranch = await postJson(`${base}/api/v1/inventory/requests`, { branchId: BRANCH_A2, message: 'X' }, staffA1Token);
    check('Request: staff requesting for a branch outside their scope -> 403', requestWrongBranch.status === 403, requestWrongBranch);

    const requestCrossTenant = await postJson(`${base}/api/v1/inventory/requests`, { branchId: BRANCH_A1, message: 'X' }, adminBToken);
    check('Request: cross-tenant branch-id smuggling -> 403', requestCrossTenant.status === 403, requestCrossTenant);

    const requestWithItemRes = await postJson(
      `${base}/api/v1/inventory/requests`,
      { branchId: BRANCH_A1, inventoryItemId: paneerItemId, message: '=formula-in-message' },
      staffA1Token
    );
    check('Request: linked inventoryItemId populates relatedEntityId', requestWithItemRes.data?.relatedEntityId === paneerItemId, requestWithItemRes.data);
    check(
      'Request: formula-injection in message is sanitized',
      requestWithItemRes.data?.message?.startsWith("'="),
      requestWithItemRes.data
    );

    const requestMismatchedItem = await postJson(
      `${base}/api/v1/inventory/requests`,
      { branchId: BRANCH_A1, inventoryItemId: adminOtherBranchCreate.data.id, message: 'Wrong-branch item id' },
      staffA1Token
    );
    check(
      'Request: inventoryItemId belonging to a different branch is silently dropped (still 201, relatedEntityId null)',
      requestMismatchedItem.status === 201 && requestMismatchedItem.data?.relatedEntityId === null,
      requestMismatchedItem.data
    );

    // -----------------------------------------------------------------
    // Sale-triggered decrement (cross-module: saleService.createSale ->
    // inventoryManagementService.decrementForSaleLineItems), including
    // branch-mismatch skip and cross-module transaction atomicity.
    // -----------------------------------------------------------------
    const stockItemRes = await postJson(
      `${base}/api/v1/inventory/items`,
      { branchId: BRANCH_A1, name: 'Chicken', unit: 'kg', lowStockThreshold: 20, initialStock: 100 },
      staffA1Token
    );
    const chickenId = stockItemRes.data.id;

    const saleDate1 = '2026-05-01';
    const sale1Res = await postJson(
      `${base}/api/v1/sales`,
      { branchId: BRANCH_A1, saleDate: saleDate1, lineItems: [{ itemName: 'Chicken Curry', quantity: 30, unitPrice: 20, inventoryItemId: chickenId }] },
      staffA1Token
    );
    check('Sale-triggered decrement: sale created -> 201', sale1Res.status === 201, sale1Res);

    const chickenAfterSale1 = await getItemRow(chickenId);
    check('Sale-triggered decrement: currentStock reduced by 30 (100 -> 70)', Number(chickenAfterSale1.current_stock) === 70, chickenAfterSale1.current_stock);

    const chickenMovements1 = await movementsForItem(chickenId);
    const saleMovement1 = chickenMovements1.find((m) => m.movement_type === 'sale_deduction');
    check(
      'Sale-triggered decrement: inventory_movement row is sale_deduction with negative delta and related_sale_id set',
      saleMovement1 && Number(saleMovement1.quantity_delta) === -30 && Number(saleMovement1.resulting_stock) === 70 && saleMovement1.related_sale_id === sale1Res.data.id,
      saleMovement1
    );

    // Drive it below the 20 threshold -> low-stock notification fires.
    const sale2Res = await postJson(
      `${base}/api/v1/sales`,
      { branchId: BRANCH_A1, saleDate: saleDate1, lineItems: [{ itemName: 'Chicken Curry', quantity: 55, unitPrice: 20, inventoryItemId: chickenId }] },
      staffA1Token
    );
    check('Sale-triggered decrement: second sale -> 201', sale2Res.status === 201, sale2Res);
    const chickenAfterSale2 = await getItemRow(chickenId);
    check('Sale-triggered decrement: currentStock is 15 (<= threshold 20)', Number(chickenAfterSale2.current_stock) === 15, chickenAfterSale2.current_stock);
    const chickenLowStockNotifs = await notificationsFor('inventory_item', chickenId);
    check('Sale-triggered decrement: low-stock notification fired', chickenLowStockNotifs.length === 1 && chickenLowStockNotifs[0].type === 'low_stock', chickenLowStockNotifs);

    // Branch-mismatch skip: item2 lives in BRANCH_A2 (owned by adminA), a
    // sale for BRANCH_A1 references it -- sale succeeds, decrement is
    // silently skipped (branch mismatch), item2's stock is untouched.
    const item2Res = await postJson(`${base}/api/v1/inventory/items`, { branchId: BRANCH_A2, name: 'Rice', unit: 'kg', initialStock: 40 }, adminAToken);
    const item2Id = item2Res.data.id;
    const mismatchSaleRes = await postJson(
      `${base}/api/v1/sales`,
      { branchId: BRANCH_A1, saleDate: saleDate1, lineItems: [{ itemName: 'Rice Bowl', quantity: 5, unitPrice: 10, inventoryItemId: item2Id }] },
      staffA1Token
    );
    check('Sale-triggered decrement: branch-mismatched inventoryItemId does not block the sale -> 201', mismatchSaleRes.status === 201, mismatchSaleRes);
    const item2AfterMismatch = await getItemRow(item2Id);
    check('Sale-triggered decrement: branch-mismatched item stock is UNCHANGED (decrement skipped)', Number(item2AfterMismatch.current_stock) === 40, item2AfterMismatch.current_stock);

    // Cross-module atomicity: a sale with one valid inventoryItemId line and
    // one line with a well-formed but non-existent inventoryItemId -> FK
    // violation on sale_line_item insert -> the WHOLE transaction (sale
    // header AND the would-be decrement of the valid line) rolls back.
    const atomicityDate = '2031-02-02';
    const beforeAtomicitySaleCount = await countSaleRows(TENANT_A, BRANCH_A1, atomicityDate);
    const chickenBeforeAtomicity = await getItemRow(chickenId);
    const chickenMovementsBeforeAtomicity = await movementsForItem(chickenId);
    const atomicitySaleRes = await postJson(
      `${base}/api/v1/sales`,
      {
        branchId: BRANCH_A1,
        saleDate: atomicityDate,
        lineItems: [
          { itemName: 'Chicken Curry', quantity: 1, unitPrice: 20, inventoryItemId: chickenId },
          { itemName: 'Bad FK Item', quantity: 1, unitPrice: 10, inventoryItemId: crypto.randomUUID() },
        ],
      },
      staffA1Token
    );
    check('Cross-module atomicity: FK violation on the second line item -> 500', atomicitySaleRes.status === 500, atomicitySaleRes);
    const afterAtomicitySaleCount = await countSaleRows(TENANT_A, BRANCH_A1, atomicityDate);
    check('Cross-module atomicity: no sale row committed', afterAtomicitySaleCount === beforeAtomicitySaleCount, { beforeAtomicitySaleCount, afterAtomicitySaleCount });
    const chickenAfterAtomicity = await getItemRow(chickenId);
    check(
      "Cross-module atomicity: the valid line item's inventory decrement was ROLLED BACK too (currentStock unchanged)",
      chickenAfterAtomicity.current_stock === chickenBeforeAtomicity.current_stock,
      { before: chickenBeforeAtomicity.current_stock, after: chickenAfterAtomicity.current_stock }
    );
    const chickenMovementsAfterAtomicity = await movementsForItem(chickenId);
    check(
      'Cross-module atomicity: no new inventory_movement row from the failed sale',
      chickenMovementsAfterAtomicity.length === chickenMovementsBeforeAtomicity.length,
      { before: chickenMovementsBeforeAtomicity.length, after: chickenMovementsAfterAtomicity.length }
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
