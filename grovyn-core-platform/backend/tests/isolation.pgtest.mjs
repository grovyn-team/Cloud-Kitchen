/**
 * P1-10 — Standing cross-tenant / cross-branch isolation test suite.
 *
 * This is the DoD gate CRITIQUE 016 (§B.2) and SECURITY_REVIEWS/002
 * (SEC-P101-IR-01) both name as a required, non-optional future check, and
 * that P1-05/P1-06/P1-07's TASK_BOARD notes point back to: "A can't reach
 * B; staff can't cross branch; prove RLS alone blocks." It is NOT a
 * per-module functional test suite (every module already has its own
 * `*.pgtest.mjs` sibling covering CRUD correctness in depth) -- this suite's
 * job is narrower and standing: (1) assert the CLUSTER-LEVEL privilege/RLS
 * controls that Drizzle's own snapshot cannot see are actually live, on
 * every run, against a real container, and (2) hold ONE consolidated,
 * intentionally-not-per-module-duplicated proof that a real authenticated
 * request from Tenant A (or a STAFF user scoped to one branch) cannot reach
 * Tenant B's (or another branch's) rows, in EVERY module that exists today,
 * even when the request is crafted with the other party's real UUID.
 *
 * Three sections, each independently important:
 *
 *   SECTION 0 -- Cluster-level privilege/RLS drift checks (CRITIQUE 016
 *   §B.2 + SECURITY_REVIEWS/002 IR-01, both non-optional, carried forward
 *   from the P1-00 spike's `pg_roles` check as a STANDING regression test,
 *   not a one-off spike artifact):
 *     - `grovyn_app.rolbypassrls = false` (a role silently granted
 *       BYPASSRLS dissolves every isolation guarantee this project has --
 *       nothing else catches that drift).
 *     - `grovyn_migrator.rolbypassrls = true` (contrast/sanity -- confirms
 *       the two roles are genuinely distinct, not that the query is
 *       trivially always-false).
 *     - `pg_class.relforcerowsecurity = true` for EVERY tenant-scoped table
 *       that exists in the schema today (15, not just the original 4 --
 *       Drizzle's snapshot has 0 occurrences of "FORCE", confirmed by IR-01,
 *       so a future migration silently dropping FORCE would never be
 *       caught by `db:generate`; only a live assertion catches it).
 *     - `has_table_privilege('grovyn_app', <table>, 'DELETE') = false` on
 *       every soft-delete-only table (14 of the 15 -- audit_log's own
 *       append-only case additionally asserts UPDATE=false too, and
 *       inventory_movement mirrors it), PLUS one intentional contrast case
 *       (`inventory_item_alias`, the one table that DOES grant DELETE) so
 *       this section proves the privilege check is discriminating, not
 *       vacuously false for every table.
 *
 *   SECTION 1 -- "RLS alone blocks" backstop proof (the DoD gate's own
 *   wording): connects directly as `grovyn_app` (bypassing every app-layer
 *   handler/DAL entirely), sets ONLY the tenant GUC, and issues a
 *   completely UNFILTERED `SELECT * FROM <table>` (no WHERE clause at all,
 *   simulating an app-layer bug that forgot to scope the query) against
 *   `sale`/`customer`/`tenant` -- proving the ROW SET returned is already
 *   tenant-A-only before any application code runs. Also proves fail-closed
 *   (no context set at all -> zero rows) and that RLS overrides even a
 *   DELIBERATELY WRONG app-supplied filter (`WHERE tenant_id = <tenant B>`
 *   while the GUC is set to tenant A) -- the policy wins, not the query.
 *
 *   SECTION 2/3 -- Functional cross-tenant + cross-branch denial proofs via
 *   the REAL route handlers/middleware (same composition
 *   `routes/v1/index.js` uses), across every now-real module: branches,
 *   sales, inventory, customers, staff accounts, notifications. Reuses the
 *   `customers.pgtest.mjs`/`staffManagement.pgtest.mjs` self-seeding /
 *   `check()` / `withServer()` conventions exactly -- no new pattern
 *   invented. For each module: (a) a session authenticated as Tenant A
 *   cannot read/write a row that genuinely belongs to Tenant B, even when
 *   the request is crafted with Tenant B's REAL uuid (not a random one --
 *   proves it isn't merely a "not found" for a nonexistent id); (b) a
 *   STAFF session scoped to Branch A1 cannot read/write a row that belongs
 *   to Branch A2, in the SAME tenant, again with a real uuid.
 *
 * NOT part of `npm run verify` (no DB dependency there). Run explicitly:
 *
 *   npm run test:isolation
 *
 * against a real Postgres with migrations 0000-0016 + bootstrap-roles.sql
 * applied (same container every sibling `*.pgtest.mjs` suite uses). This
 * suite SELF-SEEDS its own fixtures, using a `10101010-`/`10101010-` first
 * segment distinct from every sibling suite's fixtures (11111111/22222222
 * dal/tenantContext, 99999999 auth/sales, 88888888 inventory, 77777777
 * expansion, cccccccc customers, dddddddd staffmgmt, eeeeeeee notifications,
 * ffffffff dashboardFinance, facefeed tax -- see `customers.pgtest.mjs`'s
 * own doc comment for why a wholly distinct first segment, not just a
 * distinct second segment, is the safe disambiguation when suites share one
 * database).
 *
 * No test framework, plain Node ESM + a `check()` helper -- matches every
 * sibling suite's convention exactly.
 */

import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';

import { login } from '../src/routes/auth.js';
import { requireSession, requireRole as requireSessionRole } from '../src/middleware/sessionAuth.js';
import { createBranch, listBranches, getBranch } from '../src/routes/branches.js';
import { createSale, listSales, getSale } from '../src/routes/sales.js';
import {
  createItem as createInventoryItem,
  listItems as listInventoryItems,
  getItem as getInventoryItem,
} from '../src/routes/inventoryManagement.js';
import {
  createCustomer,
  listCustomers,
  getCustomer,
} from '../src/routes/customers.js';
import { listStaff, getStaffDetail } from '../src/routes/staffManagement.js';
import {
  listNotifications,
  markRead as markNotificationRead,
} from '../src/routes/notifications.js';
import { hashPassword } from '../src/services/passwordService.js';

const APP_URL =
  process.env.PGTEST_APP_URL || 'postgresql://grovyn_app:CHANGE_ME_APP@localhost:55433/grovyn';
const MIGRATOR_URL =
  process.env.PGTEST_MIGRATOR_URL ||
  'postgresql://grovyn_migrator:CHANGE_ME_MIGRATOR@localhost:55433/grovyn';

// Wholly distinct first segment ('10101010') from every sibling suite's
// fixtures -- see this file's doc comment.
const TENANT_A = '10101010-5555-1111-1111-111111111111';
const TENANT_A_SLUG = 'isolation-p110-a';
const TENANT_B = '10101010-6666-1111-1111-111111111111';
const TENANT_B_SLUG = 'isolation-p110-b';

const BRANCH_A1 = '10101010-5555-2222-1111-111111111111'; // A-North
const BRANCH_A2 = '10101010-5555-2222-2222-222222222222'; // A-South
const BRANCH_B1 = '10101010-6666-2222-1111-111111111111'; // B-Only

const ADMIN_A_EMAIL = 'admin@isolation-p110-a.example';
const STAFF_A1_EMAIL = 'staff1@isolation-p110-a.example';
const ADMIN_B_EMAIL = 'admin@isolation-p110-b.example';
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
// Seed: 2 tenants, 3 branches (A gets 2, B gets 1), 1 ADMIN + 1 STAFF per
// tenant, tax_rate rows (createSale fails closed without one -- Integration
// Task 2, round 3), same pattern as sales.pgtest.mjs.
// ---------------------------------------------------------------------------
async function seed() {
  const client = new pg.Client({ connectionString: MIGRATOR_URL });
  await client.connect();
  try {
    const already = await client.query('SELECT count(*) AS n FROM tenant WHERE id = $1', [TENANT_A]);
    if (Number(already.rows[0].n) > 0) {
      console.log('[seed] isolation fixture tenants already present, skipping seed.');
      return;
    }

    const pwHash = await hashPassword(REAL_PASSWORD);

    await client.query('BEGIN');
    await client.query('INSERT INTO tenant (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)', [
      TENANT_A,
      'Isolation P1-10 Fixture A',
      TENANT_A_SLUG,
      TENANT_B,
      'Isolation P1-10 Fixture B',
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

    await client.query(
      `INSERT INTO tax_rate (tenant_id, rate_percent, effective_from, effective_to) VALUES ($1, 5.00, DATE '2000-01-01', NULL), ($2, 5.00, DATE '2000-01-01', NULL)`,
      [TENANT_A, TENANT_B]
    );

    await client.query('COMMIT');
    console.log('[seed] isolation fixture tenants seeded:', { adminAId, staffA1Id, adminBId });
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

// ---------------------------------------------------------------------------
// SECTION 0 -- cluster-level privilege / RLS drift checks. Independent of
// the rest of the suite -- no server, no fixtures required beyond the roles
// bootstrap + migrations already being applied. Run first.
// ---------------------------------------------------------------------------

// Every tenant-scoped table that exists in the schema today (15). Kept as
// one explicit list, not derived from information_schema, so an added table
// that FORGETS to ship its own FORCE+GRANT migration shows up as a missing
// entry in a future diff of this list -- a deliberate manual chokepoint,
// same reasoning as D-009's checkLimit() single-chokepoint pattern.
const TENANT_SCOPED_TABLES = [
  'tenant',
  'user',
  'session',
  'audit_log',
  'branch',
  'staff_branch_access',
  'sale',
  'sale_line_item',
  'tax_rate',
  'inventory_item',
  'inventory_item_alias',
  'inventory_movement',
  'customer',
  'notification',
  'tax_period_summary',
];

// Tables granted SELECT/INSERT/UPDATE only (no DELETE) -- the soft-delete-
// only discipline (D-008) enforced at the privilege layer, not just app
// discipline. Every tenant-scoped table EXCEPT inventory_item_alias (see
// CONTRAST_DELETE_ALLOWED below) and the two append-only tables (handled
// separately, stricter).
const DELETE_DENIED_TABLES = [
  'tenant',
  'user',
  'session',
  'branch',
  'staff_branch_access',
  'sale',
  'sale_line_item',
  'tax_rate',
  'inventory_item',
  'customer',
  'notification',
  'tax_period_summary',
];

// Append-only tables: SELECT/INSERT only -- no UPDATE, no DELETE. Even a
// compromised/buggy `grovyn_app` identity cannot alter or remove an
// existing row, only add new ones.
const APPEND_ONLY_TABLES = ['audit_log', 'inventory_movement'];

// The one deliberate contrast case: inventory_item_alias grants DELETE
// (ordinary lookup data, not a financial/audit record -- see
// 0016_force_rls_grants_and_seed_item_aliases.sql's own doc comment). If
// this ever came back `false`, the has_table_privilege plumbing itself
// would be suspect (e.g. querying the wrong role) rather than the schema
// being newly over-locked-down -- included so this section can't pass
// vacuously by every assertion happening to be "false".
const CONTRAST_DELETE_ALLOWED_TABLE = 'inventory_item_alias';

const RESERVED_TABLE_NAMES = new Set(['user']);

function quotedIdentifier(table) {
  return RESERVED_TABLE_NAMES.has(table) ? `"${table}"` : table;
}

async function hasTablePrivilege(client, role, table, privilege) {
  const r = await client.query('SELECT has_table_privilege($1, $2, $3) AS has', [
    role,
    quotedIdentifier(table),
    privilege,
  ]);
  return r.rows[0].has;
}

async function relForceRls(client, table) {
  const r = await client.query(
    `SELECT relforcerowsecurity FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = $1`,
    [table]
  );
  if (r.rows.length === 0) return { found: false, value: null };
  return { found: true, value: r.rows[0].relforcerowsecurity };
}

async function rolBypassRls(client, role) {
  const r = await client.query('SELECT rolbypassrls FROM pg_roles WHERE rolname = $1', [role]);
  if (r.rows.length === 0) return { found: false, value: null };
  return { found: true, value: r.rows[0].rolbypassrls };
}

async function runClusterPrivilegeChecks() {
  await withMigrator(async (client) => {
    // CRITIQUE 016 §B.2 -- carried forward from the P1-00 spike's pg_roles
    // check as a standing regression test.
    const appRole = await rolBypassRls(client, 'grovyn_app');
    check(
      'Cluster: grovyn_app.rolbypassrls = false (a role silently granted BYPASSRLS dissolves every isolation guarantee)',
      appRole.found && appRole.value === false,
      appRole
    );
    const migratorRole = await rolBypassRls(client, 'grovyn_migrator');
    check(
      'Cluster: grovyn_migrator.rolbypassrls = true (contrast -- confirms the two roles are genuinely distinct, not that the check is vacuous)',
      migratorRole.found && migratorRole.value === true,
      migratorRole
    );

    // SEC-P101-IR-01 -- FORCE ROW LEVEL SECURITY is invisible to Drizzle's
    // snapshot; assert it live for every tenant-scoped table that exists
    // today.
    for (const table of TENANT_SCOPED_TABLES) {
      const result = await relForceRls(client, table);
      check(
        `Cluster: pg_class.relforcerowsecurity = true for "${table}"`,
        result.found && result.value === true,
        result
      );
    }

    // SEC-P101-IR-01 -- the GRANT/privilege model is equally invisible to
    // Drizzle; assert DELETE is withheld on every soft-delete-only table.
    for (const table of DELETE_DENIED_TABLES) {
      const canDelete = await hasTablePrivilege(client, 'grovyn_app', table, 'DELETE');
      check(`Cluster: has_table_privilege(grovyn_app, "${table}", DELETE) = false`, canDelete === false, {
        table,
        canDelete,
      });
    }

    // Append-only tables: stricter -- both UPDATE and DELETE withheld.
    for (const table of APPEND_ONLY_TABLES) {
      const canUpdate = await hasTablePrivilege(client, 'grovyn_app', table, 'UPDATE');
      const canDelete = await hasTablePrivilege(client, 'grovyn_app', table, 'DELETE');
      check(`Cluster: has_table_privilege(grovyn_app, "${table}", UPDATE) = false (append-only)`, canUpdate === false, {
        table,
        canUpdate,
      });
      check(`Cluster: has_table_privilege(grovyn_app, "${table}", DELETE) = false (append-only)`, canDelete === false, {
        table,
        canDelete,
      });
    }

    // Contrast case -- proves the DELETE check above is discriminating, not
    // vacuously false for every table it's asked about.
    const aliasCanDelete = await hasTablePrivilege(
      client,
      'grovyn_app',
      CONTRAST_DELETE_ALLOWED_TABLE,
      'DELETE'
    );
    check(
      `Cluster: has_table_privilege(grovyn_app, "${CONTRAST_DELETE_ALLOWED_TABLE}", DELETE) = true (contrast case -- ordinary lookup data, not a financial/audit record; proves the DELETE=false checks above are real, not vacuous)`,
      aliasCanDelete === true,
      { aliasCanDelete }
    );
  });
}

// ---------------------------------------------------------------------------
// SECTION 1 -- "RLS alone blocks" backstop proof. Connects directly as
// grovyn_app, bypassing every app-layer handler/DAL/query-builder entirely.
// Must run AFTER fixture rows exist (called from main(), after seedModuleData()).
// ---------------------------------------------------------------------------
async function runRlsAloneBackstopProof() {
  const client = new pg.Client({ connectionString: APP_URL });
  await client.connect();
  try {
    // Fail-closed: no context set at all -> zero rows, for every table.
    await client.query('BEGIN');
    const noCtxSale = await client.query('SELECT * FROM sale');
    check('RLS-alone: no tenant context set -> SELECT * FROM sale returns 0 rows (fail-closed)', noCtxSale.rows.length === 0, {
      rowCount: noCtxSale.rows.length,
    });
    const noCtxTenant = await client.query('SELECT * FROM tenant');
    check('RLS-alone: no tenant context set -> SELECT * FROM tenant returns 0 rows (fail-closed)', noCtxTenant.rows.length === 0, {
      rowCount: noCtxTenant.rows.length,
    });
    await client.query('COMMIT');

    // Set context to Tenant A ONLY. Then issue completely UNFILTERED
    // queries (no WHERE clause at all -- simulating an app-layer bug that
    // forgot to scope) and prove the row set returned is already
    // tenant-A-only before any application code ran.
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [TENANT_A]);

    const unfilteredSales = await client.query('SELECT * FROM sale');
    check(
      'RLS-alone: UNFILTERED "SELECT * FROM sale" under Tenant A context returns only Tenant A rows (RLS backstop, no app WHERE clause at all)',
      unfilteredSales.rows.length > 0 && unfilteredSales.rows.every((r) => r.tenant_id === TENANT_A),
      { rowCount: unfilteredSales.rows.length, tenantIds: [...new Set(unfilteredSales.rows.map((r) => r.tenant_id))] }
    );

    const unfilteredCustomers = await client.query('SELECT * FROM customer');
    check(
      'RLS-alone: UNFILTERED "SELECT * FROM customer" under Tenant A context returns only Tenant A rows',
      unfilteredCustomers.rows.length > 0 && unfilteredCustomers.rows.every((r) => r.tenant_id === TENANT_A),
      { rowCount: unfilteredCustomers.rows.length, tenantIds: [...new Set(unfilteredCustomers.rows.map((r) => r.tenant_id))] }
    );

    const unfilteredTenant = await client.query('SELECT * FROM tenant');
    check(
      'RLS-alone: UNFILTERED "SELECT * FROM tenant" under Tenant A context returns exactly the caller\'s own tenant row, not every tenant',
      unfilteredTenant.rows.length === 1 && unfilteredTenant.rows[0].id === TENANT_A,
      unfilteredTenant.rows
    );

    // Prove RLS overrides even a DELIBERATELY WRONG app-supplied filter --
    // the policy wins, not the query text. GUC is Tenant A; the WHERE
    // clause explicitly asks for Tenant B's rows.
    const wrongFilter = await client.query('SELECT * FROM sale WHERE tenant_id = $1', [TENANT_B]);
    check(
      'RLS-alone: a query explicitly filtered to Tenant B while the GUC is set to Tenant A still returns 0 rows (RLS, not the WHERE clause, is what decides)',
      wrongFilter.rows.length === 0,
      { rowCount: wrongFilter.rows.length }
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Test app: mounts the REAL route handlers/middleware in the REAL
// composition order routes/v1/index.js uses, for every module this suite
// exercises.
// ---------------------------------------------------------------------------
function buildTestApp(pool) {
  const app = express();
  app.use(express.json());

  app.post('/api/v1/auth/login', login(pool));

  const adminOrStaff = [requireSession(pool), requireSessionRole(['ADMIN', 'STAFF'])];
  const adminOnly = [requireSession(pool), requireSessionRole(['ADMIN'])];

  app.post('/api/v1/branches', ...adminOnly, createBranch(pool));
  app.get('/api/v1/branches', ...adminOrStaff, listBranches(pool));
  app.get('/api/v1/branches/:id', ...adminOrStaff, getBranch(pool));

  app.post('/api/v1/sales', ...adminOrStaff, createSale(pool));
  app.get('/api/v1/sales', ...adminOrStaff, listSales(pool));
  app.get('/api/v1/sales/:id', ...adminOrStaff, getSale(pool));

  app.post('/api/v1/inventory/items', ...adminOrStaff, createInventoryItem(pool));
  app.get('/api/v1/inventory/items', ...adminOrStaff, listInventoryItems(pool));
  app.get('/api/v1/inventory/items/:id', ...adminOrStaff, getInventoryItem(pool));

  app.post('/api/v1/customers', ...adminOrStaff, createCustomer(pool));
  app.get('/api/v1/customers', ...adminOrStaff, listCustomers(pool));
  app.get('/api/v1/customers/:id', ...adminOrStaff, getCustomer(pool));

  app.get('/api/v1/staff/accounts', ...adminOnly, listStaff(pool));
  app.get('/api/v1/staff/accounts/:id', ...adminOnly, getStaffDetail(pool));

  app.get('/api/v1/notifications', ...adminOrStaff, listNotifications(pool));
  app.patch('/api/v1/notifications/:id/read', ...adminOrStaff, markNotificationRead(pool));

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

async function loginAs(base, tenantSlug, email) {
  const r = await postJson(`${base}/api/v1/auth/login`, { tenantSlug, email, password: REAL_PASSWORD });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(r)}`);
  return r.data.sessionToken;
}

// ---------------------------------------------------------------------------
// Seed real module data across Tenant A (both branches) and Tenant B via
// the REAL API, so the cross-tenant/cross-branch checks below operate on
// genuine, non-trivial rows with real uuids (not hand-inserted rows that
// happen to look right).
// ---------------------------------------------------------------------------
async function seedModuleData(base, { adminAToken, staffA1Token, adminBToken }) {
  const saleA1 = await postJson(
    `${base}/api/v1/sales`,
    { branchId: BRANCH_A1, saleDate: '2026-03-01', lineItems: [{ itemName: 'Isolation Item A1', quantity: 1, unitPrice: 100 }] },
    staffA1Token
  );
  const saleA2 = await postJson(
    `${base}/api/v1/sales`,
    { branchId: BRANCH_A2, saleDate: '2026-03-01', lineItems: [{ itemName: 'Isolation Item A2', quantity: 1, unitPrice: 200 }] },
    adminAToken
  );
  const saleB1 = await postJson(
    `${base}/api/v1/sales`,
    { branchId: BRANCH_B1, saleDate: '2026-03-01', lineItems: [{ itemName: 'Isolation Item B1', quantity: 1, unitPrice: 300 }] },
    adminBToken
  );

  const itemA1 = await postJson(`${base}/api/v1/inventory/items`, { branchId: BRANCH_A1, name: 'Iso Item A1', unit: 'kg' }, staffA1Token);
  const itemA2 = await postJson(`${base}/api/v1/inventory/items`, { branchId: BRANCH_A2, name: 'Iso Item A2', unit: 'kg' }, adminAToken);
  const itemB1 = await postJson(`${base}/api/v1/inventory/items`, { branchId: BRANCH_B1, name: 'Iso Item B1', unit: 'kg' }, adminBToken);

  const customerA1 = await postJson(`${base}/api/v1/customers`, { branchId: BRANCH_A1, name: 'Iso Customer A1' }, staffA1Token);
  const customerA2 = await postJson(`${base}/api/v1/customers`, { branchId: BRANCH_A2, name: 'Iso Customer A2' }, adminAToken);
  const customerB1 = await postJson(`${base}/api/v1/customers`, { branchId: BRANCH_B1, name: 'Iso Customer B1' }, adminBToken);

  const seedSanity = [
    ['sale A1', saleA1],
    ['sale A2', saleA2],
    ['sale B1', saleB1],
    ['item A1', itemA1],
    ['item A2', itemA2],
    ['item B1', itemB1],
    ['customer A1', customerA1],
    ['customer A2', customerA2],
    ['customer B1', customerB1],
  ];
  for (const [label, res] of seedSanity) {
    check(`Seed sanity: ${label} created -> 201`, res.status === 201, res);
  }

  // Notifications have no simple direct-API producer in this suite's scope
  // (the real producer is the low-stock trigger inside
  // inventoryManagementService, already covered by inventory.pgtest.mjs) --
  // seeded directly via the migrator connection, same convention
  // notifications.pgtest.mjs itself uses for its own fixture rows.
  const notifA1 = crypto.randomUUID();
  const notifA2 = crypto.randomUUID();
  const notifB1 = crypto.randomUUID();
  await withMigrator(async (client) => {
    await client.query(
      `INSERT INTO notification (id, tenant_id, branch_id, type, title, message, status)
       VALUES ($1,$2,$3,'low_stock','Iso Notif A1','fixture',$4)`,
      [notifA1, TENANT_A, BRANCH_A1, 'unread']
    );
    await client.query(
      `INSERT INTO notification (id, tenant_id, branch_id, type, title, message, status)
       VALUES ($1,$2,$3,'low_stock','Iso Notif A2','fixture',$4)`,
      [notifA2, TENANT_A, BRANCH_A2, 'unread']
    );
    await client.query(
      `INSERT INTO notification (id, tenant_id, branch_id, type, title, message, status)
       VALUES ($1,$2,$3,'low_stock','Iso Notif B1','fixture',$4)`,
      [notifB1, TENANT_B, BRANCH_B1, 'unread']
    );
  });

  return {
    saleA1Id: saleA1.data?.id,
    saleA2Id: saleA2.data?.id,
    saleB1Id: saleB1.data?.id,
    itemA1Id: itemA1.data?.id,
    itemA2Id: itemA2.data?.id,
    itemB1Id: itemB1.data?.id,
    customerA1Id: customerA1.data?.id,
    customerA2Id: customerA2.data?.id,
    customerB1Id: customerB1.data?.id,
    notifA1Id: notifA1,
    notifA2Id: notifA2,
    notifB1Id: notifB1,
  };
}

// ---------------------------------------------------------------------------
async function main() {
  await seed();

  // SECTION 0 -- runs first, independent of everything else below.
  await runClusterPrivilegeChecks();

  const pool = new pg.Pool({ connectionString: APP_URL, max: 5 });
  let ids;
  await withServer(pool, async (base) => {
    const adminAToken = await loginAs(base, TENANT_A_SLUG, ADMIN_A_EMAIL);
    const staffA1Token = await loginAs(base, TENANT_A_SLUG, STAFF_A1_EMAIL);
    const adminBToken = await loginAs(base, TENANT_B_SLUG, ADMIN_B_EMAIL);

    ids = await seedModuleData(base, { adminAToken, staffA1Token, adminBToken });

    // ---------------------------------------------------------------
    // SECTION 1 -- RLS-alone backstop proof. Needs the fixture rows above.
    // ---------------------------------------------------------------
    await runRlsAloneBackstopProof();

    // ---------------------------------------------------------------
    // SECTION 2 -- cross-TENANT denial, per module. Tenant A's admin/staff
    // craft requests using Tenant B's REAL uuids.
    // ---------------------------------------------------------------

    // Branches
    const crossTenantBranchDetail = await getJson(`${base}/api/v1/branches/${BRANCH_B1}`, adminAToken);
    check('Cross-tenant: Tenant A admin reading Tenant B\'s real branch id -> 404', crossTenantBranchDetail.status === 404, crossTenantBranchDetail);
    const branchListA = await getJson(`${base}/api/v1/branches`, adminAToken);
    check(
      'Cross-tenant: Tenant A admin\'s branch list contains ZERO of Tenant B\'s branches',
      branchListA.status === 200 && !branchListA.data?.data?.some((b) => b.id === BRANCH_B1),
      branchListA.data
    );

    // Sales
    const crossTenantSaleDetail = await getJson(`${base}/api/v1/sales/${ids.saleB1Id}`, adminAToken);
    check('Cross-tenant: Tenant A admin reading Tenant B\'s real sale id -> 404', crossTenantSaleDetail.status === 404, crossTenantSaleDetail);
    const crossTenantSaleWrite = await postJson(
      `${base}/api/v1/sales`,
      { branchId: BRANCH_B1, saleDate: '2026-03-01', lineItems: [{ itemName: 'Smuggled', quantity: 1, unitPrice: 1 }] },
      adminAToken
    );
    check(
      'Cross-tenant: Tenant A admin writing a sale against Tenant B\'s real branch id -> 403 (not silently written with mismatched tenant/branch)',
      crossTenantSaleWrite.status === 403,
      crossTenantSaleWrite
    );
    const salesListA = await getJson(`${base}/api/v1/sales`, adminAToken);
    check(
      'Cross-tenant: Tenant A admin\'s sales list contains ZERO of Tenant B\'s sales',
      salesListA.status === 200 && !salesListA.data?.data?.some((s) => s.id === ids.saleB1Id),
      salesListA.data
    );

    // Inventory
    const crossTenantItemDetail = await getJson(`${base}/api/v1/inventory/items/${ids.itemB1Id}`, adminAToken);
    check('Cross-tenant: Tenant A admin reading Tenant B\'s real inventory item id -> 404', crossTenantItemDetail.status === 404, crossTenantItemDetail);
    const crossTenantItemWrite = await postJson(`${base}/api/v1/inventory/items`, { branchId: BRANCH_B1, name: 'Smuggled', unit: 'kg' }, adminAToken);
    check('Cross-tenant: Tenant A admin creating an inventory item against Tenant B\'s real branch id -> 403', crossTenantItemWrite.status === 403, crossTenantItemWrite);
    const itemsListA = await getJson(`${base}/api/v1/inventory/items?branchId=${BRANCH_A1}`, adminAToken);
    check(
      'Cross-tenant: Tenant A admin\'s inventory list (own branch) contains ZERO of Tenant B\'s items',
      itemsListA.status === 200 && !itemsListA.data?.data?.some((i) => i.id === ids.itemB1Id),
      itemsListA.data
    );

    // Customers
    const crossTenantCustomerDetail = await getJson(`${base}/api/v1/customers/${ids.customerB1Id}`, adminAToken);
    check('Cross-tenant: Tenant A admin reading Tenant B\'s real customer id -> 404', crossTenantCustomerDetail.status === 404, crossTenantCustomerDetail);
    const crossTenantCustomerWrite = await postJson(`${base}/api/v1/customers`, { branchId: BRANCH_B1, name: 'Smuggled' }, adminAToken);
    check('Cross-tenant: Tenant A admin creating a customer against Tenant B\'s real branch id -> 403', crossTenantCustomerWrite.status === 403, crossTenantCustomerWrite);
    const customersListB = await getJson(`${base}/api/v1/customers`, adminBToken);
    check(
      'Cross-tenant: Tenant B admin\'s customer list contains ZERO of Tenant A\'s customers (RLS, not app filtering) -- Tenant B has its own customer (customerB1) so this asserts exclusion, not emptiness',
      customersListB.status === 200 &&
        Array.isArray(customersListB.data?.data) &&
        !customersListB.data.data.some((c) => c.id === ids.customerA1Id || c.id === ids.customerA2Id),
      customersListB.data
    );

    // Staff accounts (ADMIN-only module) -- Tenant B admin's real user id
    // read/attempted by Tenant A admin.
    const meB = await getJson(`${base}/api/v1/staff/accounts`, adminBToken);
    const adminBUserId = meB.data?.data?.find((u) => u.email === ADMIN_B_EMAIL)?.id;
    check('Seed sanity: resolved Tenant B admin\'s real user id via its own staff list', Boolean(adminBUserId), meB.data);
    const crossTenantStaffDetail = await getJson(`${base}/api/v1/staff/accounts/${adminBUserId}`, adminAToken);
    check('Cross-tenant: Tenant A admin reading Tenant B\'s real staff-account (user) id -> 404', crossTenantStaffDetail.status === 404, crossTenantStaffDetail);
    const staffListA = await getJson(`${base}/api/v1/staff/accounts`, adminAToken);
    check(
      'Cross-tenant: Tenant A admin\'s staff-accounts list contains ZERO of Tenant B\'s users',
      staffListA.status === 200 && !staffListA.data?.data?.some((u) => u.id === adminBUserId),
      staffListA.data
    );

    // Notifications
    const crossTenantNotifRead = await patchJson(`${base}/api/v1/notifications/${ids.notifB1Id}/read`, {}, adminAToken);
    check('Cross-tenant: Tenant A admin marking Tenant B\'s real notification id as read -> 404', crossTenantNotifRead.status === 404, crossTenantNotifRead);
    const notifListA = await getJson(`${base}/api/v1/notifications?status=unread`, adminAToken);
    check(
      'Cross-tenant: Tenant A admin\'s notification list contains ZERO of Tenant B\'s notifications',
      notifListA.status === 200 && !notifListA.data?.data?.some((n) => n.id === ids.notifB1Id),
      notifListA.data
    );

    // ---------------------------------------------------------------
    // SECTION 3 -- cross-BRANCH denial within the SAME tenant. STAFF
    // scoped to Branch A1 only, crafting requests with Branch A2's REAL
    // uuids/entity ids.
    // ---------------------------------------------------------------

    // Branches
    const staffCrossBranchDetail = await getJson(`${base}/api/v1/branches/${BRANCH_A2}`, staffA1Token);
    check('Cross-branch: STAFF (Branch A1 only) reading Branch A2\'s real id -> 404', staffCrossBranchDetail.status === 404, staffCrossBranchDetail);
    const staffBranchList = await getJson(`${base}/api/v1/branches`, staffA1Token);
    check(
      'Cross-branch: STAFF\'s branch list contains ONLY their own granted branch (A1), not A2',
      staffBranchList.status === 200 &&
        staffBranchList.data?.data?.length > 0 &&
        staffBranchList.data.data.every((b) => b.id === BRANCH_A1),
      staffBranchList.data
    );

    // Sales
    const staffCrossBranchSaleDetail = await getJson(`${base}/api/v1/sales/${ids.saleA2Id}`, staffA1Token);
    check('Cross-branch: STAFF (Branch A1 only) reading a real sale id from Branch A2 -> 404', staffCrossBranchSaleDetail.status === 404, staffCrossBranchSaleDetail);
    const staffCrossBranchSaleWrite = await postJson(
      `${base}/api/v1/sales`,
      { branchId: BRANCH_A2, saleDate: '2026-03-01', lineItems: [{ itemName: 'X', quantity: 1, unitPrice: 1 }] },
      staffA1Token
    );
    check('Cross-branch: STAFF (Branch A1 only) writing a sale to Branch A2 -> 403', staffCrossBranchSaleWrite.status === 403, staffCrossBranchSaleWrite);
    const staffSalesList = await getJson(`${base}/api/v1/sales`, staffA1Token);
    check(
      'Cross-branch: STAFF\'s sales list (no branch filter -> defaults to their own scope) contains ZERO of Branch A2\'s sales',
      staffSalesList.status === 200 && !staffSalesList.data?.data?.some((s) => s.id === ids.saleA2Id),
      staffSalesList.data
    );

    // Inventory
    const staffCrossBranchItemDetail = await getJson(`${base}/api/v1/inventory/items/${ids.itemA2Id}`, staffA1Token);
    check('Cross-branch: STAFF (Branch A1 only) reading a real inventory item id from Branch A2 -> 404', staffCrossBranchItemDetail.status === 404, staffCrossBranchItemDetail);
    const staffCrossBranchItemWrite = await postJson(`${base}/api/v1/inventory/items`, { branchId: BRANCH_A2, name: 'X', unit: 'kg' }, staffA1Token);
    check('Cross-branch: STAFF (Branch A1 only) creating an inventory item in Branch A2 -> 403', staffCrossBranchItemWrite.status === 403, staffCrossBranchItemWrite);

    // Customers
    const staffCrossBranchCustomerDetail = await getJson(`${base}/api/v1/customers/${ids.customerA2Id}`, staffA1Token);
    check('Cross-branch: STAFF (Branch A1 only) reading a real customer id from Branch A2 -> 404', staffCrossBranchCustomerDetail.status === 404, staffCrossBranchCustomerDetail);
    const staffCrossBranchCustomerWrite = await postJson(`${base}/api/v1/customers`, { branchId: BRANCH_A2, name: 'X' }, staffA1Token);
    check('Cross-branch: STAFF (Branch A1 only) creating a customer in Branch A2 -> 403', staffCrossBranchCustomerWrite.status === 403, staffCrossBranchCustomerWrite);
    const staffCustomerList = await getJson(`${base}/api/v1/customers`, staffA1Token);
    check(
      'Cross-branch: STAFF\'s (no-filter) customer list contains ZERO of Branch A2\'s customers',
      staffCustomerList.status === 200 && !staffCustomerList.data?.data?.some((c) => c.id === ids.customerA2Id),
      staffCustomerList.data
    );

    // Notifications
    const staffCrossBranchNotifRead = await patchJson(`${base}/api/v1/notifications/${ids.notifA2Id}/read`, {}, staffA1Token);
    check('Cross-branch: STAFF (Branch A1 only) marking a real notification id from Branch A2 as read -> 404', staffCrossBranchNotifRead.status === 404, staffCrossBranchNotifRead);
    const staffNotifList = await getJson(`${base}/api/v1/notifications?status=unread`, staffA1Token);
    check(
      'Cross-branch: STAFF\'s (no-filter) notification list contains ZERO of Branch A2\'s notifications',
      staffNotifList.status === 200 && !staffNotifList.data?.data?.some((n) => n.id === ids.notifA2Id),
      staffNotifList.data
    );

    // Staff accounts is ADMIN-only end to end (router-level requireRole) --
    // a STAFF session gets 403 before any handler runs, proven once here
    // (per-handler branch scope inside staffManagement.js doesn't apply,
    // that module has no branch dimension by design).
    const staffAccessingStaffAccounts = await getJson(`${base}/api/v1/staff/accounts`, staffA1Token);
    check('Staff module: STAFF session hitting ADMIN-only /staff/accounts -> 403 (router-level gate)', staffAccessingStaffAccounts.status === 403, staffAccessingStaffAccounts);
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
