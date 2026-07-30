/**
 * P3 backend (2026-07-30) — real-Postgres verification for the Customers
 * module:
 *   - src/routes/customers.js (createCustomer, updateCustomer,
 *     deleteCustomer, listCustomers, getCustomer)
 *   - src/services/customerManagementService.js (validation, create, update,
 *     softDelete, list, getCustomerById)
 *   - src/services/branchAccessService.js (branchExistsInTenant, shared with
 *     Sales/Inventory)
 *
 * This module is low-complexity (no file upload, no money computation) --
 * per this task's own instruction, this suite proves tenant/branch isolation
 * and soft-delete behavior for real, at the same bar as the sibling suites,
 * without over-building (no CSV/XLSX round-trip, no cross-module wiring to
 * verify -- there is none here).
 *
 * NOT part of `npm run verify` (no DB dependency there). Run explicitly:
 *
 *   npm run test:customers
 *
 * against a real Postgres with migrations 0000-0010 + bootstrap-roles.sql
 * applied (same container the sibling P1-02/P1-03/P1-04/P2-02/P2-05 suites
 * use). This suite SELF-SEEDS its own fixtures (two tenants) via the
 * migrator connection, using tenant/branch ids distinct from
 * `sales.pgtest.mjs`/`inventory.pgtest.mjs`'s fixtures so all suites can run
 * against the same shared database without colliding.
 *
 * No test framework, plain Node ESM + node:assert-free `check()` helper --
 * matches the sibling suites' convention exactly. Test app mounts the REAL
 * route handlers/middleware in the REAL composition order
 * `routes/v1/index.js` uses.
 */

import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';

import { login } from '../src/routes/auth.js';
import { requireSession, requireRole as requireSessionRole } from '../src/middleware/sessionAuth.js';
import {
  createCustomer,
  updateCustomer,
  deleteCustomer,
  listCustomers,
  getCustomer,
} from '../src/routes/customers.js';
import { hashPassword } from '../src/services/passwordService.js';

const APP_URL =
  process.env.PGTEST_APP_URL || 'postgresql://grovyn_app:CHANGE_ME_APP@localhost:55433/grovyn';
const MIGRATOR_URL =
  process.env.PGTEST_MIGRATOR_URL ||
  'postgresql://grovyn_migrator:CHANGE_ME_MIGRATOR@localhost:55433/grovyn';

// Distinct ids/slugs from `sales.pgtest.mjs`/`inventory.pgtest.mjs`/
// `auth.pgtest.mjs`'s fixtures so all suites can run against the same shared
// database without colliding. NOTE: an earlier draft of this suite reused
// sales.pgtest.mjs's exact `99999999-5555-...`/`99999999-6666-...` ids by
// mistake (verified by real cross-run collision -- `sales.pgtest.mjs` failed
// with "unknown tenant slug" after this suite ran first, because the shared
// container already had a row for that id under a different slug) -- fixed
// by using a `cccccccc-...` prefix (c for Customers) instead of reusing
// `99999999-...`, which every other suite that prefix-shares already
// disambiguates only by the SECOND segment (`sales`: 5555/6666, `auth`:
// 1111) -- a wholly distinct first segment removes that whole class of
// mistake for this suite.
const TENANT_A = 'cccccccc-5555-1111-1111-111111111111';
const TENANT_A_SLUG = 'customers-p3-a';
const TENANT_B = 'cccccccc-6666-1111-1111-111111111111';
const TENANT_B_SLUG = 'customers-p3-b';

const BRANCH_A1 = 'cccccccc-5555-2222-1111-111111111111';
const BRANCH_A2 = 'cccccccc-5555-2222-2222-222222222222';
const BRANCH_B1 = 'cccccccc-6666-2222-1111-111111111111';

const ADMIN_A_EMAIL = 'admin@customers-p3-a.example';
const STAFF_A1_EMAIL = 'staff1@customers-p3-a.example';
const ADMIN_B_EMAIL = 'admin@customers-p3-b.example';
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
      console.log('[seed] customers fixture tenants already present, skipping seed.');
      return;
    }

    const pwHash = await hashPassword(REAL_PASSWORD);

    await client.query('BEGIN');
    await client.query('INSERT INTO tenant (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)', [
      TENANT_A,
      'Customers P3 Fixture A',
      TENANT_A_SLUG,
      TENANT_B,
      'Customers P3 Fixture B',
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
    console.log('[seed] customers fixture tenants seeded:', { adminAId, staffA1Id, adminBId });
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

async function getCustomerRow(id) {
  return withMigrator(async (client) => {
    const r = await client.query('SELECT * FROM customer WHERE id = $1', [id]);
    return r.rows[0] || null;
  });
}

async function auditLogFor(entityType, entityId) {
  return withMigrator(async (client) => {
    const r = await client.query('SELECT * FROM audit_log WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at', [entityType, entityId]);
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

  const custAuth = [requireSession(pool), requireSessionRole(['ADMIN', 'STAFF'])];
  app.post('/api/v1/customers', ...custAuth, createCustomer(pool));
  app.patch('/api/v1/customers/:id', ...custAuth, updateCustomer(pool));
  app.delete('/api/v1/customers/:id', ...custAuth, deleteCustomer(pool));
  app.get('/api/v1/customers', ...custAuth, listCustomers(pool));
  app.get('/api/v1/customers/:id', ...custAuth, getCustomer(pool));

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

async function deleteReq(url, token) {
  const r = await fetch(url, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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
    // Create: happy path, field roundtrip, audit_log write, branch scope,
    // cross-tenant smuggling, validation.
    // -----------------------------------------------------------------
    const createRes = await postJson(
      `${base}/api/v1/customers`,
      {
        branchId: BRANCH_A1,
        name: 'Priya Sharma',
        phone: '+91-9876543210',
        email: 'priya@example.com',
        category: 'VIP',
        rating: 5,
        notes: 'Prefers window seating.',
      },
      staffA1Token
    );
    check('Create: staff creates customer in own branch -> 201', createRes.status === 201, createRes);
    check('Create: fields roundtrip', createRes.data?.name === 'Priya Sharma' && createRes.data?.category === 'VIP' && createRes.data?.rating === 5, createRes.data);
    const priyaId = createRes.data?.id;

    const auditForCreate = await auditLogFor('customer', priyaId);
    check('Create: audit_log row written with action customer.create', auditForCreate.some((a) => a.action === 'customer.create'), auditForCreate);

    const createMinimalRes = await postJson(`${base}/api/v1/customers`, { branchId: BRANCH_A1, name: 'Walk-in' }, staffA1Token);
    check('Create: only name required, rest optional -> 201', createMinimalRes.status === 201, createMinimalRes.data);
    check('Create: unset optional fields serialize as null', createMinimalRes.data?.phone === null && createMinimalRes.data?.category === null, createMinimalRes.data);

    const missingName = await postJson(`${base}/api/v1/customers`, { branchId: BRANCH_A1 }, staffA1Token);
    check('Create: missing name -> 400', missingName.status === 400, missingName);

    const badRating = await postJson(`${base}/api/v1/customers`, { branchId: BRANCH_A1, name: 'X', rating: 9 }, staffA1Token);
    check('Create: out-of-range rating -> 400', badRating.status === 400, badRating);

    const badBranch = await postJson(`${base}/api/v1/customers`, { branchId: 'not-a-uuid', name: 'X' }, staffA1Token);
    check('Create: malformed branchId -> 400', badBranch.status === 400, badBranch);

    const staffWrongBranchCreate = await postJson(`${base}/api/v1/customers`, { branchId: BRANCH_A2, name: 'X' }, staffA1Token);
    check('Create: staff blocked from a branch they are not assigned to -> 403', staffWrongBranchCreate.status === 403, staffWrongBranchCreate);

    const adminOtherBranchCreate = await postJson(`${base}/api/v1/customers`, { branchId: BRANCH_A2, name: 'Admin-Created' }, adminAToken);
    check('Create: admin has implicit all-branch access within own tenant -> 201', adminOtherBranchCreate.status === 201, adminOtherBranchCreate);

    const crossTenantCreate = await postJson(`${base}/api/v1/customers`, { branchId: BRANCH_A1, name: 'Smuggled' }, adminBToken);
    check('Create: cross-tenant branch-id smuggling rejected -> 403', crossTenantCreate.status === 403, crossTenantCreate);

    // -----------------------------------------------------------------
    // PATCH edit: metadata edit, explicit-null clearing, audit_log
    // before/after, validation, branch/tenant scope 404s.
    // -----------------------------------------------------------------
    const patchRes = await patchJson(`${base}/api/v1/customers/${priyaId}`, { name: 'Priya S.', rating: 4 }, staffA1Token);
    check('PATCH: edit -> 200', patchRes.status === 200, patchRes);
    check('PATCH: fields updated', patchRes.data?.name === 'Priya S.' && patchRes.data?.rating === 4, patchRes.data);

    const auditForUpdate = await auditLogFor('customer', priyaId);
    const updateAudit = auditForUpdate.find((a) => a.action === 'customer.update');
    check('PATCH: audit_log row written with action customer.update', Boolean(updateAudit), auditForUpdate);
    check(
      'PATCH: audit_log before/after captures the change',
      updateAudit?.before_data?.name === 'Priya Sharma' && updateAudit?.after_data?.name === 'Priya S.',
      updateAudit
    );

    const clearFieldsRes = await patchJson(`${base}/api/v1/customers/${priyaId}`, { phone: null, category: null, rating: null }, staffA1Token);
    check('PATCH: explicit null clears optional fields -> 200', clearFieldsRes.status === 200, clearFieldsRes);
    check(
      'PATCH: cleared fields serialize as null',
      clearFieldsRes.data?.phone === null && clearFieldsRes.data?.category === null && clearFieldsRes.data?.rating === null,
      clearFieldsRes.data
    );

    const emptyPatch = await patchJson(`${base}/api/v1/customers/${priyaId}`, {}, staffA1Token);
    check('PATCH: empty body -> 400', emptyPatch.status === 400, emptyPatch);

    const patchBadRating = await patchJson(`${base}/api/v1/customers/${priyaId}`, { rating: 0 }, staffA1Token);
    check('PATCH: out-of-range rating -> 400', patchBadRating.status === 400, patchBadRating);

    const patchStaffWrongBranch = await patchJson(`${base}/api/v1/customers/${adminOtherBranchCreate.data.id}`, { name: 'Z' }, staffA1Token);
    check('PATCH: staff editing a customer outside their branch -> 404 (no existence leak)', patchStaffWrongBranch.status === 404, patchStaffWrongBranch);

    const patchCrossTenant = await patchJson(`${base}/api/v1/customers/${priyaId}`, { name: 'Z' }, adminBToken);
    check('PATCH: cross-tenant edit of a real customer id -> 404', patchCrossTenant.status === 404, patchCrossTenant);

    const patchNonexistent = await patchJson(`${base}/api/v1/customers/${crypto.randomUUID()}`, { name: 'Z' }, staffA1Token);
    check('PATCH: nonexistent id -> 404', patchNonexistent.status === 404, patchNonexistent);

    // -----------------------------------------------------------------
    // List / detail: pagination, category filter, branch scope, tenant
    // isolation.
    // -----------------------------------------------------------------
    const catCustomerRes = await postJson(`${base}/api/v1/customers`, { branchId: BRANCH_A1, name: 'Corporate Co', category: 'corporate' }, staffA1Token);
    const catCustomerId = catCustomerRes.data?.id;

    const listAsStaff = await getJson(`${base}/api/v1/customers`, staffA1Token);
    check('List: staff (no branchId) -> 200', listAsStaff.status === 200, listAsStaff);
    check(
      'List: staff result set contains ONLY their own branch (A1)',
      listAsStaff.data?.data?.length > 0 && listAsStaff.data.data.every((c) => c.branchId === BRANCH_A1),
      listAsStaff.data
    );
    check(
      "List: staff's own branch list does NOT include the admin-created A2 customer",
      !listAsStaff.data?.data?.some((c) => c.id === adminOtherBranchCreate.data.id),
      listAsStaff.data
    );

    const listStaffOtherBranch = await getJson(`${base}/api/v1/customers?branchId=${BRANCH_A2}`, staffA1Token);
    check('List: staff filtering by a branch outside their scope -> 403', listStaffOtherBranch.status === 403, listStaffOtherBranch);

    const listByCategory = await getJson(`${base}/api/v1/customers?branchId=${BRANCH_A1}&category=corporate`, staffA1Token);
    check('List: category filter -> 200', listByCategory.status === 200, listByCategory);
    check(
      'List: category filter returns only matching rows',
      listByCategory.data?.data?.length > 0 && listByCategory.data.data.every((c) => c.category === 'corporate'),
      listByCategory.data
    );
    check('List: category filter includes the corporate fixture', listByCategory.data?.data?.some((c) => c.id === catCustomerId), listByCategory.data);

    const listPage1 = await getJson(`${base}/api/v1/customers?branchId=${BRANCH_A1}&page=1&pageSize=2`, staffA1Token);
    check('List: pagination -- pageSize respected', listPage1.data?.data?.length === 2 && listPage1.data?.meta?.pageSize === 2, listPage1.data);
    check('List: pagination -- meta.total reflects full count, not just this page', listPage1.data?.meta?.total >= 3, listPage1.data?.meta);

    const listAsAdminA = await getJson(`${base}/api/v1/customers`, adminAToken);
    check(
      'List: admin (no branchId) sees customers across ALL own-tenant branches',
      listAsAdminA.status === 200 && listAsAdminA.data?.data?.some((c) => c.branchId === BRANCH_A2),
      listAsAdminA.data
    );

    const listAsAdminB = await getJson(`${base}/api/v1/customers`, adminBToken);
    check(
      "List: tenant B admin sees ZERO of tenant A's customers (RLS, not app filtering)",
      listAsAdminB.status === 200 && Array.isArray(listAsAdminB.data?.data) && listAsAdminB.data.data.length === 0,
      listAsAdminB.data
    );

    const detailAsOwner = await getJson(`${base}/api/v1/customers/${priyaId}`, staffA1Token);
    check('Detail: staff can read their own branch customer -> 200', detailAsOwner.status === 200, detailAsOwner);

    const detailWrongBranch = await getJson(`${base}/api/v1/customers/${adminOtherBranchCreate.data.id}`, staffA1Token);
    check('Detail: staff reading a customer outside their branch -> 404', detailWrongBranch.status === 404, detailWrongBranch);

    const detailCrossTenant = await getJson(`${base}/api/v1/customers/${priyaId}`, adminBToken);
    check('Detail: cross-tenant read of a real customer id -> 404', detailCrossTenant.status === 404, detailCrossTenant);

    // -----------------------------------------------------------------
    // Soft-delete: never a hard DELETE, excluded from list/detail after,
    // still present (with deleted_at set) at the DB level, audit_log write,
    // branch/tenant scope 404s, idempotency (deleting twice -> 404 the
    // second time, no existence leak).
    // -----------------------------------------------------------------
    const deleteStaffWrongBranch = await deleteReq(`${base}/api/v1/customers/${adminOtherBranchCreate.data.id}`, staffA1Token);
    check('DELETE: staff deleting a customer outside their branch -> 404', deleteStaffWrongBranch.status === 404, deleteStaffWrongBranch);

    const deleteCrossTenant = await deleteReq(`${base}/api/v1/customers/${priyaId}`, adminBToken);
    check('DELETE: cross-tenant delete of a real customer id -> 404', deleteCrossTenant.status === 404, deleteCrossTenant);
    const priyaStillActiveRow = await getCustomerRow(priyaId);
    check('DELETE: rejected cross-tenant delete left the row untouched (deleted_at still NULL)', priyaStillActiveRow?.deleted_at === null, priyaStillActiveRow);

    const deleteRes = await deleteReq(`${base}/api/v1/customers/${priyaId}`, staffA1Token);
    check('DELETE: staff soft-deletes a customer in their own branch -> 204', deleteRes.status === 204, deleteRes);

    const deletedRow = await getCustomerRow(priyaId);
    check('DELETE: row is NOT physically removed (still present at the DB level)', deletedRow !== null, deletedRow);
    check('DELETE: row is tombstoned (deleted_at set)', deletedRow?.deleted_at !== null, deletedRow);
    check('DELETE: PII columns are left intact by the soft-delete (backup-expiry erasure model, D-008 amendment)', deletedRow?.name === 'Priya S.', deletedRow);

    const auditForDelete = await auditLogFor('customer', priyaId);
    check('DELETE: audit_log row written with action customer.delete', auditForDelete.some((a) => a.action === 'customer.delete'), auditForDelete);

    const detailAfterDelete = await getJson(`${base}/api/v1/customers/${priyaId}`, staffA1Token);
    check('DELETE: GET detail on a soft-deleted customer -> 404 (excluded, not just hidden)', detailAfterDelete.status === 404, detailAfterDelete);

    const listAfterDelete = await getJson(`${base}/api/v1/customers?branchId=${BRANCH_A1}`, staffA1Token);
    check(
      'DELETE: soft-deleted customer excluded from the branch list',
      !listAfterDelete.data?.data?.some((c) => c.id === priyaId),
      listAfterDelete.data
    );

    const deleteAgainRes = await deleteReq(`${base}/api/v1/customers/${priyaId}`, staffA1Token);
    check('DELETE: deleting an already-soft-deleted customer -> 404 (idempotent, no existence leak)', deleteAgainRes.status === 404, deleteAgainRes);

    const patchAfterDelete = await patchJson(`${base}/api/v1/customers/${priyaId}`, { name: 'Should Not Apply' }, staffA1Token);
    check('PATCH: editing a soft-deleted customer -> 404', patchAfterDelete.status === 404, patchAfterDelete);
    const rowAfterFailedPatch = await getCustomerRow(priyaId);
    check('PATCH: rejected edit of a soft-deleted row -- name unchanged', rowAfterFailedPatch?.name === 'Priya S.', rowAfterFailedPatch);

    const deleteNonexistent = await deleteReq(`${base}/api/v1/customers/${crypto.randomUUID()}`, staffA1Token);
    check('DELETE: nonexistent id -> 404', deleteNonexistent.status === 404, deleteNonexistent);
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
