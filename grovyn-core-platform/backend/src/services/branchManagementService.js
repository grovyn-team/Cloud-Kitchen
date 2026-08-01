/**
 * P1-06 backend — real, DB-backed Branch management module business logic:
 * ADMIN-only create/edit/soft-delete, ADMIN-or-STAFF branch-scoped list/detail
 * (STAFF sees only branches they hold an active `staff_branch_access` grant
 * for). Copies `customerManagementService.js`'s conventions verbatim
 * (validation shape, `sql`count(*)::int``` totals, explicit `tenantId` on
 * writes even though RLS is the actual scoping control, `isNull(deletedAt)`-
 * filtered reads) — same complexity class (no upload, no money).
 *
 * Every exported function here takes a tenant-scoped `db`
 * (`../db/dal.js`'s `createScopedDb`, always obtained via
 * `withTenantContext(pool)` in `../routes/branches.js`) -- there is no code
 * path in this module that runs a query without RLS already active on the
 * connection.
 */

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema } from '../db/dal.js';
import { sanitizeCsvCell } from './csvSanitize.js';

const MAX_NAME_LENGTH = 200;
const MAX_SHORT_FIELD_LENGTH = 200;

function normalizeOptionalString(value, { maxLength } = {}) {
  if (value === undefined) return { present: false };
  if (value === null) return { present: true, value: null };
  if (typeof value !== 'string') return { present: true, invalid: true };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { present: true, value: null };
  if (maxLength && trimmed.length > maxLength) return { present: true, invalid: true, tooLong: true };
  return { present: true, value: trimmed };
}

const OPTIONAL_TEXT_FIELDS = ['address', 'city', 'state', 'postalCode', 'phone', 'openingHours', 'timezone'];

/**
 * Validate + normalize a `POST /api/v1/branches` request body.
 * @returns {{ok:true, value:object}|{ok:false, errors:string[]}}
 */
export function validateCreateBranchInput(body) {
  const errors = [];
  const b = body && typeof body === 'object' ? body : {};

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) errors.push('name is required.');
  else if (name.length > MAX_NAME_LENGTH) errors.push(`name must be at most ${MAX_NAME_LENGTH} characters.`);

  const value = { name: sanitizeCsvCell(name) };
  for (const field of OPTIONAL_TEXT_FIELDS) {
    const norm = normalizeOptionalString(b[field], { maxLength: MAX_SHORT_FIELD_LENGTH });
    if (norm.present) {
      if (norm.invalid) {
        errors.push(
          norm.tooLong
            ? `${field}, if provided, must be at most ${MAX_SHORT_FIELD_LENGTH} characters.`
            : `${field}, if provided, must be a string.`
        );
      } else {
        value[field] = norm.value ? sanitizeCsvCell(norm.value) : null;
      }
    } else {
      value[field] = null;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value };
}

/**
 * Validate + normalize a `PATCH /api/v1/branches/:id` request body. Every
 * field is optional, but at least one must be present (same convention as
 * `customerManagementService.validatePatchCustomerInput`).
 * @returns {{ok:true, value:object}|{ok:false, errors:string[]}}
 */
export function validatePatchBranchInput(body) {
  const errors = [];
  const b = body && typeof body === 'object' ? body : {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const changes = {};

  if (has('name')) {
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) errors.push('name, if provided, must be a non-empty string.');
    else if (name.length > MAX_NAME_LENGTH) errors.push(`name must be at most ${MAX_NAME_LENGTH} characters.`);
    else changes.name = sanitizeCsvCell(name);
  }

  for (const field of OPTIONAL_TEXT_FIELDS) {
    if (has(field)) {
      const norm = normalizeOptionalString(b[field], { maxLength: MAX_SHORT_FIELD_LENGTH });
      if (norm.invalid) {
        errors.push(
          norm.tooLong
            ? `${field}, if provided, must be at most ${MAX_SHORT_FIELD_LENGTH} characters.`
            : `${field}, if provided, must be a string or null.`
        );
      } else {
        changes[field] = norm.value ? sanitizeCsvCell(norm.value) : null;
      }
    }
  }

  if (Object.keys(changes).length === 0) {
    errors.push('At least one field (name/address/city/state/postalCode/phone/openingHours/timezone) is required.');
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { changes } };
}

/**
 * Insert one `branch` row in the CURRENT request transaction --
 * `withTenantContext(pool)` already wraps the whole handler in
 * BEGIN...COMMIT, same reasoning as every other create in this codebase.
 */
export async function createBranch(db, { tenantId, ...fields }) {
  const [branch] = await db.insert(schema.branch).values({ tenantId, ...fields }).returning();
  return branch;
}

/**
 * RLS-scoped lookup (a cross-tenant id already returns null) -- excludes
 * soft-deleted rows, same `isNull(deletedAt)` convention as every other
 * module's `getXById`.
 */
export async function getBranchById(db, { id }) {
  const [branch] = await db
    .select()
    .from(schema.branch)
    .where(and(eq(schema.branch.id, id), isNull(schema.branch.deletedAt)))
    .limit(1);
  return branch || null;
}

export async function updateBranch(db, { branch, changes }) {
  const [updated] = await db
    .update(schema.branch)
    .set({ ...changes, updatedAt: new Date() })
    .where(and(eq(schema.branch.id, branch.id), isNull(schema.branch.deletedAt)))
    .returning();
  return updated;
}

/**
 * Soft-delete only (`deleted_at` = now) -- never a hard DELETE, matches every
 * other table's D-008 pattern. A tombstoned branch stays FK-valid for
 * historical sales/inventory/customer rows that reference it (schema.js's own
 * doc comment on `branch`). Caller (`routes/branches.js`) is responsible for
 * also calling `revokeAllBranchAccessForBranch` in the SAME request
 * transaction, mirroring `staffManagementService`'s deactivation cascade.
 */
export async function softDeleteBranch(db, { id }) {
  const [deleted] = await db
    .update(schema.branch)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.branch.id, id), isNull(schema.branch.deletedAt)))
    .returning();
  return deleted || null;
}

/**
 * Soft-revoke EVERY active `staff_branch_access` grant for a branch --
 * closing a branch closes out every staff member's access to it, not just
 * leaving stale active grants pointing at a deleted branch. Same shape as
 * `staffManagementService.revokeAllBranchAccessForUser`, keyed by branch
 * instead of user.
 */
export async function revokeAllBranchAccessForBranch(db, { branchId }) {
  return db
    .update(schema.staffBranchAccess)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.staffBranchAccess.branchId, branchId), isNull(schema.staffBranchAccess.revokedAt)))
    .returning();
}

/**
 * Branch list, paginated. `staffBranchIds` is `null` for ADMIN (sees every
 * branch in the tenant) or an array for STAFF (restricted to their active
 * grants, same split as `customerManagementService.listCustomers`). An empty
 * array short-circuits to an empty page without a query, same as elsewhere.
 */
export async function listBranches(db, { staffBranchIds, page, pageSize }) {
  const conditions = [isNull(schema.branch.deletedAt)];
  if (Array.isArray(staffBranchIds)) {
    if (staffBranchIds.length === 0) {
      return { data: [], meta: { page, pageSize, total: 0 } };
    }
    conditions.push(inArray(schema.branch.id, staffBranchIds));
  }

  const whereExpr = and(...conditions);

  const [{ count }] = await db.select({ count: sql`count(*)::int` }).from(schema.branch).where(whereExpr);

  const rows = await db
    .select()
    .from(schema.branch)
    .where(whereExpr)
    .orderBy(desc(schema.branch.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { data: rows.map(serializeBranch), meta: { page, pageSize, total: count } };
}

export function serializeBranch(branch) {
  return {
    id: branch.id,
    name: branch.name,
    address: branch.address ?? null,
    city: branch.city ?? null,
    state: branch.state ?? null,
    postalCode: branch.postalCode ?? null,
    phone: branch.phone ?? null,
    openingHours: branch.openingHours ?? null,
    timezone: branch.timezone ?? null,
    createdAt: branch.createdAt,
    updatedAt: branch.updatedAt,
  };
}
