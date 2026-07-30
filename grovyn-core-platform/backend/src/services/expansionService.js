/**
 * P35-01/P35-02 (Backend, 2026-07-30) — real, DB-backed composition layer
 * feeding the deterministic Expansion Planner (`expansionPlanner.js`) with
 * this tenant's actual data, replacing the legacy in-memory mock inputs
 * (`storeService.getAllStores()`/`metricsEngine.getFullMetrics()`/
 * `alertOrchestratorService.getActiveAlerts()`) that
 * `routes/intelligence.js`'s OLD `GET /api/v1/expansion/simulate` still uses
 * (untouched — that route/its legacy HMAC auth stays exactly as it was, out
 * of this task's scope; this is a NEW endpoint, not a rewrite of that one).
 *
 * Same role split as `dashboardService.js`: this is a THIN composition layer
 * over already-tenant-scoped domain services (`saleService`,
 * `financeManagementService`, `notificationService`) plus one direct branch
 * count query — it does not duplicate any of their SQL, and the actual
 * planning math stays 100% inside `expansionPlanner.js` (pure, deterministic,
 * no DB access, no AI/HF calls — unchanged by this task except for the
 * cost-assumption parameterization P35-02 asked for).
 *
 * Every exported function here takes a tenant-scoped `db`
 * (`../db/dal.js`'s `createScopedDb`, always obtained via
 * `withTenantContext(pool)` in `../routes/expansion.js`) — there is no code
 * path in this module that runs a query without RLS already active on the
 * connection, same contract as every other service in this codebase.
 *
 * REAL-DATA MAPPING (documented here since the pure engine's input shape —
 * `stores`/`metrics`/`alerts` — was designed against the old mock services,
 * not this schema; changing that input SHAPE would touch
 * `expansionPlanner.js`'s already-reviewed pure functions more than
 * necessary, so this module instead builds real-data-driven values into the
 * exact shapes those functions already expect):
 *   - `stores` -> `Array.from({ length: activeBranchCount })`. Only
 *     `.length` is ever read by `calculateReadinessScore`/`rankLocations`
 *     (verified by reading `expansionPlanner.js` in full before writing
 *     this) — never individual store fields — so a length-only array is a
 *     faithful, not a lossy, substitute for the old mock store list.
 *   - `metrics.last7.netMarginPct` -> this tenant's real gross-margin
 *     estimate for the current month (`financeManagementService
 *     .getFinanceSummary`'s `grossMarginEstimate/revenue`), which is itself
 *     already a PARTIAL/best-effort figure (see that service's own doc
 *     comment — not every sale line links to a costed inventory item). This
 *     module propagates that same `isPartial` flag in its response rather
 *     than silently laundering an approximate number into an exact-looking
 *     one.
 *   - `metrics.last14.repeatRate` -> **NOT derivable from the current
 *     schema**. `sale` carries no `customer_id` (verified — `schema.js`'s
 *     `sale` table has no such column), so a real per-customer repeat-order
 *     rate cannot be computed from data that exists today. Rather than
 *     inventing a proxy computation that would look precise but isn't real,
 *     this is exposed as an explicit, tenant-configurable input
 *     (`repeatRatePct`, in `tenant.settings.expansion` or a request
 *     override) with a conservative documented default — flagged via
 *     `dataSource.repeatRatePct.isAssumed: true` in the response rather than
 *     presented as measured (O4 "Trust it": an honest "we don't know this
 *     yet" beats a fabricated-looking number). Schema is DBA's call, not
 *     invented here — flagged as a real forward gap, not silently patched.
 *   - `alerts` (only `.filter(a => a.severity === 'critical').length` is
 *     read) -> this tenant's real unresolved `notification` count
 *     (`notificationService.getUnresolvedCount`) used as a same-shape
 *     proxy, since the `notification` table has no severity tiers (verified
 *     — `schema.js`'s `notification` table has `type`/`status`, no
 *     `severity` column) to distinguish "critical" from routine. Documented
 *     as a proxy, not a fabricated precision claim, same posture as
 *     `repeatRatePct` above.
 */

import { eq, isNull, sql } from 'drizzle-orm';
import { schema } from '../db/dal.js';
import * as saleService from './saleService.js';
import * as financeManagementService from './financeManagementService.js';
import * as notificationService from './notificationService.js';
import * as expansionPlanner from './expansionPlanner.js';

// Documented default for the one input this schema genuinely cannot supply
// yet (see module doc above) — deliberately conservative (below the engine's
// own 25% "Retention: pass" threshold) rather than optimistic, so an unknown
// repeat rate does not silently make a tenant look scale-ready.
export const DEFAULT_ASSUMED_REPEAT_RATE_PCT = 20;

/**
 * @param {import('../db/dal.js').createScopedDb extends (c: any) => infer T ? T : never} db
 */
async function getActiveBranchCount(db) {
  const [row] = await db
    .select({ count: sql`count(*)::int` })
    .from(schema.branch)
    .where(isNull(schema.branch.deletedAt));
  return Number(row?.count) || 0;
}

/**
 * Reads THIS tenant's own `settings.expansion` object (RLS confines the
 * lookup to the caller's own tenant row regardless — `tenantId` is passed
 * only to select the single row, not to widen/narrow access). Returns `{}`
 * if unset (a tenant that has never configured overrides is a normal,
 * expected state — matches every other nullable-settings pattern in this
 * codebase, e.g. `branch`'s optional detail fields).
 */
async function getTenantExpansionSettings(db, tenantId) {
  const [row] = await db.select({ settings: schema.tenant.settings }).from(schema.tenant).where(eq(schema.tenant.id, tenantId)).limit(1);
  const settings = row?.settings && typeof row.settings === 'object' ? row.settings : {};
  return settings.expansion && typeof settings.expansion === 'object' ? settings.expansion : {};
}

/**
 * Assembles the real-data inputs the pure engine needs, PLUS the resolved
 * cost assumptions (request override > tenant.settings.expansion > engine
 * defaults — the same precedence order documented on `routes/expansion.js`).
 * Does not itself call `expansionPlanner`'s scoring/projection functions —
 * kept as a pure "gather" step so `runExpansionPlan` (below) stays the one
 * place that composes gathering + the pure engine, mirroring
 * `dashboardService.getSummaryData`'s split between fetch and shape.
 */
export async function gatherRealInputs(db, { tenantId, repeatRatePctOverride, costOverrides }) {
  const [activeBranchCount, monthSummary, financeSummary, unresolvedNotificationCount, tenantExpansionSettings] =
    await Promise.all([
      getActiveBranchCount(db),
      saleService.getCurrentPeriodSummary(db, { period: 'month', branchId: null, restrictBranchIds: null }),
      financeManagementService.getFinanceSummary(db, { period: 'month', branchId: null }),
      notificationService.getUnresolvedCount(db, { branchId: null, staffBranchIds: null }),
      getTenantExpansionSettings(db, tenantId),
    ]);

  // avgMonthlyRevenuePerStore: real current-month-to-date tenant revenue,
  // spread across active branches. Falls back to the engine's own long-
  // standing default (450000) when there is no real basis yet (zero active
  // branches, or zero revenue recorded so far this month) rather than
  // dividing by zero or reporting a false ₹0.
  const avgMonthlyRevenuePerStore =
    activeBranchCount > 0 && monthSummary.revenue > 0 ? monthSummary.revenue / activeBranchCount : 450000;

  // avgMarginPct: real gross-margin estimate for the tenant this month. Falls
  // back to the engine's own long-standing default (12) only when there is
  // no revenue yet to compute a margin from at all.
  const avgMarginPct =
    financeSummary.revenue > 0 ? (financeSummary.grossMarginEstimate / financeSummary.revenue) * 100 : 12;

  const repeatRatePct =
    typeof repeatRatePctOverride === 'number' ? repeatRatePctOverride : tenantExpansionSettings.repeatRatePct ?? DEFAULT_ASSUMED_REPEAT_RATE_PCT;

  const mergedOverrides = { ...tenantExpansionSettings, ...(costOverrides || {}) };
  const costAssumptions = expansionPlanner.resolveCostAssumptions(mergedOverrides);

  return {
    activeBranchCount,
    avgMonthlyRevenuePerStore,
    avgMarginPct,
    avgMarginIsPartial: financeSummary.cogs.isPartial,
    unresolvedNotificationCount,
    repeatRatePct,
    repeatRatePctIsAssumed: typeof repeatRatePctOverride !== 'number' && tenantExpansionSettings.repeatRatePct === undefined,
    costAssumptions,
  };
}

/**
 * Full expansion plan on REAL tenant data — same overall shape/fields the
 * legacy mock-backed `routes/intelligence.js#getExpansionSimulate` returns
 * (`currentStores`, `readiness`, `topLocations`, `scenarios`,
 * `selectedScenario.{...,financials,grovynImpact,risks}`), PLUS an additive
 * `dataSource` block (new, does not remove/rename anything) that surfaces
 * which figures are real-measured vs. caller/tenant-assumed — an O4
 * "Trust it" transparency addition, not a redesign of the engine's existing
 * output.
 */
export async function runExpansionPlan(db, { tenantId, newStores, scenario, repeatRatePctOverride, costOverrides }) {
  const inputs = await gatherRealInputs(db, { tenantId, repeatRatePctOverride, costOverrides });

  // Same shim shapes `expansionPlanner.js`'s pure functions were always
  // built against (see module doc above for why these are faithful, not
  // lossy, substitutes for the old mock `stores`/`metrics`/`alerts`).
  const stores = Array.from({ length: inputs.activeBranchCount });
  const metrics = {
    last7: { netMarginPct: inputs.avgMarginPct },
    last14: { repeatRate: inputs.repeatRatePct },
  };
  const alerts = Array.from({ length: inputs.unresolvedNotificationCount }, () => ({ severity: 'critical' }));

  const readiness = expansionPlanner.calculateReadinessScore(stores, metrics, alerts);
  const rankedLocations = expansionPlanner.rankLocations(inputs.activeBranchCount, expansionPlanner.expansionLocations);
  const scenarios = expansionPlanner.generateScenarios(rankedLocations);

  const selectedScenarioKey = scenario in scenarios ? scenario : 'moderate';
  const selectedScenario = scenarios[selectedScenarioKey];
  const customCount = Math.max(1, Math.min(10, Number(newStores) || 0));
  const useCustom = newStores !== undefined && newStores !== null && newStores !== '' && customCount >= 1;
  const scenarioToUse = useCustom
    ? {
        name: 'Custom',
        newStores: customCount,
        timeline: Math.min(12, customCount * 3),
        locations: rankedLocations.slice(0, customCount),
        description: 'Custom store count',
      }
    : selectedScenario;

  const financials = expansionPlanner.projectFinancials(
    scenarioToUse.newStores,
    { avgMonthlyRevenue: inputs.avgMonthlyRevenuePerStore },
    scenarioToUse.locations,
    inputs.costAssumptions
  );

  const grovynImpact = expansionPlanner.calculateGrovynImpact(
    scenarioToUse.newStores,
    financials.year1Revenue,
    inputs.costAssumptions
  );

  const risks = expansionPlanner.assessRisks(scenarioToUse.newStores, scenarioToUse.locations, {
    avgMargin: inputs.avgMarginPct,
  });

  return {
    currentStores: inputs.activeBranchCount,
    readiness,
    topLocations: rankedLocations.slice(0, 10),
    scenarios,
    selectedScenario: {
      ...scenarioToUse,
      financials,
      grovynImpact,
      risks,
    },
    costAssumptions: inputs.costAssumptions,
    dataSource: {
      avgMonthlyRevenuePerStore: inputs.avgMonthlyRevenuePerStore,
      avgMarginPct: Number(inputs.avgMarginPct.toFixed(2)),
      avgMarginIsPartial: inputs.avgMarginIsPartial,
      unresolvedNotificationCount: inputs.unresolvedNotificationCount,
      repeatRatePct: inputs.repeatRatePct,
      repeatRatePctIsAssumed: inputs.repeatRatePctIsAssumed,
    },
  };
}
