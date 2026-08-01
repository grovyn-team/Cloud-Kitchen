/**
 * Phase 6 — Tax (GST) module routes:
 *   - GET /api/v1/tax/summary?branchId=&periodStart=&periodEnd= --
 *     ADMIN-only (enforced at the ROUTER level in `routes/v1/index.js`, same
 *     `requireRole(['ADMIN'])` composition style as `finance/summary` --
 *     this is financial/compliance data, per D-007's CA-in-the-loop
 *     positioning, not a STAFF-facing feature).
 *   - GET /api/v1/tax/export?branchId=&periodStart=&periodEnd=&format=csv --
 *     same ADMIN-only gate; returns a CSV file, not JSON (see `replyRaw` in
 *     `middleware/tenantContext.js`).
 *
 * D-007 (non-optional, `.claude/DECISIONS_LOG.md`): this module prepares/
 * reconciles sale data for the client's CA -- it is NOT an audit, NOT a
 * filing tool, and does NOT generate tax advice. Both endpoints below carry
 * `taxService.CA_REVIEW_DISCLAIMER` in their response (a JSON field on
 * `/summary`, a literal first line of the file on `/export`) -- never build
 * a third response shape for this module without adding it there too.
 *
 * COMPUTE-ON-DEMAND, NOT READ-CACHED (documented choice): both endpoints
 * always recompute the period's GST figures live from `sale`/
 * `sale_line_item` data via `taxService.getOrComputePeriodSummary`, then
 * upsert the result into `tax_period_summary` (idempotent -- the partial
 * unique index means a repeat call updates the same row, never duplicates
 * it). This guarantees the number a CA sees is always current with the
 * latest recorded sales (e.g. a sale entered five minutes ago is reflected
 * immediately), never a stale cached figure from before a correction/import
 * -- at the cost of a live aggregation query on every request, which is
 * acceptable for an ADMIN-only, period-scoped report (not a high-QPS path).
 *
 * Thin: validate input shape, verify (not just trust) a client-supplied
 * `branchId`, call `taxService.js`, shape the response via `reply()`/
 * `replyRaw()` -- same `withTenantContext(pool)(async (req, db) => ...)`
 * composition pattern as every other real module in this codebase.
 */

import { withTenantContext, reply, replyRaw } from '../middleware/tenantContext.js';
import { isBranchAllowed } from '../middleware/sessionAuth.js';
import { isValidUuid, isValidDateString } from '../utils/validation.js';
import { branchExistsInTenant } from '../services/branchAccessService.js';
import { eq } from 'drizzle-orm';
import { schema } from '../db/dal.js';
import * as taxService from '../services/taxService.js';
import { setEffectiveGstRate, NonMonotonicGstRateError } from '../services/gstRateService.js';

const EXPORT_FORMATS = ['csv'];
const MAX_RATE_PERCENT = 100;

function badRequest(message, details) {
  return reply(400, { error: 'BadRequest', message, ...(details ? { details } : {}) });
}

function forbidden() {
  return reply(403, { error: 'Forbidden', message: 'Access to this branch is not permitted.' });
}

/**
 * Shared query-parsing + branch-ownership verification for both endpoints
 * below. Returns either `{ ok: true, branchId, periodStart, periodEnd }` or
 * `{ ok: false, errorReply }` (already-shaped via `badRequest`/`forbidden`,
 * so callers just `return` it).
 * @param {import('express').Request} req
 * @param {*} db
 */
async function parseAndAuthorize(req, db) {
  const query = req.query || {};

  const branchId = typeof query.branchId === 'string' ? query.branchId.trim() : '';
  if (!branchId || !isValidUuid(branchId)) {
    return { ok: false, errorReply: badRequest('branchId is required and must be a valid UUID.') };
  }

  const periodStart = typeof query.periodStart === 'string' ? query.periodStart.trim() : '';
  const periodEnd = typeof query.periodEnd === 'string' ? query.periodEnd.trim() : '';
  if (!isValidDateString(periodStart) || !isValidDateString(periodEnd)) {
    return {
      ok: false,
      errorReply: badRequest('periodStart and periodEnd are required and must be YYYY-MM-DD.'),
    };
  }
  if (periodStart > periodEnd) {
    return { ok: false, errorReply: badRequest('periodStart must not be after periodEnd.') };
  }

  // Never trust a client-supplied branchId -- same two-check discipline
  // every other module's handlers use (isBranchAllowed for role/own-branch
  // scope, branchExistsInTenant for the RLS-backed "this real branch id
  // actually belongs to MY tenant" check). This route is ADMIN-only at the
  // router level, so isBranchAllowed always returns true for the caller's
  // role -- called anyway for the same reason `financeManagement.js` calls
  // it: `branchExistsInTenant` is the check that actually matters here.
  if (!isBranchAllowed(req, branchId)) {
    return { ok: false, errorReply: forbidden() };
  }
  if (!(await branchExistsInTenant(db, branchId))) {
    return { ok: false, errorReply: forbidden() };
  }

  return { ok: true, branchId, periodStart, periodEnd };
}

/**
 * GET /api/v1/tax/summary?branchId=&periodStart=&periodEnd=
 * @param {import('pg').Pool} pool
 */
export function getSummary(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const parsed = await parseAndAuthorize(req, db);
    if (!parsed.ok) return parsed.errorReply;
    const { branchId, periodStart, periodEnd } = parsed;

    const rows = await taxService.getOrComputePeriodSummary(db, {
      tenantId: req.tenantId,
      branchId,
      periodStart,
      periodEnd,
    });

    return taxService.serializeSummary(rows, { branchId, periodStart, periodEnd });
  });
}

/**
 * GET /api/v1/tax/export?branchId=&periodStart=&periodEnd=&format=csv
 * @param {import('pg').Pool} pool
 */
export function getExport(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const parsed = await parseAndAuthorize(req, db);
    if (!parsed.ok) return parsed.errorReply;
    const { branchId, periodStart, periodEnd } = parsed;

    const query = req.query || {};
    const format = typeof query.format === 'string' && query.format.trim() ? query.format.trim().toLowerCase() : 'csv';
    if (!EXPORT_FORMATS.includes(format)) {
      return badRequest(`format must be one of: ${EXPORT_FORMATS.join(', ')}.`);
    }

    const rows = await taxService.getOrComputePeriodSummary(db, {
      tenantId: req.tenantId,
      branchId,
      periodStart,
      periodEnd,
    });

    const [branch] = await db
      .select({ name: schema.branch.name })
      .from(schema.branch)
      .where(eq(schema.branch.id, branchId))
      .limit(1);

    const csv = taxService.buildCsvExport({
      branchId,
      branchName: branch?.name ?? '',
      periodStart,
      periodEnd,
      rows,
    });

    const filename = `gst-summary_${branchId}_${periodStart}_to_${periodEnd}.csv`;
    return replyRaw(200, csv, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
  });
}

/**
 * POST /api/v1/tax/rates — Integration Task 2, round 3: the missing piece
 * that makes the effective-dated GST model (round 2) reachable by a user at
 * all. Body: `{ ratePercent, effectiveFrom }`. Closes whichever rate is
 * currently open for this tenant at `effectiveFrom` and opens the new one --
 * `gstRateService.setEffectiveGstRate` does the actual work (including the
 * advisory-lock serialization against a concurrent call for the same
 * tenant); this route only validates input shape.
 * @param {import('pg').Pool} pool
 */
export function createRate(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const body = req.body || {};

    const ratePercent = Number(body.ratePercent);
    if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > MAX_RATE_PERCENT) {
      return badRequest(`ratePercent is required and must be between 0 and ${MAX_RATE_PERCENT}.`);
    }

    const effectiveFrom = typeof body.effectiveFrom === 'string' ? body.effectiveFrom.trim() : '';
    if (!isValidDateString(effectiveFrom)) {
      return badRequest('effectiveFrom is required and must be YYYY-MM-DD.');
    }

    let created;
    try {
      created = await setEffectiveGstRate(db, { tenantId: req.tenantId, ratePercent, effectiveFrom });
    } catch (err) {
      if (err instanceof NonMonotonicGstRateError) {
        return badRequest(err.message);
      }
      throw err;
    }

    return reply(201, {
      id: created.id,
      ratePercent: created.ratePercent,
      effectiveFrom: created.effectiveFrom,
      effectiveTo: created.effectiveTo,
    });
  });
}
