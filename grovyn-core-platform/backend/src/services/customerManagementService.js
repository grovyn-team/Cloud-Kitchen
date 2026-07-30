/**
 * P3 backend (2026-07-30) — real, DB-backed Customers module business logic:
 * manual create/edit, soft-delete (also the D-008-amendment erasure path —
 * see `schema.js`'s `customer` table doc + `.claude/DECISIONS_LOG.md`'s
 * "D-008 — Resolution: customer PII erasure mechanism" entry, 2026-07-29:
 * backup-expiry, not crypto-shred; ordinary `deleted_at` soft-delete is the
 * whole mechanism, no new column), and branch-scoped list/detail.
 *
 * NAMING NOTE: deliberately NOT named `customerService.js` -- that name is
 * already taken by the pre-existing in-memory/mock module
 * (`./customerService.js`, consumed by `routes/v1/customers.js`'s legacy
 * `GET /api/v1/customers/segments`-adjacent seed-data endpoint via
 * `services/index.js`). That module is untouched by this task -- this is a
 * new, separate, real-Postgres-backed module, same relationship
 * `inventoryManagementService.js` has to the legacy `inventoryService.js`
 * (see that file's own naming-note doc comment for the identical precedent).
 *
 * Every exported function here takes a tenant-scoped `db`
 * (`../db/dal.js`'s `createScopedDb`, always obtained via
 * `withTenantContext(pool)` in `../routes/customers.js`) -- there is no code
 * path in this module that runs a query without RLS already active on the
 * connection. `tenantId` is still passed explicitly on writes because RLS's
 * `WITH CHECK` validates the column against the session GUC, it does not
 * populate it (same reasoning as `auditService.js`/`saleService.js`/
 * `inventoryManagementService.js`).
 *
 * `name`/`phone`/`email` are customer PII (schema.js's own doc comment flags
 * this explicitly) -- this module writes them as ordinary columns with no
 * extra encryption/masking layer, per the resolved D-008 decision above.
 */

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema } from '../db/dal.js';
import { sanitizeCsvCell } from './csvSanitize.js';

// 1-5 star-style rating per `schema.js`'s `customer.rating` doc comment.
const MIN_RATING = 1;
const MAX_RATING = 5;
// Sane upper bound so a client can't send a novel-length notes field into an
// unbounded text column. No stated requirement drove this exact number --
// same kind of judgment call `saleService.MAX_MANUAL_LINE_ITEMS` documents.
const MAX_NOTES_LENGTH = 5000;

function normalizeOptionalString(value, { maxLength } = {}) {
  if (value === undefined) return { present: false };
  if (value === null) return { present: true, value: null };
  if (typeof value !== 'string') return { present: true, invalid: true };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { present: true, value: null };
  if (maxLength && trimmed.length > maxLength) return { present: true, invalid: true, tooLong: true };
  return { present: true, value: trimmed };
}

function validateRating(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < MIN_RATING || n > MAX_RATING) return { invalid: true };
  return { value: n };
}

/**
 * Validate + normalize a `POST /api/v1/customers` request body. `branchId`
 * is validated separately by the route (same split every other module in
 * this codebase uses) since branch-scope/tenant-ownership checks need
 * `req`/`db`, not just the body.
 * @returns {{ok:true, value:object}|{ok:false, errors:string[]}}
 */
export function validateCreateCustomerInput(body) {
  const errors = [];
  const b = body && typeof body === 'object' ? body : {};

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) errors.push('name is required.');

  let phone = null;
  const phoneNorm = normalizeOptionalString(b.phone);
  if (phoneNorm.present) {
    if (phoneNorm.invalid) errors.push('phone, if provided, must be a string.');
    else phone = phoneNorm.value;
  }

  let email = null;
  const emailNorm = normalizeOptionalString(b.email);
  if (emailNorm.present) {
    if (emailNorm.invalid) errors.push('email, if provided, must be a string.');
    else email = emailNorm.value;
  }

  let category = null;
  const categoryNorm = normalizeOptionalString(b.category);
  if (categoryNorm.present) {
    if (categoryNorm.invalid) errors.push('category, if provided, must be a string.');
    else category = categoryNorm.value;
  }

  let notes = null;
  const notesNorm = normalizeOptionalString(b.notes, { maxLength: MAX_NOTES_LENGTH });
  if (notesNorm.present) {
    if (notesNorm.invalid) {
      errors.push(
        notesNorm.tooLong
          ? `notes, if provided, must be at most ${MAX_NOTES_LENGTH} characters.`
          : 'notes, if provided, must be a string.'
      );
    } else notes = notesNorm.value;
  }

  let rating = null;
  if (b.rating !== undefined && b.rating !== null && b.rating !== '') {
    const r = validateRating(b.rating);
    if (r.invalid) errors.push(`rating, if provided, must be an integer between ${MIN_RATING} and ${MAX_RATING}.`);
    else rating = r.value;
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name: sanitizeCsvCell(name),
      phone: phone ? sanitizeCsvCell(phone) : null,
      email: email ? sanitizeCsvCell(email) : null,
      category: category ? sanitizeCsvCell(category) : null,
      rating,
      notes: notes ? sanitizeCsvCell(notes) : null,
    },
  };
}

/**
 * Validate + normalize a `PATCH /api/v1/customers/:id` request body. Every
 * field is optional, but at least one must be present -- an empty PATCH is a
 * 400, not a no-op 200 (same convention as
 * `inventoryManagementService.validatePatchItemInput`). `null` is a valid,
 * meaningful value for `phone`/`email`/`category`/`rating`/`notes`
 * (explicitly clearing them) -- uses `hasOwnProperty`-style presence checks
 * rather than truthiness, same reasoning as the Inventory module.
 * @returns {{ok:true, value:object}|{ok:false, errors:string[]}}
 */
export function validatePatchCustomerInput(body) {
  const errors = [];
  const b = body && typeof body === 'object' ? body : {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const changes = {};

  if (has('name')) {
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) errors.push('name, if provided, must be a non-empty string.');
    else changes.name = sanitizeCsvCell(name);
  }

  if (has('phone')) {
    const n = normalizeOptionalString(b.phone);
    if (n.invalid) errors.push('phone, if provided, must be a string or null.');
    else changes.phone = n.value ? sanitizeCsvCell(n.value) : null;
  }

  if (has('email')) {
    const n = normalizeOptionalString(b.email);
    if (n.invalid) errors.push('email, if provided, must be a string or null.');
    else changes.email = n.value ? sanitizeCsvCell(n.value) : null;
  }

  if (has('category')) {
    const n = normalizeOptionalString(b.category);
    if (n.invalid) errors.push('category, if provided, must be a string or null.');
    else changes.category = n.value ? sanitizeCsvCell(n.value) : null;
  }

  if (has('notes')) {
    const n = normalizeOptionalString(b.notes, { maxLength: MAX_NOTES_LENGTH });
    if (n.invalid) {
      errors.push(
        n.tooLong
          ? `notes, if provided, must be at most ${MAX_NOTES_LENGTH} characters.`
          : 'notes, if provided, must be a string or null.'
      );
    } else changes.notes = n.value ? sanitizeCsvCell(n.value) : null;
  }

  if (has('rating')) {
    if (b.rating === null || b.rating === '') {
      changes.rating = null;
    } else {
      const r = validateRating(b.rating);
      if (r.invalid) errors.push(`rating, if provided, must be an integer between ${MIN_RATING} and ${MAX_RATING}, or null.`);
      else changes.rating = r.value;
    }
  }

  if (Object.keys(changes).length === 0) {
    errors.push('At least one field (name/phone/email/category/rating/notes) is required.');
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { changes } };
}

/**
 * Insert one `customer` row in the CURRENT request transaction --
 * `withTenantContext(pool)` already wraps the whole handler in
 * BEGIN...COMMIT, same reasoning as every other create in this codebase.
 */
export async function createCustomer(db, { tenantId, branchId, name, phone, email, category, rating, notes }) {
  const [customer] = await db
    .insert(schema.customer)
    .values({ tenantId, branchId, name, phone, email, category, rating, notes })
    .returning();
  return customer;
}

/**
 * RLS-scoped lookup (a cross-tenant id returns null, never a leak) --
 * excludes soft-deleted rows, same `isNull(deletedAt)` convention as
 * `saleService.getSaleById`/`inventoryManagementService.getItemById`.
 */
export async function getCustomerById(db, { id }) {
  const [customer] = await db
    .select()
    .from(schema.customer)
    .where(and(eq(schema.customer.id, id), isNull(schema.customer.deletedAt)))
    .limit(1);
  return customer || null;
}

/**
 * Apply a PATCH edit to an already-fetched `customer` in the CURRENT request
 * transaction. The route always writes an `audit_log` row around this call
 * (before/after snapshot) -- name/contact changes are worth an audit trail
 * per this task's own instruction, same as Inventory's metadata edits.
 */
export async function updateCustomer(db, { customer, changes }) {
  const [updated] = await db
    .update(schema.customer)
    .set({ ...changes, updatedAt: new Date() })
    .where(and(eq(schema.customer.id, customer.id), isNull(schema.customer.deletedAt)))
    .returning();
  return updated;
}

/**
 * Soft-delete only (`deleted_at` = now) -- never a hard DELETE, matches
 * every other table's D-008 pattern. This is also the customer-erasure-
 * request path per the resolved D-008 amendment: satisfied by this
 * soft-delete plus the deployment's backup-expiry window (a P7-02 deployment
 * config concern, not this function's). Returns the tombstoned row, or
 * `null` if the id didn't resolve to an active row under this tenant (RLS-
 * scoped, so a cross-tenant id and an already-deleted id both return `null`
 * here -- the route's own `loadCustomerOr404` already turns both into an
 * identical 404 before this ever runs).
 */
export async function softDeleteCustomer(db, { id }) {
  const [deleted] = await db
    .update(schema.customer)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.customer.id, id), isNull(schema.customer.deletedAt)))
    .returning();
  return deleted || null;
}

/**
 * Branch-scoped, paginated customer list with an optional `category` exact-
 * match filter (uses the `customer_tenant_branch_category_idx` composite
 * index `schema.js` already ships). `staffBranchIds` restricts the result
 * set for STAFF regardless of whether `branchId` was supplied -- same split
 * as `saleService.listSales`/`inventoryManagementService.listItems`.
 */
export async function listCustomers(db, { branchId, staffBranchIds, category, page, pageSize }) {
  const conditions = [isNull(schema.customer.deletedAt)];
  if (branchId) {
    conditions.push(eq(schema.customer.branchId, branchId));
  } else if (Array.isArray(staffBranchIds)) {
    if (staffBranchIds.length === 0) {
      return { data: [], meta: { page, pageSize, total: 0 } };
    }
    conditions.push(inArray(schema.customer.branchId, staffBranchIds));
  }
  if (category) {
    conditions.push(eq(schema.customer.category, category));
  }

  const whereExpr = and(...conditions);

  const [{ count }] = await db.select({ count: sql`count(*)::int` }).from(schema.customer).where(whereExpr);

  const rows = await db
    .select()
    .from(schema.customer)
    .where(whereExpr)
    .orderBy(desc(schema.customer.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { data: rows.map(serializeCustomer), meta: { page, pageSize, total: count } };
}

export function serializeCustomer(customer) {
  return {
    id: customer.id,
    branchId: customer.branchId,
    name: customer.name,
    phone: customer.phone ?? null,
    email: customer.email ?? null,
    category: customer.category ?? null,
    rating: customer.rating ?? null,
    notes: customer.notes ?? null,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}
