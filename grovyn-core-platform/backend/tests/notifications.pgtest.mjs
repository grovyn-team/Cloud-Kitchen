/**
 * P4 backend (2026-07-30) — real-Postgres verification for the
 * Notifications module (reader/consumer side only):
 *   - src/routes/notifications.js (listNotifications, unreadCount, markRead,
 *     resolveNotification)
 *   - src/services/notificationService.js (list/count/status-transition
 *     logic)
 *
 * This suite does NOT exercise the PRODUCER side (Inventory's low-stock
 * trigger / staff restock request) at all — per this task's own
 * instruction, `notification` fixture rows are seeded DIRECTLY via SQL
 * (mimicking the exact shape `inventoryManagementService.js`'s
 * `maybeCreateLowStockNotification`/`routes/inventoryManagement.js`'s
 * `createRequest` already produce), so this suite stays isolated from the
 * Inventory module's own real-Postgres suite (`inventory.pgtest.mjs`).
 *
 * NOT part of `npm run verify` (no DB dependency there). Run explicitly:
 *
 *   npm run test:notifications
 *
 * against a real Postgres with migrations 0000-0010 + bootstrap-roles.sql
 * applied (same throwaway `postgres:16-alpine` container the sibling
 * P1-02/P1-03/P1-04/P2-02/P2-05/P3 suites use). This suite SELF-SEEDS its
 * own fixtures (two tenants) via the migrator connection, using tenant/
 * branch ids distinct from every sibling suite's fixtures (`eeeeeeee-...`
 * prefix — `auth`/`sales` use `99999999-...`, `inventory` uses
 * `88888888-...`, `customers` uses `cccccccc-...`, `staffManagement` uses
 * `dddddddd-...`) so all suites can run against the same shared database
 * without colliding.
 *
 * No test framework, plain Node ESM + a `check()` helper — matches the
 * sibling suites' convention exactly. Test app mounts the REAL route
 * handlers/middleware in the REAL composition order `routes/v1/index.js`
 * uses, including the extra ADMIN-only `requireRole` layered in front of
 * `resolveNotification`.
 */

import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';

import { login } from '../src/routes/auth.js';
import { requireSession, requireRole as requireSessionRole } from '../src/middleware/sessionAuth.js';
import { listNotifications, unreadCount, markRead, resolveNotification } from '../src/routes/notifications.js';
import { hashPassword } from '../src/services/passwordService.js';

const APP_URL =
  process.env.PGTEST_APP_URL || 'postgresql://grovyn_app:CHANGE_ME_APP@localhost:55433/grovyn';
const MIGRATOR_URL =
  process.env.PGTEST_MIGRATOR_URL ||
  'postgresql://grovyn_migrator:CHANGE_ME_MIGRATOR@localhost:55433/grovyn';

const TENANT_A = 'eeeeeeee-5555-1111-1111-111111111111';
const TENANT_A_SLUG = 'notifications-p4-a';
const TENANT_B = 'eeeeeeee-6666-1111-1111-111111111111';
const TENANT_B_SLUG = 'notifications-p4-b';

const BRANCH_A1 = 'eeeeeeee-5555-2222-1111-111111111111';
const BRANCH_A2 = 'eeeeeeee-5555-2222-2222-222222222222';
const BRANCH_B1 = 'eeeeeeee-6666-2222-1111-111111111111';

const ADMIN_A_EMAIL = 'admin@notifications-p4-a.example';
const STAFF_A1_EMAIL = 'staff1@notifications-p4-a.example';
const ADMIN_B_EMAIL = 'admin@notifications-p4-b.example';
const REAL_PASSWORD = 'Correct-Horse-Battery-Staple-1!';

// Fixture notification ids (fixed, so assertions can address them directly).
const NOTIF_LOWSTOCK_A1 = 'eeeeeeee-5555-3333-1111-111111111111'; // branch A1, unread -> read -> resolved (proves resolve reachable from 'read')
const NOTIF_REQUEST_A1 = 'eeeeeeee-5555-3333-2222-222222222222'; // branch A1, resolved directly from 'unread' (skips 'read')
const NOTIF_A2 = 'eeeeeeee-5555-3333-3333-333333333333'; // branch A2, stays 'unread' throughout
const NOTIF_B1 = 'eeeeeeee-6666-3333-1111-111111111111'; // tenant B, stays 'unread' (isolation fixture)

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
      console.log('[seed] notifications fixture tenants already present, skipping seed.');
      return;
    }

    const pwHash = await hashPassword(REAL_PASSWORD);

    await client.query('BEGIN');
    await client.query('INSERT INTO tenant (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)', [
      TENANT_A,
      'Notifications P4 Fixture A',
      TENANT_A_SLUG,
      TENANT_B,
      'Notifications P4 Fixture B',
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

    // Notification fixtures — inserted directly via SQL, mimicking the exact
    // row shape Inventory's producer side already writes (this suite does
    // NOT exercise that trigger logic itself). Four separate single-row
    // INSERTs, each with its own param list, deliberately NOT one
    // multi-row INSERT with shared/reused placeholders — a first draft of
    // this fixture did that and mis-indexed two params (wrong actor id,
    // wrong branch/tenant on the cross-tenant fixture); one statement per
    // row removes that whole class of mistake.
    const relatedItemId = crypto.randomUUID();
    await client.query(
      `INSERT INTO notification (id, tenant_id, branch_id, type, title, message, actor_user_id, related_entity_type, related_entity_id, status)
       VALUES ($1,$2,$3,'low_stock','Low stock: Paneer','Paneer is at 2 kg, at or below the low-stock threshold of 5 kg.',NULL,'inventory_item',$4,'unread')`,
      [NOTIF_LOWSTOCK_A1, TENANT_A, BRANCH_A1, relatedItemId]
    );
    await client.query(
      `INSERT INTO notification (id, tenant_id, branch_id, type, title, message, actor_user_id, related_entity_type, related_entity_id, status)
       VALUES ($1,$2,$3,'inventory_request','Stock request: Cooking Oil','Please restock cooking oil, running low for the weekend rush.',$4,'inventory_item',$5,'unread')`,
      [NOTIF_REQUEST_A1, TENANT_A, BRANCH_A1, staffA1Id, relatedItemId]
    );
    await client.query(
      `INSERT INTO notification (id, tenant_id, branch_id, type, title, message, actor_user_id, related_entity_type, related_entity_id, status)
       VALUES ($1,$2,$3,'low_stock','Low stock: Rice','Rice is at 1 kg, at or below the low-stock threshold of 10 kg.',NULL,'inventory_item',$4,'unread')`,
      [NOTIF_A2, TENANT_A, BRANCH_A2, relatedItemId]
    );
    await client.query(
      `INSERT INTO notification (id, tenant_id, branch_id, type, title, message, actor_user_id, related_entity_type, related_entity_id, status)
       VALUES ($1,$2,$3,'low_stock','Low stock: Rice (Tenant B)','Rice is at 1 kg, at or below the low-stock threshold of 10 kg.',NULL,'inventory_item',$4,'unread')`,
      [NOTIF_B1, TENANT_B, BRANCH_B1, relatedItemId]
    );

    await client.query('COMMIT');
    console.log('[seed] notifications fixture tenants + rows seeded:', { adminAId, staffA1Id, adminBId });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

async function withMigrator(fn) {
  const client = new pg.Client({ connectionString: MIGRATOR_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function getNotificationRow(id) {
  return withMigrator(async (client) => {
    const r = await client.query('SELECT * FROM notification WHERE id = $1', [id]);
    return r.rows[0] || null;
  });
}

// ---------------------------------------------------------------------------
// Test app: mounts the REAL handlers in the REAL composition order,
// including the extra ADMIN-only gate in front of resolve.
// ---------------------------------------------------------------------------
function buildTestApp(pool) {
  const app = express();
  app.use(express.json());

  app.post('/api/v1/auth/login', login(pool));

  const notifAuth = [requireSession(pool), requireSessionRole(['ADMIN', 'STAFF'])];
  app.get('/api/v1/notifications/unread-count', ...notifAuth, unreadCount(pool));
  app.get('/api/v1/notifications', ...notifAuth, listNotifications(pool));
  app.patch('/api/v1/notifications/:id/read', ...notifAuth, markRead(pool));
  app.patch(
    '/api/v1/notifications/:id/resolve',
    ...notifAuth,
    requireSessionRole(['ADMIN']),
    resolveNotification(pool)
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

async function patchJson(url, token) {
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({}),
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
    // unread-count: branch scope, tenant isolation, cross-branch admin.
    // Run BEFORE any status mutations so counts are deterministic.
    // -----------------------------------------------------------------
    const countStaffA1 = await getJson(`${base}/api/v1/notifications/unread-count`, staffA1Token);
    check('unread-count: staff (own branch only) -> 200', countStaffA1.status === 200, countStaffA1);
    check('unread-count: staff sees exactly their own branch (A1) unread count = 2', countStaffA1.data?.count === 2, countStaffA1.data);

    const countAdminA = await getJson(`${base}/api/v1/notifications/unread-count`, adminAToken);
    check('unread-count: admin (no branchId) -> 200', countAdminA.status === 200, countAdminA);
    check('unread-count: admin sees cross-branch total (A1 + A2) = 3', countAdminA.data?.count === 3, countAdminA.data);

    const countAdminB = await getJson(`${base}/api/v1/notifications/unread-count`, adminBToken);
    check(
      "unread-count: tenant B admin sees ONLY tenant B's own unread count (1), not tenant A's",
      countAdminB.status === 200 && countAdminB.data?.count === 1,
      countAdminB.data
    );

    const countStaffOtherBranch = await getJson(`${base}/api/v1/notifications/unread-count?branchId=${BRANCH_A2}`, staffA1Token);
    check('unread-count: staff filtering by a branch outside their scope -> 403', countStaffOtherBranch.status === 403, countStaffOtherBranch);

    const countBadBranch = await getJson(`${base}/api/v1/notifications/unread-count?branchId=not-a-uuid`, staffA1Token);
    check('unread-count: malformed branchId -> 400', countBadBranch.status === 400, countBadBranch);

    const countCrossTenantBranch = await getJson(`${base}/api/v1/notifications/unread-count?branchId=${BRANCH_B1}`, adminAToken);
    check('unread-count: cross-tenant branch-id smuggling rejected -> 403', countCrossTenantBranch.status === 403, countCrossTenantBranch);

    // -----------------------------------------------------------------
    // List: default status=unread, branch scope, tenant isolation,
    // status validation, pagination.
    // -----------------------------------------------------------------
    const listStaffDefault = await getJson(`${base}/api/v1/notifications`, staffA1Token);
    check('List: staff, no params -> 200', listStaffDefault.status === 200, listStaffDefault);
    check(
      'List: default status is unread -- both A1 fixtures returned, all status=unread',
      listStaffDefault.data?.data?.length === 2 && listStaffDefault.data.data.every((n) => n.status === 'unread'),
      listStaffDefault.data
    );
    check(
      'List: staff result set contains ONLY their own branch (A1)',
      listStaffDefault.data?.data?.every((n) => n.branchId === BRANCH_A1),
      listStaffDefault.data
    );
    check(
      "List: staff's list does NOT include the A2 fixture",
      !listStaffDefault.data?.data?.some((n) => n.id === NOTIF_A2),
      listStaffDefault.data
    );

    const listAdminADefault = await getJson(`${base}/api/v1/notifications`, adminAToken);
    check(
      'List: admin (no branchId) sees unread notifications across ALL own-tenant branches (3)',
      listAdminADefault.status === 200 && listAdminADefault.data?.data?.length === 3,
      listAdminADefault.data
    );

    const listAdminB = await getJson(`${base}/api/v1/notifications`, adminBToken);
    check(
      "List: tenant B admin sees ONLY tenant B's own fixture, never tenant A's rows",
      listAdminB.status === 200 && listAdminB.data?.data?.length === 1 && listAdminB.data.data[0]?.id === NOTIF_B1,
      listAdminB.data
    );

    const listBadStatus = await getJson(`${base}/api/v1/notifications?status=bogus`, staffA1Token);
    check('List: invalid status value -> 400', listBadStatus.status === 400, listBadStatus);

    const listStaffOtherBranch = await getJson(`${base}/api/v1/notifications?branchId=${BRANCH_A2}`, staffA1Token);
    check('List: staff filtering by a branch outside their scope -> 403', listStaffOtherBranch.status === 403, listStaffOtherBranch);

    const listPage1 = await getJson(`${base}/api/v1/notifications?page=1&pageSize=1`, staffA1Token);
    check('List: pagination -- pageSize respected', listPage1.data?.data?.length === 1 && listPage1.data?.meta?.pageSize === 1, listPage1.data);
    check('List: pagination -- meta.total reflects full count, not just this page', listPage1.data?.meta?.total === 2, listPage1.data?.meta);

    // -----------------------------------------------------------------
    // Mark read: unread -> read, idempotency, branch/tenant scope 404s.
    // -----------------------------------------------------------------
    const readWrongBranch = await patchJson(`${base}/api/v1/notifications/${NOTIF_A2}/read`, staffA1Token);
    check('Read: staff marking a notification outside their branch -> 404 (no existence leak)', readWrongBranch.status === 404, readWrongBranch);

    const readCrossTenant = await patchJson(`${base}/api/v1/notifications/${NOTIF_LOWSTOCK_A1}/read`, adminBToken);
    check('Read: cross-tenant mark-read of a real notification id -> 404', readCrossTenant.status === 404, readCrossTenant);

    const readNonexistent = await patchJson(`${base}/api/v1/notifications/${crypto.randomUUID()}/read`, staffA1Token);
    check('Read: nonexistent id -> 404', readNonexistent.status === 404, readNonexistent);

    const readMalformed = await patchJson(`${base}/api/v1/notifications/not-a-uuid/read`, staffA1Token);
    check('Read: malformed id -> 404', readMalformed.status === 404, readMalformed);

    const readRes = await patchJson(`${base}/api/v1/notifications/${NOTIF_LOWSTOCK_A1}/read`, staffA1Token);
    check('Read: staff marks their own branch notification read -> 200', readRes.status === 200, readRes);
    check('Read: status transitions to read', readRes.data?.status === 'read', readRes.data);

    const readRow1 = await getNotificationRow(NOTIF_LOWSTOCK_A1);
    check('Read: DB row status is read', readRow1?.status === 'read', readRow1);

    const readAgainRes = await patchJson(`${base}/api/v1/notifications/${NOTIF_LOWSTOCK_A1}/read`, staffA1Token);
    check('Read: marking an already-read notification read again -> 200 (idempotent, not an error)', readAgainRes.status === 200, readAgainRes);
    check('Read: idempotent no-op leaves status as read (not reverted/changed)', readAgainRes.data?.status === 'read', readAgainRes.data);

    // -----------------------------------------------------------------
    // Resolve: ADMIN-only role gate, unread -> resolved directly (skip
    // read), idempotency, resolved_by/resolved_at stamped, branch/tenant
    // scope 404s, resolving an already-'read' notification.
    // -----------------------------------------------------------------
    const resolveAsStaff = await patchJson(`${base}/api/v1/notifications/${NOTIF_REQUEST_A1}/resolve`, staffA1Token);
    check('Resolve: STAFF calling resolve -> 403 (ADMIN-only)', resolveAsStaff.status === 403, resolveAsStaff);
    const stillUnreadAfterStaffAttempt = await getNotificationRow(NOTIF_REQUEST_A1);
    check(
      "Resolve: STAFF's rejected attempt left the row untouched (still unread)",
      stillUnreadAfterStaffAttempt?.status === 'unread',
      stillUnreadAfterStaffAttempt
    );

    const resolveWrongBranchAdmin = await patchJson(`${base}/api/v1/notifications/${crypto.randomUUID()}/resolve`, adminAToken);
    check('Resolve: nonexistent id -> 404', resolveWrongBranchAdmin.status === 404, resolveWrongBranchAdmin);

    const resolveCrossTenant = await patchJson(`${base}/api/v1/notifications/${NOTIF_REQUEST_A1}/resolve`, adminBToken);
    check('Resolve: cross-tenant resolve of a real notification id -> 404', resolveCrossTenant.status === 404, resolveCrossTenant);

    const resolveRes = await patchJson(`${base}/api/v1/notifications/${NOTIF_REQUEST_A1}/resolve`, adminAToken);
    check('Resolve: admin resolves directly from unread (skipping read) -> 200', resolveRes.status === 200, resolveRes);
    check('Resolve: status transitions to resolved', resolveRes.data?.status === 'resolved', resolveRes.data);

    const resolvedRow1 = await getNotificationRow(NOTIF_REQUEST_A1);
    check('Resolve: DB row resolved_by_user_id is set', Boolean(resolvedRow1?.resolved_by_user_id), resolvedRow1);
    check('Resolve: DB row resolved_at is set', resolvedRow1?.resolved_at !== null, resolvedRow1);
    const firstResolvedAt = resolvedRow1?.resolved_at;
    const firstResolvedBy = resolvedRow1?.resolved_by_user_id;

    const resolveAgainRes = await patchJson(`${base}/api/v1/notifications/${NOTIF_REQUEST_A1}/resolve`, adminAToken);
    check('Resolve: resolving an already-resolved notification -> 200 (idempotent, not an error)', resolveAgainRes.status === 200, resolveAgainRes);
    const resolvedRow2 = await getNotificationRow(NOTIF_REQUEST_A1);
    check(
      'Resolve: idempotent no-op leaves resolved_at/resolved_by_user_id unchanged (not re-stamped)',
      resolvedRow2?.resolved_at?.getTime?.() === firstResolvedAt?.getTime?.() && resolvedRow2?.resolved_by_user_id === firstResolvedBy,
      { firstResolvedAt, secondResolvedAt: resolvedRow2?.resolved_at }
    );

    // Resolve a notification currently in 'read' (not 'unread') state --
    // proves resolve is reachable from either predecessor status.
    const resolveFromReadRes = await patchJson(`${base}/api/v1/notifications/${NOTIF_LOWSTOCK_A1}/resolve`, adminAToken);
    check('Resolve: admin resolves a notification currently in read state -> 200', resolveFromReadRes.status === 200, resolveFromReadRes);
    check('Resolve: status transitions read -> resolved', resolveFromReadRes.data?.status === 'resolved', resolveFromReadRes.data);

    // -----------------------------------------------------------------
    // Post-mutation list/count re-checks: prove the earlier writes are
    // reflected accurately, not just accepted.
    // -----------------------------------------------------------------
    const countStaffAfter = await getJson(`${base}/api/v1/notifications/unread-count`, staffA1Token);
    check('unread-count: branch A1 unread count is 0 after both A1 fixtures transitioned away from unread', countStaffAfter.data?.count === 0, countStaffAfter.data);

    const countAdminAAfter = await getJson(`${base}/api/v1/notifications/unread-count`, adminAToken);
    check('unread-count: tenant-wide admin count reflects only the remaining A2 unread fixture (1)', countAdminAAfter.data?.count === 1, countAdminAAfter.data);

    // Both A1 fixtures ended up 'resolved' above (NOTIF_REQUEST_A1 directly
    // from unread, NOTIF_LOWSTOCK_A1 from read) -- status=resolved should
    // return both, branch-scoped to A1 for this staff member.
    const listResolved = await getJson(`${base}/api/v1/notifications?status=resolved`, staffA1Token);
    check(
      'List: status=resolved returns both resolved A1 fixtures',
      listResolved.status === 200 &&
        listResolved.data?.data?.length === 2 &&
        listResolved.data.data.every((n) => n.status === 'resolved' && n.branchId === BRANCH_A1) &&
        listResolved.data.data.some((n) => n.id === NOTIF_REQUEST_A1) &&
        listResolved.data.data.some((n) => n.id === NOTIF_LOWSTOCK_A1),
      listResolved.data
    );
    check(
      'List: status=resolved rows carry resolvedByUserId/resolvedAt',
      listResolved.data?.data?.every((n) => Boolean(n.resolvedByUserId) && Boolean(n.resolvedAt)),
      listResolved.data
    );

    const listStaffDefaultAfter = await getJson(`${base}/api/v1/notifications`, staffA1Token);
    check(
      "List: default status=unread now returns EMPTY for staff (both their branch's fixtures moved on)",
      listStaffDefaultAfter.status === 200 && listStaffDefaultAfter.data?.data?.length === 0,
      listStaffDefaultAfter.data
    );

    const listUnreadAdminAfter = await getJson(`${base}/api/v1/notifications`, adminAToken);
    check(
      'List: admin default status=unread now returns only the A2 fixture',
      listUnreadAdminAfter.status === 200 && listUnreadAdminAfter.data?.data?.length === 1 && listUnreadAdminAfter.data.data[0]?.id === NOTIF_A2,
      listUnreadAdminAfter.data
    );

    const listResolvedAsAdminB = await getJson(`${base}/api/v1/notifications?status=resolved`, adminBToken);
    check(
      "List: tenant B admin's status=resolved query sees ZERO of tenant A's resolved rows (RLS, not app filtering)",
      listResolvedAsAdminB.status === 200 && Array.isArray(listResolvedAsAdminB.data?.data) && listResolvedAsAdminB.data.data.length === 0,
      listResolvedAsAdminB.data
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
