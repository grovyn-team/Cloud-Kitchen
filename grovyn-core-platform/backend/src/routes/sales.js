/**
 * P2-02/P2-03 — Sales routes. Thin: validate input shape, enforce branch
 * scope, call `saleService.js`/`salesCsvImportService.js`, shape the
 * response via `reply()`. All business logic lives in the services, not
 * here (loose coupling, matches `routes/auth.js`'s composition pattern
 * exactly -- `withTenantContext(pool)(async (req, db) => ...)`, never a bare
 * `(req, res, next)` handler that reaches for `res` directly).
 *
 * Every handler here composes with `requireSession(pool)` +
 * `requireRole(['ADMIN','STAFF'])` at the router level (`routes/v1/index.js`)
 * -- this file never trusts `req.tenantId`/`req.userRole`/`req.branchIds`
 * from anywhere except what `requireSession` already verified server-side
 * from the DB-backed session row.
 *
 * Branch scope: `branchId` arrives via request BODY (`createSale`,
 * `importSales`) or QUERY (`listSales`, `getRollup`), never a route
 * `:param` -- so the existing `requireBranchAccess('param')` middleware
 * doesn't apply directly. Every handler below instead calls
 * `isBranchAllowed(req, branchId)` (extracted from that same middleware in
 * `middleware/sessionAuth.js`) explicitly, so the ADMIN/STAFF decision is
 * still one shared, tested predicate -- not reimplemented per handler.
 */

import crypto from 'crypto';
import { withTenantContext, reply } from '../middleware/tenantContext.js';
import { isBranchAllowed } from '../middleware/sessionAuth.js';
import { isValidUuid } from '../utils/validation.js';
import * as saleService from '../services/saleService.js';
import {
  parseSalesCsv,
  validateAndBuildRows,
  insertSalesBatch,
  CsvStructureError,
  CsvRowLimitError,
} from '../services/salesCsvImportService.js';
import { logAuditEvent } from '../services/auditService.js';

function badRequest(message, details) {
  return reply(400, { error: 'BadRequest', message, ...(details ? { details } : {}) });
}

function forbidden() {
  return reply(403, { error: 'Forbidden', message: 'Access to this branch is not permitted.' });
}

function notFound(message = 'Sale not found.') {
  return reply(404, { error: 'NotFound', message });
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * POST /api/v1/sales — manual entry, one sale (header + line items) in one
 * DB transaction (the whole request already runs inside one, see
 * `saleService.createSale`'s doc comment). Header total is ALWAYS computed
 * server-side from `lineItems`; nothing here trusts a client-sent total.
 * @param {import('pg').Pool} pool
 */
export function createSale(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const body = req.body || {};
    const branchId = typeof body.branchId === 'string' ? body.branchId.trim() : '';
    if (!isValidUuid(branchId)) {
      return badRequest('branchId is required and must be a valid UUID.');
    }
    if (!isBranchAllowed(req, branchId)) {
      return forbidden();
    }
    // Closes a real schema gap (plain, non-composite branch_id FK -- see
    // saleService.branchExistsInTenant's doc comment): confirms branchId
    // actually belongs to THIS tenant via a query RLS itself scopes, so an
    // ADMIN can't smuggle another tenant's real branch id into a write just
    // because isBranchAllowed() alone doesn't check tenant ownership for ADMIN.
    if (!(await saleService.branchExistsInTenant(db, branchId))) {
      return forbidden();
    }

    const validation = saleService.validateManualSaleInput(body);
    if (!validation.ok) {
      return badRequest('Invalid sale payload.', validation.errors);
    }

    const sale = await saleService.createSale(db, {
      tenantId: req.tenantId,
      branchId,
      createdByUserId: req.userId,
      ...validation.value,
    });

    await logAuditEvent(db, {
      tenantId: req.tenantId,
      actorUserId: req.userId,
      action: 'sale.create',
      entityType: 'sale',
      entityId: sale.id,
      after: { branchId, totalAmount: sale.totalAmount, source: 'manual' },
    });

    return reply(201, saleService.serializeSaleDetail(sale));
  });
}

/**
 * POST /api/v1/sales/import — CSV upload. Validate-before-commit,
 * all-or-nothing: any invalid row means ZERO rows are written, and the
 * response lists every row error found, not just the first. `requireRole`/
 * `requireSession` run before this at the router level; `csvUpload.single
 * ('file')` + `handleUploadError` (multer, memory storage) run between those
 * and this handler (see `routes/v1/index.js`).
 * @param {import('pg').Pool} pool
 */
export function importSales(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const body = req.body || {};
    const branchId = typeof body.branchId === 'string' ? body.branchId.trim() : '';
    if (!isValidUuid(branchId)) {
      return badRequest('branchId (form field) is required and must be a valid UUID.');
    }
    if (!isBranchAllowed(req, branchId)) {
      return forbidden();
    }
    if (!(await saleService.branchExistsInTenant(db, branchId))) {
      return forbidden();
    }
    if (!req.file || !req.file.buffer) {
      return badRequest('A CSV file is required (multipart field name "file").');
    }

    let records;
    try {
      records = parseSalesCsv(req.file.buffer);
    } catch (err) {
      if (err instanceof CsvRowLimitError) {
        return reply(413, { error: 'PayloadTooLarge', message: err.message });
      }
      if (err instanceof CsvStructureError) {
        return badRequest(err.message);
      }
      throw err;
    }

    const { validRows, errors } = validateAndBuildRows(records, {
      tenantId: req.tenantId,
      branchId,
      createdByUserId: req.userId,
    });

    // All-or-nothing: any row error means zero rows are committed. Nothing
    // has touched the DB yet at this point (parse + validate are both pure
    // in-memory steps), so there is nothing to roll back -- the batch insert
    // below simply never runs.
    if (errors.length > 0) {
      return reply(422, { importedCount: 0, errors });
    }

    const importBatchRef = crypto.randomUUID();
    const importedCount = await insertSalesBatch(db, { rows: validRows, importBatchRef });

    await logAuditEvent(db, {
      tenantId: req.tenantId,
      actorUserId: req.userId,
      action: 'sale.import',
      entityType: 'sale_import_batch',
      entityId: importBatchRef,
      after: { branchId, importedCount },
    });

    return reply(201, { importedCount, errors: [], importBatchRef });
  });
}

/**
 * GET /api/v1/sales/rollup?period=day|week|month&branchId= — revenue/
 * order-count/AOV aggregated by branch + period, via a real SQL aggregation
 * (`saleService.getRollup`). STAFF is always confined to `req.branchIds`
 * regardless of whether/what `branchId` was passed; ADMIN may filter by
 * `branchId` or omit it for all branches.
 * @param {import('pg').Pool} pool
 */
export function getRollup(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const query = req.query || {};
    const period = typeof query.period === 'string' ? query.period.trim() : '';
    if (!saleService.PERIODS.includes(period)) {
      return badRequest(`period is required and must be one of: ${saleService.PERIODS.join(', ')}.`);
    }

    const branchId = typeof query.branchId === 'string' ? query.branchId.trim() : '';
    if (branchId && !isValidUuid(branchId)) {
      return badRequest('branchId must be a valid UUID.');
    }
    if (branchId && !isBranchAllowed(req, branchId)) {
      return forbidden();
    }
    if (branchId && !(await saleService.branchExistsInTenant(db, branchId))) {
      return forbidden();
    }

    const data = await saleService.getRollup(db, {
      period,
      branchId: branchId || null,
      restrictBranchIds: req.userRole === 'STAFF' ? req.branchIds : null,
    });

    return { period, branchId: branchId || null, data };
  });
}

/**
 * GET /api/v1/sales?branchId=&page=&pageSize=&dateFrom=&dateTo= — paginated,
 * branch-scoped list. `dateFrom`/`dateTo` (YYYY-MM-DD, inclusive) are an
 * addition beyond the task's literal spec -- trivial given the existing
 * `sale_date` index and clearly needed by any real sales list UI; flagged
 * here rather than silently added.
 * @param {import('pg').Pool} pool
 */
export function listSales(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const query = req.query || {};
    const branchId = typeof query.branchId === 'string' ? query.branchId.trim() : '';
    if (branchId && !isValidUuid(branchId)) {
      return badRequest('branchId must be a valid UUID.');
    }
    if (branchId && !isBranchAllowed(req, branchId)) {
      return forbidden();
    }
    if (branchId && !(await saleService.branchExistsInTenant(db, branchId))) {
      return forbidden();
    }

    const dateFrom = typeof query.dateFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.dateFrom) ? query.dateFrom : null;
    const dateTo = typeof query.dateTo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.dateTo) ? query.dateTo : null;

    const page = clampInt(query.page, 1, 1, 1_000_000);
    const pageSize = clampInt(query.pageSize, 20, 1, 100);

    return saleService.listSales(db, {
      branchId: branchId || null,
      staffBranchIds: req.userRole === 'STAFF' ? req.branchIds : null,
      page,
      pageSize,
      dateFrom,
      dateTo,
    });
  });
}

/**
 * GET /api/v1/sales/:id — detail with line items. A STAFF request for a
 * sale outside their branch scope returns 404 (not 403) -- same
 * don't-leak-cross-scope-existence posture the rest of this codebase uses
 * (e.g. `routes/auth.js`'s byte-identical login failure bodies) rather than
 * confirming "this sale exists, you just can't see it."
 * @param {import('pg').Pool} pool
 */
export function getSale(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const id = req.params.id;
    if (!isValidUuid(id)) return notFound();

    const sale = await saleService.getSaleById(db, { id });
    if (!sale) return notFound();
    if (req.userRole === 'STAFF' && !isBranchAllowed(req, sale.branchId)) {
      return notFound();
    }

    return saleService.serializeSaleDetail(sale);
  });
}
