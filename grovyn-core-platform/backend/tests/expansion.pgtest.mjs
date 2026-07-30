/**
 * P35-01/P35-02 (Backend, 2026-07-30) — real-Postgres verification for:
 *   - src/routes/expansion.js (getExpansionPlan)
 *   - src/services/expansionService.js (real-tenant-data composition)
 *   - src/services/expansionPlanner.js's new resolveCostAssumptions /
 *     cost-assumption-parameterized projectFinancials/calculateGrovynImpact
 *   - tenant.settings jsonb column (schema.js, migration 0011)
 *
 * NOT part of `npm run verify` (no DB dependency there). Run explicitly:
 *
 *   npm run test:expansion
 *
 * against a real Postgres with migrations 0000-0011 + bootstrap-roles.sql
 * applied (same throwaway `postgres:16-alpine` container the sibling
 * P1/P2/P3/P4 suites use). Self-seeds two tenants directly via SQL, same
 * pattern as `dashboardFinance.pgtest.mjs`. Uses `77777777`-prefixed ids,
 * distinct from every sibling suite's fixture prefix.
 *
 * What this suite actually proves (per this task's explicit verification
 * bar):
 *   1. Two tenants with DIFFERENT real branch counts + real sale revenue
 *      produce DIFFERENT `currentStores`/`dataSource.avgMonthlyRevenuePerStore`/
 *      `selectedScenario.financials` output — not the same hardcoded number
 *      regardless of tenant (P35-01).
 *   2. Overriding a cost assumption (`cogsPct`, `equipmentCostPerStore`)
 *      changes the output PREDICTABLY (exact expected delta computed
 *      independently in this file, not just "it changed") (P35-02).
 *   3. A tenant's stored `tenant.settings.expansion` value is used as a
 *      default when no request override is supplied, and a request
 *      override still wins over it (precedence, P35-02).
 *   4. ADMIN-only enforcement + cross-tenant isolation (never trusting
 *      client-supplied tenant/branch data), same bar every other module in
 *      this codebase is held to.
 */

import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';

import { login } from '../src/routes/auth.js';
import { requireSession, requireRole as requireSessionRole } from '../src/middleware/sessionAuth.js';
import { getExpansionPlan } from '../src/routes/expansion.js';
import { hashPassword } from '../src/services/passwordService.js';
import { DEFAULT_COST_ASSUMPTIONS } from '../src/services/expansionPlanner.js';

const APP_URL = process.env.PGTEST_APP_URL || 'postgresql://grovyn_app:CHANGE_ME_APP@localhost:55433/grovyn';
const MIGRATOR_URL =
  process.env.PGTEST_MIGRATOR_URL || 'postgresql://grovyn_migrator:CHANGE_ME_MIGRATOR@localhost:55433/grovyn';

const TENANT_A = '77777777-5555-1111-1111-111111111111';
const TENANT_A_SLUG = 'expansion-p35-a';
const TENANT_B = '77777777-6666-1111-1111-111111111111';
const TENANT_B_SLUG = 'expansion-p35-b';

const BRANCH_A1 = '77777777-5555-2222-1111-111111111111';
const BRANCH_A2 = '77777777-5555-2222-2222-222222222222';
const BRANCH_B1 = '77777777-6666-2222-1111-111111111111';

const ADMIN_A_EMAIL = 'admin@expansion-p35-a.example';
const STAFF_A_EMAIL = 'staff@expansion-p35-a.example';
const ADMIN_B_EMAIL = 'admin@expansion-p35-b.example';
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

function closeEnough(a, b, eps = 0.5) {
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
      console.log('[seed] expansion fixture tenants already present, skipping seed.');
      return;
    }

    const pwHash = await hashPassword(REAL_PASSWORD);

    await client.query('BEGIN');

    // Tenant A: seeded with tenant.settings.expansion overriding
    // monthlyRentPerStore (proves setting-as-default precedence below).
    await client.query(
      `INSERT INTO tenant (id, name, slug, settings) VALUES
       ($1,$2,$3,$4::jsonb),
       ($5,$6,$7,'{}'::jsonb)`,
      [
        TENANT_A,
        'Expansion Fixture A',
        TENANT_A_SLUG,
        JSON.stringify({ expansion: { monthlyRentPerStore: 500000 } }),
        TENANT_B,
        'Expansion Fixture B',
        TENANT_B_SLUG,
      ]
    );

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
    const staffAId = crypto.randomUUID();
    const adminBId = crypto.randomUUID();
    await client.query(
      `INSERT INTO "user" (id, tenant_id, email, name, password_hash, role) VALUES ($1,$2,$3,'Fixture Admin A',$4,'ADMIN')`,
      [adminAId, TENANT_A, ADMIN_A_EMAIL, pwHash]
    );
    await client.query(
      `INSERT INTO "user" (id, tenant_id, email, name, password_hash, role) VALUES ($1,$2,$3,'Fixture Staff A',$4,'STAFF')`,
      [staffAId, TENANT_A, STAFF_A_EMAIL, pwHash]
    );
    await client.query(
      `INSERT INTO "user" (id, tenant_id, email, name, password_hash, role) VALUES ($1,$2,$3,'Fixture Admin B',$4,'ADMIN')`,
      [adminBId, TENANT_B, ADMIN_B_EMAIL, pwHash]
    );
    await client.query('INSERT INTO staff_branch_access (tenant_id, user_id, branch_id) VALUES ($1,$2,$3)', [
      TENANT_A,
      staffAId,
      BRANCH_A1,
    ]);

    // --- Inventory items (real COGS basis for avgMarginPct) -----------------
    const ITEM_A1 = crypto.randomUUID(); // cost 500.00/unit
    const ITEM_A2 = crypto.randomUUID(); // cost 200.00/unit
    const ITEM_B1 = crypto.randomUUID(); // cost 150.00/unit
    await client.query(
      `INSERT INTO inventory_item (id, tenant_id, branch_id, name, unit, current_stock, low_stock_threshold, cost_per_unit)
       VALUES
       ($1,$2,$3,'Fixture Item A1','unit',100,10,500.00),
       ($4,$2,$5,'Fixture Item A2','unit',100,10,200.00),
       ($6,$7,$8,'Fixture Item B1','unit',100,10,150.00)`,
      [ITEM_A1, TENANT_A, BRANCH_A1, ITEM_A2, BRANCH_A2, ITEM_B1, TENANT_B, BRANCH_B1]
    );

    // --- Sales, dated via the DB SERVER's own CURRENT_DATE (matches exactly
    // how getCurrentPeriodSummary/getFinanceSummary compute "this month"). ---
    async function insertSaleWithLine({ id, tenantId, branchId, createdBy, subtotal, tax, total, itemId, qty, unitPrice, lineSubtotal }) {
      await client.query(
        `INSERT INTO sale (id, tenant_id, branch_id, sale_date, source, subtotal_amount, tax_amount, total_amount, created_by_user_id)
         VALUES ($1,$2,$3,CURRENT_DATE,'manual',$4,$5,$6,$7)`,
        [id, tenantId, branchId, subtotal, tax, total, createdBy]
      );
      await client.query(
        `INSERT INTO sale_line_item (id, tenant_id, sale_id, inventory_item_id, item_name, quantity, unit_price, line_subtotal)
         VALUES ($1,$2,$3,$4,'Fixture Line',$5,$6,$7)`,
        [crypto.randomUUID(), tenantId, id, itemId, qty, unitPrice, lineSubtotal]
      );
    }

    // Tenant A: 2 branches. A1: 200 units * 500 = 100000 (cost 100000/2=... use qty*unitPrice per line).
    // A1 sale: subtotal 100000, tax 10000, total 110000; line: 200 * 500.00 = 100000 (fully costed).
    await insertSaleWithLine({
      id: crypto.randomUUID(),
      tenantId: TENANT_A,
      branchId: BRANCH_A1,
      createdBy: adminAId,
      subtotal: 100000.0,
      tax: 10000.0,
      total: 110000.0,
      itemId: ITEM_A1,
      qty: 200,
      unitPrice: 500.0,
      lineSubtotal: 100000.0,
    });
    // A2 sale: subtotal 50000, tax 5000, total 55000; line: 250 * 200.00 = 50000 (fully costed).
    await insertSaleWithLine({
      id: crypto.randomUUID(),
      tenantId: TENANT_A,
      branchId: BRANCH_A2,
      createdBy: adminAId,
      subtotal: 50000.0,
      tax: 5000.0,
      total: 55000.0,
      itemId: ITEM_A2,
      qty: 250,
      unitPrice: 200.0,
      lineSubtotal: 50000.0,
    });
    // Tenant A: 60-days-old sale, proves the "this month" window excludes it.
    await client.query(
      `INSERT INTO sale (id, tenant_id, branch_id, sale_date, source, subtotal_amount, tax_amount, total_amount, created_by_user_id)
       VALUES ($1,$2,$3,(CURRENT_DATE - INTERVAL '60 days')::date,'manual',999999.00,0,999999.00,$4)`,
      [crypto.randomUUID(), TENANT_A, BRANCH_A1, adminAId]
    );

    // Tenant B: 1 branch, smaller/different revenue -> proves different real
    // tenants get different output, not the same hardcoded number.
    // B1 sale: subtotal 30000, tax 3000, total 33000; line: 100 * 150.00 = 15000 (fully costed).
    await insertSaleWithLine({
      id: crypto.randomUUID(),
      tenantId: TENANT_B,
      branchId: BRANCH_B1,
      createdBy: adminBId,
      subtotal: 30000.0,
      tax: 3000.0,
      total: 33000.0,
      itemId: ITEM_B1,
      qty: 100,
      unitPrice: 150.0,
      lineSubtotal: 15000.0,
    });

    // Unresolved notification for A1 (proxy for the readiness "Stability"
    // criterion's real-data wiring).
    await client.query(
      `INSERT INTO notification (id, tenant_id, branch_id, type, title, message, status)
       VALUES ($1,$2,$3,'low_stock','Low stock fixture','fixture','unread')`,
      [crypto.randomUUID(), TENANT_A, BRANCH_A1]
    );

    await client.query('COMMIT');
    console.log('[seed] expansion fixture tenants + rows seeded.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
function buildTestApp(pool) {
  const app = express();
  app.use(express.json());

  app.post('/api/v1/auth/login', login(pool));

  const expansionAuth = [requireSession(pool), requireSessionRole(['ADMIN'])];
  app.get('/api/v1/expansion/plan', ...expansionAuth, getExpansionPlan(pool));

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
    const staffAToken = await loginAs(base, TENANT_A_SLUG, STAFF_A_EMAIL);
    const adminBToken = await loginAs(base, TENANT_B_SLUG, ADMIN_B_EMAIL);

    // =====================================================================
    // ADMIN-only enforcement
    // =====================================================================
    const asStaff = await getJson(`${base}/api/v1/expansion/plan`, staffAToken);
    check('expansion/plan: STAFF -> 403 (ADMIN-only)', asStaff.status === 403, asStaff);

    const noAuth = await getJson(`${base}/api/v1/expansion/plan`);
    check('expansion/plan: no session -> 401', noAuth.status === 401, noAuth);

    // =====================================================================
    // Input validation
    // =====================================================================
    const badScenarioDefaultsToModerate = await getJson(`${base}/api/v1/expansion/plan?scenario=not-a-real-one`, adminAToken);
    check(
      'expansion/plan: unrecognized scenario falls back to moderate (not a 400 -- matches legacy route behavior)',
      badScenarioDefaultsToModerate.status === 200 && badScenarioDefaultsToModerate.data?.selectedScenario?.name === 'Moderate',
      badScenarioDefaultsToModerate.data
    );

    const badCogs = await getJson(`${base}/api/v1/expansion/plan?cogsPct=1.5`, adminAToken);
    check('expansion/plan: cogsPct out of [0,1] range -> 400', badCogs.status === 400, badCogs);

    const badNewStores = await getJson(`${base}/api/v1/expansion/plan?newStores=999`, adminAToken);
    check('expansion/plan: newStores out of [1,10] range -> 400', badNewStores.status === 400, badNewStores);

    // =====================================================================
    // P35-01: real tenant data -- currentStores + avgMonthlyRevenuePerStore
    // MUST differ between tenant A (2 branches, 165000 total this-month
    // revenue) and tenant B (1 branch, 33000 revenue). NOT the same
    // hardcoded number regardless of tenant.
    // =====================================================================
    const planA = await getJson(`${base}/api/v1/expansion/plan?scenario=moderate`, adminAToken);
    check('expansion/plan: tenant A -> 200', planA.status === 200, planA);
    check('expansion/plan: tenant A currentStores = 2 (real branch count)', planA.data?.currentStores === 2, planA.data);
    check(
      'expansion/plan: tenant A avgMonthlyRevenuePerStore = 165000/2 = 82500 (real sale data)',
      closeEnough(planA.data?.dataSource?.avgMonthlyRevenuePerStore, 82500),
      planA.data?.dataSource
    );
    check(
      'expansion/plan: tenant A avgMarginPct = (165000-150000)/165000*100 ~= 9.09% (real COGS-linked margin)',
      closeEnough(planA.data?.dataSource?.avgMarginPct, 9.09, 0.05),
      planA.data?.dataSource
    );
    check(
      'expansion/plan: tenant A avgMarginIsPartial = false (every line item in the fixture is fully costed)',
      planA.data?.dataSource?.avgMarginIsPartial === false,
      planA.data?.dataSource
    );
    check(
      'expansion/plan: tenant A unresolvedNotificationCount = 1 (real notification data)',
      planA.data?.dataSource?.unresolvedNotificationCount === 1,
      planA.data?.dataSource
    );
    check(
      'expansion/plan: tenant A repeatRatePct is flagged as ASSUMED (not derivable from current schema -- honest, not fabricated)',
      planA.data?.dataSource?.repeatRatePctIsAssumed === true,
      planA.data?.dataSource
    );

    const planB = await getJson(`${base}/api/v1/expansion/plan?scenario=moderate`, adminBToken);
    check('expansion/plan: tenant B -> 200', planB.status === 200, planB);
    check('expansion/plan: tenant B currentStores = 1 (real branch count, DIFFERENT from tenant A)', planB.data?.currentStores === 1, planB.data);
    check(
      'expansion/plan: tenant B avgMonthlyRevenuePerStore = 33000/1 = 33000 (real sale data, DIFFERENT from tenant A)',
      closeEnough(planB.data?.dataSource?.avgMonthlyRevenuePerStore, 33000),
      planB.data?.dataSource
    );
    check(
      'expansion/plan: tenant A and tenant B produce genuinely DIFFERENT financials.year1Revenue (real per-tenant data, not a shared hardcoded figure)',
      planA.data?.selectedScenario?.financials?.year1Revenue !== planB.data?.selectedScenario?.financials?.year1Revenue,
      { a: planA.data?.selectedScenario?.financials?.year1Revenue, b: planB.data?.selectedScenario?.financials?.year1Revenue }
    );

    // =====================================================================
    // P35-02: tenant.settings.expansion default (tenant A was seeded with
    // monthlyRentPerStore=500000) is used when no query override is given.
    // =====================================================================
    check(
      'expansion/plan: tenant A costAssumptions.monthlyRentPerStore = 500000 (from tenant.settings.expansion, no query override)',
      planA.data?.costAssumptions?.monthlyRentPerStore === 500000,
      planA.data?.costAssumptions
    );
    check(
      "expansion/plan: tenant B (empty settings) costAssumptions.monthlyRentPerStore = engine default (100000)",
      planB.data?.costAssumptions?.monthlyRentPerStore === DEFAULT_COST_ASSUMPTIONS.monthlyRentPerStore,
      planB.data?.costAssumptions
    );
    // month-1 fixedCosts for the moderate scenario (3 new stores) should
    // reflect the SETTINGS-sourced rent, not the engine default, with no
    // query override at all -- proves the setting is actually load-bearing,
    // not just echoed back in costAssumptions.
    const monthlyRentDeltaExpected = (500000 - DEFAULT_COST_ASSUMPTIONS.monthlyRentPerStore) * 3; // 3 new stores in 'moderate'
    const planAMonth1Fixed = planA.data?.selectedScenario?.financials?.monthlyProjections?.[0]?.fixedCosts;

    const planADefaultRent = await getJson(
      `${base}/api/v1/expansion/plan?scenario=moderate&monthlyRentPerStore=${DEFAULT_COST_ASSUMPTIONS.monthlyRentPerStore}`,
      adminAToken
    );
    const planADefaultRentMonth1Fixed = planADefaultRent.data?.selectedScenario?.financials?.monthlyProjections?.[0]?.fixedCosts;
    check(
      'expansion/plan: settings-sourced rent (500000/store) actually changes month-1 fixedCosts by the predicted exact delta vs. the engine default rent',
      closeEnough(planAMonth1Fixed - planADefaultRentMonth1Fixed, monthlyRentDeltaExpected, 1),
      { withSettings: planAMonth1Fixed, withDefaultOverride: planADefaultRentMonth1Fixed, expectedDelta: monthlyRentDeltaExpected }
    );

    // Query override wins over tenant.settings.expansion (precedence).
    const planAQueryOverridesSettings = await getJson(`${base}/api/v1/expansion/plan?scenario=moderate&monthlyRentPerStore=1`, adminAToken);
    check(
      'expansion/plan: a request query override (monthlyRentPerStore=1) wins over tenant.settings.expansion (500000)',
      planAQueryOverridesSettings.data?.costAssumptions?.monthlyRentPerStore === 1,
      planAQueryOverridesSettings.data?.costAssumptions
    );

    // =====================================================================
    // P35-02: overriding cogsPct changes output PREDICTABLY -- compute the
    // exact expected month-1 cogs independently and compare, not just
    // "the number changed".
    // =====================================================================
    const cogsOverride = 0.3;
    const planACogsOverride = await getJson(`${base}/api/v1/expansion/plan?scenario=moderate&cogsPct=${cogsOverride}`, adminAToken);
    check('expansion/plan: cogsPct override -> 200', planACogsOverride.status === 200, planACogsOverride);
    check(
      'expansion/plan: costAssumptions.cogsPct reflects the override (0.3, not the default 0.6)',
      planACogsOverride.data?.costAssumptions?.cogsPct === cogsOverride,
      planACogsOverride.data?.costAssumptions
    );

    const month1Default = planADefaultRent.data?.selectedScenario?.financials?.monthlyProjections?.[0]; // default cogsPct (0.6), default rent
    const month1CogsOverride = planACogsOverride.data?.selectedScenario?.financials?.monthlyProjections?.[0];
    check(
      'expansion/plan: month-1 revenue is IDENTICAL between the cogsPct-override run and the baseline (cogsPct does not affect revenue)',
      closeEnough(month1Default?.revenue, month1CogsOverride?.revenue, 1),
      { baseline: month1Default?.revenue, override: month1CogsOverride?.revenue }
    );
    const expectedCogsDelta = (cogsOverride - DEFAULT_COST_ASSUMPTIONS.cogsPct) * month1Default?.revenue;
    check(
      'expansion/plan: month-1 cogs changes by EXACTLY the predicted delta ((0.3-0.6) * month-1 revenue) when cogsPct is overridden',
      closeEnough(month1CogsOverride?.cogs - month1Default?.cogs, expectedCogsDelta, 1),
      { baselineCogs: month1Default?.cogs, overrideCogs: month1CogsOverride?.cogs, expectedDelta: expectedCogsDelta }
    );

    // =====================================================================
    // P35-02: setup-cost breakdown override changes totalSetupCost by the
    // exact predicted delta (₹19L/store default -> overridden equipment leg).
    // =====================================================================
    check(
      'expansion/plan: baseline (no override) setupCosts.total = 1900000 (₹19L/store, unchanged default)',
      planADefaultRent.data?.selectedScenario?.financials?.setupCosts?.total === 1900000,
      planADefaultRent.data?.selectedScenario?.financials?.setupCosts
    );
    const equipmentOverride = 2000000; // was 1000000 -> +1000000 delta per store
    const planAEquipmentOverride = await getJson(
      `${base}/api/v1/expansion/plan?scenario=moderate&equipmentCostPerStore=${equipmentOverride}`,
      adminAToken
    );
    check(
      'expansion/plan: equipmentCostPerStore override -> setupCosts.total = 2900000 (only equipment changed, other 3 categories untouched)',
      planAEquipmentOverride.data?.selectedScenario?.financials?.setupCosts?.total === 2900000,
      planAEquipmentOverride.data?.selectedScenario?.financials?.setupCosts
    );
    const expectedTotalSetupCostDelta = (equipmentOverride - DEFAULT_COST_ASSUMPTIONS.setupCostPerStore.equipment) * 3; // moderate = 3 new stores
    check(
      'expansion/plan: totalSetupCost (across 3 new stores in the moderate scenario) changes by the exact predicted delta',
      closeEnough(
        planAEquipmentOverride.data?.selectedScenario?.financials?.totalSetupCost -
          planADefaultRent.data?.selectedScenario?.financials?.totalSetupCost,
        expectedTotalSetupCostDelta,
        1
      ),
      {
        baseline: planADefaultRent.data?.selectedScenario?.financials?.totalSetupCost,
        override: planAEquipmentOverride.data?.selectedScenario?.financials?.totalSetupCost,
        expectedDelta: expectedTotalSetupCostDelta,
      }
    );

    // =====================================================================
    // Custom newStores count is honored, still real-data-driven.
    // =====================================================================
    const planACustom = await getJson(`${base}/api/v1/expansion/plan?newStores=7`, adminAToken);
    check('expansion/plan: newStores=7 -> selectedScenario.name = Custom, newStores = 7', planACustom.data?.selectedScenario?.name === 'Custom' && planACustom.data?.selectedScenario?.newStores === 7, planACustom.data?.selectedScenario);

    // =====================================================================
    // Locale/currency override changes description text (formatting-only,
    // no number changes) -- proves the en-IN hardcode is genuinely lifted.
    // =====================================================================
    const planAUsd = await getJson(`${base}/api/v1/expansion/plan?scenario=moderate&currency=USD&locale=en-US`, adminAToken);
    const usdCalcString = planAUsd.data?.selectedScenario?.grovynImpact?.[0]?.calculation ?? '';
    check(
      'expansion/plan: currency/locale override changes the Grovyn-impact description formatting away from the ₹/en-IN default',
      usdCalcString.includes('$') && !usdCalcString.includes('₹'),
      usdCalcString
    );

    // =====================================================================
    // Output shape unchanged: same top-level keys the legacy mock route
    // returns (currentStores/readiness/topLocations/scenarios/
    // selectedScenario.{financials,grovynImpact,risks}), plus the additive
    // dataSource/costAssumptions blocks -- nothing REMOVED from the shape.
    // =====================================================================
    const shapeKeys = ['currentStores', 'readiness', 'topLocations', 'scenarios', 'selectedScenario', 'costAssumptions', 'dataSource'];
    check(
      'expansion/plan: response has all expected top-level keys',
      shapeKeys.every((k) => Object.prototype.hasOwnProperty.call(planA.data ?? {}, k)),
      Object.keys(planA.data ?? {})
    );
    check(
      'expansion/plan: selectedScenario has financials/grovynImpact/risks (same as legacy route)',
      Boolean(planA.data?.selectedScenario?.financials) &&
        Array.isArray(planA.data?.selectedScenario?.grovynImpact) &&
        Boolean(planA.data?.selectedScenario?.risks),
      planA.data?.selectedScenario
    );

    // =====================================================================
    // Cross-tenant isolation: tenant B never sees tenant A's branch count,
    // revenue, or settings-sourced rent override.
    // =====================================================================
    check(
      "expansion/plan: tenant B never inherits tenant A's settings-sourced monthlyRentPerStore override",
      planB.data?.costAssumptions?.monthlyRentPerStore !== 500000,
      planB.data?.costAssumptions
    );
    check(
      "expansion/plan: tenant B's currentStores/avgMonthlyRevenuePerStore reflect ONLY tenant B's own data",
      planB.data?.currentStores === 1 && closeEnough(planB.data?.dataSource?.avgMonthlyRevenuePerStore, 33000),
      planB.data
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
