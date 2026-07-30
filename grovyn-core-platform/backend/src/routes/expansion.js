/**
 * P35-01/P35-02 (Backend, 2026-07-30) — real, DB-backed Expansion Planning
 * endpoint:
 *   - GET /api/v1/expansion/plan — ADMIN-only (enforced at the ROUTER level
 *     in `routes/v1/index.js`, same `requireRole(['ADMIN'])` composition
 *     style as `finance/summary`/`dashboard/by-branch` — expansion
 *     projections are cross-branch, tenant-wide financial planning, not a
 *     STAFF-facing figure).
 *
 * NAMING/MOUNT NOTE: this is a NEW path, deliberately NOT
 * `/expansion/simulate` — that exact path is the pre-existing legacy
 * mock-backed route (`routes/intelligence.js#getExpansionSimulate`, still
 * mounted, still on the OLD `authMiddleware.js` HMAC scheme, driven by
 * in-memory `storeService`/`metricsEngine`/`alertOrchestratorService`) which
 * this task leaves completely untouched, same collision-avoidance posture
 * `routes/dashboard.js`/`routes/financeManagement.js` document for their own
 * legacy-mock siblings. `expansionPlanner.js`/`simulatorEngine.js`
 * themselves (the actual deterministic math) are shared/reused, not forked
 * — only the DATA FEEDING them changes here (P35-01), plus the cost
 * assumptions those pure functions accept now being overridable (P35-02).
 *
 * No AI/HF calls anywhere in this file or anything it calls — this is a
 * pure deterministic composition (DB reads + `expansionPlanner.js`'s pure
 * math), per this task's explicit no-AI scope and `PROJECT_BRIEF.md`'s O3
 * "deterministic rules engine, not an AI feature" rule.
 *
 * Cost-assumption override precedence (documented once, here — both the
 * service and this route apply it identically): request query params >
 * this tenant's `tenant.settings.expansion` > `expansionPlanner
 * .DEFAULT_COST_ASSUMPTIONS`. Only query params are validated here (shape/
 * range); `tenant.settings.expansion` is treated as already-trusted stored
 * config (it can only have been written by this tenant's own ADMIN through
 * whatever future settings-write endpoint lands — none exists yet, so today
 * it is only ever populated by direct DB seeding/tests) and is merged, not
 * re-validated, by `expansionService.gatherRealInputs`.
 */

import { withTenantContext, reply } from '../middleware/tenantContext.js';
import * as expansionService from '../services/expansionService.js';

function badRequest(message, details) {
  return reply(400, { error: 'BadRequest', message, ...(details ? { details } : {}) });
}

const SCENARIOS = ['conservative', 'moderate', 'aggressive'];

// Distinct sentinel (not a plain `{error:true}` object literal) so an
// out-of-range/non-finite result can never be confused with a legitimately
// parsed `0` — `INVALID.error` reads the same either way, but using a
// dedicated frozen object makes the intent explicit and avoids relying on
// falsy/truthy coercion of a valid `0` value anywhere below.
const INVALID = Object.freeze({ error: true });

function isInvalid(x) {
  return x === INVALID;
}

/**
 * Parses a query-string numeric override into a finite number, or returns
 * `undefined` (meaning "no override supplied", so downstream default/
 * tenant-settings resolution applies), or the `INVALID` sentinel — never
 * `NaN`/`null`, so callers can use a plain `typeof x === 'number'` check
 * everywhere else in this stack once `isInvalid()` has been ruled out.
 */
function parseNumberParam(value, { min, max } = {}) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return INVALID;
  if (typeof min === 'number' && n < min) return INVALID;
  if (typeof max === 'number' && n > max) return INVALID;
  return n;
}

/**
 * GET /api/v1/expansion/plan
 *   ?newStores=1-10          (optional — custom scenario override, same
 *                              semantics as the legacy mock route)
 *   &scenario=conservative|moderate|aggressive (default 'moderate')
 *   &repeatRatePct=0-100     (optional — see expansionService.js's doc
 *                              comment for why this can't be measured from
 *                              current schema)
 *   &cogsPct=0-1 &commissionPct=0-1
 *   &equipmentCostPerStore= &renovationCostPerStore= &depositCostPerStore=
 *     &inventoryCostPerStore=  (setup-cost breakdown overrides, INR — the
 *      ₹19L/store P35-02 named is the SUM of these four defaults)
 *   &monthlyRentPerStore= &monthlyUtilitiesPerStore= &monthlyStaffCostPerStore=
 *   &currency= &locale=      (formatting overrides for `dataSource`/
 *                              `selectedScenario.grovynImpact` description
 *                              strings only — does not change any number)
 * @param {import('pg').Pool} pool
 */
export function getExpansionPlan(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const query = req.query || {};

    const scenario = SCENARIOS.includes(query.scenario) ? query.scenario : 'moderate';

    const newStoresRaw = parseNumberParam(query.newStores, { min: 1, max: 10 });
    if (isInvalid(newStoresRaw)) {
      return badRequest('newStores must be a number between 1 and 10.');
    }

    const repeatRatePctOverride = parseNumberParam(query.repeatRatePct, { min: 0, max: 100 });
    if (isInvalid(repeatRatePctOverride)) {
      return badRequest('repeatRatePct must be a number between 0 and 100.');
    }

    const cogsPct = parseNumberParam(query.cogsPct, { min: 0, max: 1 });
    if (isInvalid(cogsPct)) return badRequest('cogsPct must be a number between 0 and 1 (a fraction, not a percent).');

    const commissionPct = parseNumberParam(query.commissionPct, { min: 0, max: 1 });
    if (isInvalid(commissionPct)) {
      return badRequest('commissionPct must be a number between 0 and 1 (a fraction, not a percent).');
    }

    const equipment = parseNumberParam(query.equipmentCostPerStore, { min: 0 });
    if (isInvalid(equipment)) return badRequest('equipmentCostPerStore must be a non-negative number.');
    const renovation = parseNumberParam(query.renovationCostPerStore, { min: 0 });
    if (isInvalid(renovation)) return badRequest('renovationCostPerStore must be a non-negative number.');
    const deposit = parseNumberParam(query.depositCostPerStore, { min: 0 });
    if (isInvalid(deposit)) return badRequest('depositCostPerStore must be a non-negative number.');
    const inventory = parseNumberParam(query.inventoryCostPerStore, { min: 0 });
    if (isInvalid(inventory)) return badRequest('inventoryCostPerStore must be a non-negative number.');

    const monthlyRentPerStore = parseNumberParam(query.monthlyRentPerStore, { min: 0 });
    if (isInvalid(monthlyRentPerStore)) return badRequest('monthlyRentPerStore must be a non-negative number.');
    const monthlyUtilitiesPerStore = parseNumberParam(query.monthlyUtilitiesPerStore, { min: 0 });
    if (isInvalid(monthlyUtilitiesPerStore)) {
      return badRequest('monthlyUtilitiesPerStore must be a non-negative number.');
    }
    const monthlyStaffCostPerStore = parseNumberParam(query.monthlyStaffCostPerStore, { min: 0 });
    if (isInvalid(monthlyStaffCostPerStore)) {
      return badRequest('monthlyStaffCostPerStore must be a non-negative number.');
    }

    const currency = typeof query.currency === 'string' && query.currency.trim() ? query.currency.trim() : undefined;
    const locale = typeof query.locale === 'string' && query.locale.trim() ? query.locale.trim() : undefined;

    const setupCostPerStore = {};
    if (typeof equipment === 'number') setupCostPerStore.equipment = equipment;
    if (typeof renovation === 'number') setupCostPerStore.renovation = renovation;
    if (typeof deposit === 'number') setupCostPerStore.deposit = deposit;
    if (typeof inventory === 'number') setupCostPerStore.inventory = inventory;

    const costOverrides = {
      ...(Object.keys(setupCostPerStore).length > 0 ? { setupCostPerStore } : {}),
      ...(typeof cogsPct === 'number' ? { cogsPct } : {}),
      ...(typeof commissionPct === 'number' ? { commissionPct } : {}),
      ...(typeof monthlyRentPerStore === 'number' ? { monthlyRentPerStore } : {}),
      ...(typeof monthlyUtilitiesPerStore === 'number' ? { monthlyUtilitiesPerStore } : {}),
      ...(typeof monthlyStaffCostPerStore === 'number' ? { monthlyStaffCostPerStore } : {}),
      ...(currency ? { currency } : {}),
      ...(locale ? { locale } : {}),
    };

    const plan = await expansionService.runExpansionPlan(db, {
      tenantId: req.tenantId,
      newStores: newStoresRaw,
      scenario,
      repeatRatePctOverride: typeof repeatRatePctOverride === 'number' ? repeatRatePctOverride : undefined,
      costOverrides,
    });

    return plan;
  });
}
