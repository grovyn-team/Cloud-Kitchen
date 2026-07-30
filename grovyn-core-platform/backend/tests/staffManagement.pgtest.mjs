/**
 * P3 backend (2026-07-30) — real-Postgres verification for the Staff
 * management module:
 *   - src/routes/staffManagement.js (createStaff, listStaff, getStaffDetail,
 *     updateStaff, deactivateStaff, grantStaffBranchAccess,
 *     revokeStaffBranchAccess)
 *   - src/services/staffManagementService.js (validation, create,
 *     update/deactivate, branch-grant lifecycle, last-admin guard support)
 *
 * This module is low-complexity (no file upload, no money computation) --
 * per this task's own instruction, this suite proves ADMIN-only enforcement,
 * tenant isolation, the branch grant/revoke lifecycle (grant -> active ->
 * revoke -> inactive, re-grant reactivates not duplicates), the
 * session-revocation-on-staff-removal behavior (SEC-04), the last-admin
 * guard, and audit_log entries, at the same bar as the sibling suites,
 * without over-building.
 *
 * NOT part of `npm run verify` (no DB dependency there). Run explicitly:
 *
 *   npm run test:staff-management
 *
 * against a real Postgres with migrations 0000-0010 + bootstrap-roles.sql
 * applied (same container the sibling P1-02/P1-03/P1-04/P2-02/P2-05/P3
 * suites use). This suite SELF-SEEDS its own fixtures (two tenants) via the
 * migrator connection, using tenant/branch/user ids distinct from every
 * sibling suite's fixtures (a fresh `dddddddd-` first-segment prefix, not
 * reused anywhere else — see `customers.pgtest.mjs`'s own doc comment for
 * why a wholly distinct first segment, not just a distinct second segment,
 * is the safe disambiguation).
 *
 * No test framework, plain Node ESM + a `check()` helper — matches the
 * sibling suites' convention exactly. Test app mounts the REAL route
 * handlers/middleware in the REAL composition order `routes/v1/index.js`
 * uses (ADMIN-only via `requireSession`+`requireRole(['ADMIN'])` from
 * `sessionAuth.js`).
 */

import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';

import { login, me } from '../src/routes/auth.js';
import { requireSession, requireRole as requireSessionRole } from '../src/middleware/sessionAuth.js';
import {
  createStaff,
  listStaff,
  getStaffDetail,
  updateStaff,
  deactivateStaff,
  grantStaffBranchAccess,
  revokeStaffBranchAccess,
} from '../src/routes/staffManagement.js';
import { hashPassword } from '../src/services/passwordService.js';

const APP_URL =
  process.env.PGTEST_APP_URL || 'postgresql://grovyn_app:CHANGE_ME_APP@localhost:55433/grovyn';
const MIGRATOR_URL =
  process.env.PGTEST_MIGRATOR_URL ||
  'postgresql://grovyn_migrator:CHANGE_ME_MIGRATOR@localhost:55433/grovyn';

// Fresh, wholly distinct first segment ('dddddddd') from every sibling
// suite's fixtures (99999999 auth/sales, cccccccc customers) so all suites
// can run against the same shared database without colliding.
const TENANT_A = 'dddddddd-5555-1111-1111-111111111111';
const TENANT_A_SLUG = 'staffmgmt-p3-a';
const TENANT_B = 'dddddddd-6666-1111-1111-111111111111';
const TENANT_B_SLUG = 'staffmgmt-p3-b';

const BRANCH_A1 = 'dddddddd-5555-2222-1111-111111111111';
const BRANCH_A2 = 'dddddddd-5555-2222-2222-222222222222';
const BRANCH_B1 = 'dddddddd-6666-2222-1111-111111111111';

const ADMIN_A_EMAIL = 'admin@staffmgmt-p3-a.example';
const STAFF_A1_EMAIL = 'staff1@staffmgmt-p3-a.example';
const ADMIN_B_EMAIL = 'admin@staffmgmt-p3-b.example';
const REAL_PASSWORD = 'Correct-Horse-Battery-Staple-1!';
const NEW_STAFF_PASSWORD = 'Another-Strong-Password-2!';

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
      console.log('[seed] staff-management fixture tenants already present, skipping seed.');
      return;
    }

    const pwHash = await hashPassword(REAL_PASSWORD);

    await client.query('BEGIN');
    await client.query('INSERT INTO tenant (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)', [
      TENANT_A,
      'StaffMgmt P3 Fixture A',
      TENANT_A_SLUG,
      TENANT_B,
      'StaffMgmt P3 Fixture B',
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
    console.log('[seed] staff-management fixture tenants seeded:', { adminAId, staffA1Id, adminBId });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

// Direct-DB helpers (migrator connection, bypasses RLS -- used only to
// verify what actually landed in the tables, independent of what the API
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

async function getUserRow(id) {
  return withMigrator(async (client) => {
    const r = await client.query('SELECT * FROM "user" WHERE id = $1', [id]);
    return r.rows[0] || null;
  });
}

async function getBranchAccessRows(userId, branchId) {
  return withMigrator(async (client) => {
    const r = await client.query(
      'SELECT * FROM staff_branch_access WHERE user_id = $1 AND branch_id = $2 ORDER BY created_at',
      [userId, branchId]
    );
    return r.rows;
  });
}

async function getActiveSessionCount(userId) {
  return withMigrator(async (client) => {
    const r = await client.query(
      'SELECT count(*)::int AS n FROM session WHERE user_id = $1 AND revoked_at IS NULL',
      [userId]
    );
    return Number(r.rows[0].n);
  });
}

async function auditLogFor(entityType, entityId) {
  return withMigrator(async (client) => {
    const r = await client.query(
      'SELECT * FROM audit_log WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at',
      [entityType, entityId]
    );
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
  app.get('/api/v1/auth/me', requireSession(pool), me(pool));

  const staffMgmtAuth = [requireSession(pool), requireSessionRole(['ADMIN'])];
  app.post('/api/v1/staff/accounts', ...staffMgmtAuth, createStaff(pool));
  app.get('/api/v1/staff/accounts', ...staffMgmtAuth, listStaff(pool));
  app.get('/api/v1/staff/accounts/:id', ...staffMgmtAuth, getStaffDetail(pool));
  app.patch('/api/v1/staff/accounts/:id', ...staffMgmtAuth, updateStaff(pool));
  app.delete('/api/v1/staff/accounts/:id', ...staffMgmtAuth, deactivateStaff(pool));
  app.post('/api/v1/staff/accounts/:id/branches', ...staffMgmtAuth, grantStaffBranchAccess(pool));
  app.delete('/api/v1/staff/accounts/:id/branches/:branchId', ...staffMgmtAuth, revokeStaffBranchAccess(pool));

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

async function loginAs(base, tenantSlug, email, password = REAL_PASSWORD) {
  const r = await postJson(`${base}/api/v1/auth/login`, { tenantSlug, email, password });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(r)}`);
  return r.data.sessionToken;
}

// ---------------------------------------------------------------------------
async function main() {
  await seed();

  const adminAId = await withMigrator(async (client) => {
    const r = await client.query('SELECT id FROM "user" WHERE tenant_id = $1 AND email = $2', [TENANT_A, ADMIN_A_EMAIL]);
    return r.rows[0].id;
  });
  const staffA1Id = await withMigrator(async (client) => {
    const r = await client.query('SELECT id FROM "user" WHERE tenant_id = $1 AND email = $2', [TENANT_A, STAFF_A1_EMAIL]);
    return r.rows[0].id;
  });

  const pool = new pg.Pool({ connectionString: APP_URL, max: 5 });
  await withServer(pool, async (base) => {
    const adminAToken = await loginAs(base, TENANT_A_SLUG, ADMIN_A_EMAIL);
    const staffA1Token = await loginAs(base, TENANT_A_SLUG, STAFF_A1_EMAIL);
    const adminBToken = await loginAs(base, TENANT_B_SLUG, ADMIN_B_EMAIL);

    // -----------------------------------------------------------------
    // ADMIN-only enforcement: STAFF gets 403 on every route.
    // -----------------------------------------------------------------
    const staffCreateAttempt = await postJson(
      `${base}/api/v1/staff/accounts`,
      { email: 'x@staffmgmt-p3-a.example', name: 'X', password: NEW_STAFF_PASSWORD, role: 'STAFF' },
      staffA1Token
    );
    check('ADMIN-only: STAFF POST /staff/accounts -> 403', staffCreateAttempt.status === 403, staffCreateAttempt);

    const staffListAttempt = await getJson(`${base}/api/v1/staff/accounts`, staffA1Token);
    check('ADMIN-only: STAFF GET /staff/accounts -> 403', staffListAttempt.status === 403, staffListAttempt);

    const staffDetailAttempt = await getJson(`${base}/api/v1/staff/accounts/${adminAId}`, staffA1Token);
    check('ADMIN-only: STAFF GET /staff/accounts/:id -> 403', staffDetailAttempt.status === 403, staffDetailAttempt);

    const staffPatchAttempt = await patchJson(`${base}/api/v1/staff/accounts/${adminAId}`, { name: 'Hacked' }, staffA1Token);
    check('ADMIN-only: STAFF PATCH /staff/accounts/:id -> 403', staffPatchAttempt.status === 403, staffPatchAttempt);

    const staffDeleteAttempt = await deleteReq(`${base}/api/v1/staff/accounts/${adminAId}`, staffA1Token);
    check('ADMIN-only: STAFF DELETE /staff/accounts/:id -> 403', staffDeleteAttempt.status === 403, staffDeleteAttempt);

    const staffGrantAttempt = await postJson(`${base}/api/v1/staff/accounts/${staffA1Id}/branches`, { branchId: BRANCH_A2 }, staffA1Token);
    check('ADMIN-only: STAFF POST /branches (grant) -> 403', staffGrantAttempt.status === 403, staffGrantAttempt);

    const staffRevokeAttempt = await deleteReq(`${base}/api/v1/staff/accounts/${staffA1Id}/branches/${BRANCH_A1}`, staffA1Token);
    check('ADMIN-only: STAFF DELETE /branches/:branchId (revoke) -> 403', staffRevokeAttempt.status === 403, staffRevokeAttempt);

    // -----------------------------------------------------------------
    // Last-admin guard (BEFORE a second admin exists): ADMIN_A is the
    // tenant's only active admin.
    // -----------------------------------------------------------------
    const selfDeactivateBlocked = await deleteReq(`${base}/api/v1/staff/accounts/${adminAId}`, adminAToken);
    check('Last-admin guard: self-deactivate as sole admin -> 400', selfDeactivateBlocked.status === 400, selfDeactivateBlocked);

    const selfDowngradeBlocked = await patchJson(`${base}/api/v1/staff/accounts/${adminAId}`, { role: 'STAFF' }, adminAToken);
    check('Last-admin guard: self-downgrade as sole admin -> 400', selfDowngradeBlocked.status === 400, selfDowngradeBlocked);

    const stillAdmin = await getUserRow(adminAId);
    check('Last-admin guard: role unchanged in DB after blocked downgrade', stillAdmin.role === 'ADMIN', stillAdmin);

    // -----------------------------------------------------------------
    // Create: happy path, validation, duplicate email, cross-tenant
    // branchId smuggling, audit_log.
    // -----------------------------------------------------------------
    const createRes = await postJson(
      `${base}/api/v1/staff/accounts`,
      {
        email: 'newstaff@staffmgmt-p3-a.example',
        name: 'New Staff',
        password: NEW_STAFF_PASSWORD,
        role: 'STAFF',
        branchIds: [BRANCH_A1],
      },
      adminAToken
    );
    check('Create: ADMIN creates STAFF account -> 201', createRes.status === 201, createRes);
    check(
      'Create: fields roundtrip, no passwordHash leaked',
      createRes.data?.email === 'newstaff@staffmgmt-p3-a.example' &&
        createRes.data?.role === 'STAFF' &&
        createRes.data?.passwordHash === undefined,
      createRes.data
    );
    check('Create: branchIds roundtrip', JSON.stringify(createRes.data?.branchIds) === JSON.stringify([BRANCH_A1]), createRes.data);
    const newStaffId = createRes.data?.id;

    const auditForCreate = await auditLogFor('user', newStaffId);
    check('Create: audit_log row written with action staff.create', auditForCreate.some((a) => a.action === 'staff.create'), auditForCreate);

    const newStaffRowAfterCreate = await getUserRow(newStaffId);
    const originalHash = newStaffRowAfterCreate.password_hash;

    const missingFields = await postJson(`${base}/api/v1/staff/accounts`, { email: 'bad' }, adminAToken);
    check('Create: missing required fields -> 400', missingFields.status === 400, missingFields);

    const shortPassword = await postJson(
      `${base}/api/v1/staff/accounts`,
      { email: 'short@staffmgmt-p3-a.example', name: 'X', password: 'short', role: 'STAFF' },
      adminAToken
    );
    check('Create: too-short password -> 400', shortPassword.status === 400, shortPassword);

    const badRole = await postJson(
      `${base}/api/v1/staff/accounts`,
      { email: 'badrole@staffmgmt-p3-a.example', name: 'X', password: NEW_STAFF_PASSWORD, role: 'OWNER' },
      adminAToken
    );
    check('Create: invalid role -> 400', badRole.status === 400, badRole);

    const duplicateEmail = await postJson(
      `${base}/api/v1/staff/accounts`,
      { email: ADMIN_A_EMAIL, name: 'Dup', password: NEW_STAFF_PASSWORD, role: 'STAFF' },
      adminAToken
    );
    check('Create: duplicate active email in tenant -> 409', duplicateEmail.status === 409, duplicateEmail);

    const crossTenantBranch = await postJson(
      `${base}/api/v1/staff/accounts`,
      { email: 'smuggle@staffmgmt-p3-a.example', name: 'X', password: NEW_STAFF_PASSWORD, role: 'STAFF', branchIds: [BRANCH_B1] },
      adminAToken
    );
    check('Create: cross-tenant branchId smuggling -> 400, no partial commit', crossTenantBranch.status === 400, crossTenantBranch);

    // -----------------------------------------------------------------
    // Create a SECOND admin -- unblocks the last-admin guard for later
    // checks.
    // -----------------------------------------------------------------
    const createSecondAdmin = await postJson(
      `${base}/api/v1/staff/accounts`,
      { email: 'admin2@staffmgmt-p3-a.example', name: 'Second Admin', password: NEW_STAFF_PASSWORD, role: 'ADMIN' },
      adminAToken
    );
    check('Create: second ADMIN account -> 201', createSecondAdmin.status === 201, createSecondAdmin);

    // Now that a second admin exists, ADMIN_A's own self-downgrade should
    // be ALLOWED.
    const selfDowngradeAllowed = await patchJson(`${base}/api/v1/staff/accounts/${adminAId}`, { role: 'STAFF' }, adminAToken);
    check('Last-admin guard: self-downgrade allowed once a second admin exists -> 200', selfDowngradeAllowed.status === 200, selfDowngradeAllowed);
    check('Last-admin guard: role actually changed', selfDowngradeAllowed.data?.role === 'STAFF', selfDowngradeAllowed.data);

    // Restore ADMIN_A back to ADMIN for the rest of the suite (uses the
    // second admin's token, since ADMIN_A is no longer ADMIN and would
    // otherwise get 403 editing ANOTHER account -- also proves a
    // non-self-targeting edit isn't guarded by the last-admin check).
    const secondAdminToken = await loginAs(base, TENANT_A_SLUG, 'admin2@staffmgmt-p3-a.example', NEW_STAFF_PASSWORD);
    const restoreAdminA = await patchJson(`${base}/api/v1/staff/accounts/${adminAId}`, { role: 'ADMIN' }, secondAdminToken);
    check('PATCH: another admin can edit a non-self account freely -> 200', restoreAdminA.status === 200, restoreAdminA);

    const auditForUpdate = await auditLogFor('user', adminAId);
    const updateAudit = auditForUpdate.find((a) => a.action === 'staff.update' && a.after_data?.role === 'ADMIN');
    check('PATCH: audit_log row written with action staff.update, before/after captured', Boolean(updateAudit) && updateAudit.before_data?.role === 'STAFF', auditForUpdate);

    // -----------------------------------------------------------------
    // PATCH validation.
    // -----------------------------------------------------------------
    const emptyPatch = await patchJson(`${base}/api/v1/staff/accounts/${newStaffId}`, {}, adminAToken);
    check('PATCH: empty body -> 400', emptyPatch.status === 400, emptyPatch);

    const badRolePatch = await patchJson(`${base}/api/v1/staff/accounts/${newStaffId}`, { role: 'SUPERADMIN' }, adminAToken);
    check('PATCH: invalid role -> 400', badRolePatch.status === 400, badRolePatch);

    const passwordIgnored = await patchJson(`${base}/api/v1/staff/accounts/${newStaffId}`, { name: 'New Staff Renamed', password: 'irrelevant' }, adminAToken);
    check('PATCH: name edit -> 200', passwordIgnored.status === 200, passwordIgnored);
    const newStaffRowAfterPatch = await getUserRow(newStaffId);
    check(
      'PATCH: password field in body is silently ignored (hash unchanged)',
      newStaffRowAfterPatch.password_hash === originalHash,
      { after: newStaffRowAfterPatch.password_hash, original: originalHash }
    );

    // -----------------------------------------------------------------
    // List / detail: pagination shape, activeBranchCount, tenant
    // isolation.
    // -----------------------------------------------------------------
    const listRes = await getJson(`${base}/api/v1/staff/accounts`, adminAToken);
    check('List: 200', listRes.status === 200, listRes);
    check('List: contains newStaff with activeBranchCount 1', listRes.data?.data?.find((s) => s.id === newStaffId)?.activeBranchCount === 1, listRes.data);
    check('List: does not include tenant B admin', !listRes.data?.data?.some((s) => s.email === ADMIN_B_EMAIL), listRes.data);

    const detailRes = await getJson(`${base}/api/v1/staff/accounts/${newStaffId}`, adminAToken);
    check('Detail: 200', detailRes.status === 200, detailRes);
    check(
      'Detail: branchAssignments includes BRANCH_A1',
      detailRes.data?.branchAssignments?.some((b) => b.branchId === BRANCH_A1),
      detailRes.data
    );

    const crossTenantDetail = await getJson(`${base}/api/v1/staff/accounts/${newStaffId}`, adminBToken);
    check('Detail: cross-tenant fetch of a real staff id -> 404', crossTenantDetail.status === 404, crossTenantDetail);

    const crossTenantPatch = await patchJson(`${base}/api/v1/staff/accounts/${newStaffId}`, { name: 'Z' }, adminBToken);
    check('PATCH: cross-tenant edit of a real staff id -> 404', crossTenantPatch.status === 404, crossTenantPatch);

    const nonexistentDetail = await getJson(`${base}/api/v1/staff/accounts/${crypto.randomUUID()}`, adminAToken);
    check('Detail: nonexistent id -> 404', nonexistentDetail.status === 404, nonexistentDetail);

    // -----------------------------------------------------------------
    // Branch grant/revoke lifecycle: grant -> active -> revoke -> inactive,
    // re-grant reactivates (not a duplicate row), duplicate-active grant is
    // idempotent, cross-tenant branchId rejected.
    // -----------------------------------------------------------------
    const grantRes = await postJson(`${base}/api/v1/staff/accounts/${newStaffId}/branches`, { branchId: BRANCH_A2 }, adminAToken);
    check('Grant: new grant -> 201', grantRes.status === 201, grantRes);
    check('Grant: reactivated=false, alreadyActive=false on a brand-new grant', grantRes.data?.reactivated === false && grantRes.data?.alreadyActive === false, grantRes.data);

    const rowsAfterGrant = await getBranchAccessRows(newStaffId, BRANCH_A2);
    check('Grant: exactly one row exists, active (revoked_at NULL)', rowsAfterGrant.length === 1 && rowsAfterGrant[0].revoked_at === null, rowsAfterGrant);

    const auditForGrant = await auditLogFor('staff_branch_access', grantRes.data?.id);
    check('Grant: audit_log row written with action staff.branch_grant', auditForGrant.some((a) => a.action === 'staff.branch_grant'), auditForGrant);

    const duplicateGrant = await postJson(`${base}/api/v1/staff/accounts/${newStaffId}/branches`, { branchId: BRANCH_A2 }, adminAToken);
    check('Grant: re-granting an already-active pair -> 200, alreadyActive=true', duplicateGrant.status === 200 && duplicateGrant.data?.alreadyActive === true, duplicateGrant);

    const rowsAfterDuplicateGrant = await getBranchAccessRows(newStaffId, BRANCH_A2);
    check('Grant: still exactly one row (no duplicate) after re-granting an active pair', rowsAfterDuplicateGrant.length === 1, rowsAfterDuplicateGrant);

    const revokeRes = await deleteReq(`${base}/api/v1/staff/accounts/${newStaffId}/branches/${BRANCH_A2}`, adminAToken);
    check('Revoke: 204', revokeRes.status === 204, revokeRes);

    const rowsAfterRevoke = await getBranchAccessRows(newStaffId, BRANCH_A2);
    check('Revoke: row still present (soft-revoke, not hard-deleted) with revoked_at set', rowsAfterRevoke.length === 1 && rowsAfterRevoke[0].revoked_at !== null, rowsAfterRevoke);

    const auditForRevoke = await auditLogFor('staff_branch_access', rowsAfterRevoke[0].id);
    check('Revoke: audit_log row written with action staff.branch_revoke', auditForRevoke.some((a) => a.action === 'staff.branch_revoke'), auditForRevoke);

    const doubleRevoke = await deleteReq(`${base}/api/v1/staff/accounts/${newStaffId}/branches/${BRANCH_A2}`, adminAToken);
    check('Revoke: revoking an already-inactive grant -> 404', doubleRevoke.status === 404, doubleRevoke);

    const regrantRes = await postJson(`${base}/api/v1/staff/accounts/${newStaffId}/branches`, { branchId: BRANCH_A2 }, adminAToken);
    check('Re-grant: reactivates -> 200, reactivated=true', regrantRes.status === 200 && regrantRes.data?.reactivated === true, regrantRes);

    const rowsAfterRegrant = await getBranchAccessRows(newStaffId, BRANCH_A2);
    check('Re-grant: STILL exactly one row total (reactivated the same row, no new insert)', rowsAfterRegrant.length === 1 && rowsAfterRegrant[0].revoked_at === null, rowsAfterRegrant);
    check('Re-grant: reactivated the SAME row id as the original grant', rowsAfterRegrant[0].id === grantRes.data?.id, { original: grantRes.data?.id, current: rowsAfterRegrant[0].id });

    const crossTenantGrant = await postJson(`${base}/api/v1/staff/accounts/${newStaffId}/branches`, { branchId: BRANCH_B1 }, adminAToken);
    check('Grant: cross-tenant branchId smuggling -> 400', crossTenantGrant.status === 400, crossTenantGrant);

    const crossTenantRevoke = await deleteReq(`${base}/api/v1/staff/accounts/${staffA1Id}/branches/${BRANCH_A1}`, adminBToken);
    check('Revoke: cross-tenant staff id -> 404', crossTenantRevoke.status === 404, crossTenantRevoke);

    // -----------------------------------------------------------------
    // Session-revocation-on-staff-removal (SEC-04): issue a real session
    // for the staff user, confirm it works, deactivate, confirm the SAME
    // token is now rejected.
    // -----------------------------------------------------------------
    const newStaffToken = await loginAs(base, TENANT_A_SLUG, 'newstaff@staffmgmt-p3-a.example', NEW_STAFF_PASSWORD);
    const meBefore = await getJson(`${base}/api/v1/auth/me`, newStaffToken);
    check('Session: new staff session works before deactivation -> 200', meBefore.status === 200, meBefore);

    const activeSessionsBefore = await getActiveSessionCount(newStaffId);
    check('Session: at least one active session row exists before deactivation', activeSessionsBefore >= 1, activeSessionsBefore);

    const deactivateRes = await deleteReq(`${base}/api/v1/staff/accounts/${newStaffId}`, adminAToken);
    check('Deactivate: 204', deactivateRes.status === 204, deactivateRes);

    const meAfter = await getJson(`${base}/api/v1/auth/me`, newStaffToken);
    check('Session: the SAME pre-deactivation token is rejected immediately after deactivation -> 401', meAfter.status === 401, meAfter);

    const activeSessionsAfter = await getActiveSessionCount(newStaffId);
    check('Session: zero active session rows remain after deactivation', activeSessionsAfter === 0, activeSessionsAfter);

    const deactivatedUserRow = await getUserRow(newStaffId);
    check('Deactivate: user row soft-deleted (deleted_at set)', deactivatedUserRow.deleted_at !== null, deactivatedUserRow);

    const branchRowsAfterDeactivate = await getBranchAccessRows(newStaffId, BRANCH_A1);
    check('Deactivate: staff_branch_access grant revoked too', branchRowsAfterDeactivate[0]?.revoked_at !== null, branchRowsAfterDeactivate);

    const auditForDeactivate = await auditLogFor('user', newStaffId);
    check('Deactivate: audit_log row written with action staff.deactivate', auditForDeactivate.some((a) => a.action === 'staff.deactivate'), auditForDeactivate);

    const loginAfterDeactivate = await postJson(`${base}/api/v1/auth/login`, {
      tenantSlug: TENANT_A_SLUG,
      email: 'newstaff@staffmgmt-p3-a.example',
      password: NEW_STAFF_PASSWORD,
    });
    check('Deactivate: fresh login attempt for the deactivated user -> 401', loginAfterDeactivate.status === 401, loginAfterDeactivate);

    const detailAfterDeactivate = await getJson(`${base}/api/v1/staff/accounts/${newStaffId}`, adminAToken);
    check('Deactivate: GET detail for a deactivated user -> 404 (excluded from active reads)', detailAfterDeactivate.status === 404, detailAfterDeactivate);

    // Deactivating an already-deactivated user -> 404 (no existence leak,
    // no double soft-delete/double-revoke).
    const doubleDeactivate = await deleteReq(`${base}/api/v1/staff/accounts/${newStaffId}`, adminAToken);
    check('Deactivate: deactivating an already-deactivated user -> 404', doubleDeactivate.status === 404, doubleDeactivate);
  });

  await pool.end();

  console.log('\n--- SUMMARY ---');
  console.log(`Total checks run, ${failures.length} failing.`);
  if (failures.length > 0) {
    console.error('\nFailures:');
    failures.forEach((f) => console.error(' -', f));
    process.exitCode = 1;
  } else {
    console.log('All staff-management checks passed.');
  }
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exitCode = 1;
});
