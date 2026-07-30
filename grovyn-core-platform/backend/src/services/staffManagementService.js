/**
 * P3 backend (2026-07-30) — Staff management module business logic:
 * ADMIN-only staff/admin account creation, edit (name/role), deactivation,
 * and branch-access grant/revoke lifecycle. Same layering/complexity as
 * `customerManagementService.js` (no upload, no money) — copied that file's
 * conventions verbatim (validation shape, `sql`count(*)::int``` totals,
 * explicit `tenantId` on writes even though RLS is the actual scoping
 * control, `isNull(deletedAt)`-filtered reads).
 *
 * NOT named `staffService.js` -- that name is already taken by the
 * pre-existing in-memory/mock module (`./staffService.js`, consumed by the
 * legacy `GET /api/v1/staff` / `GET /api/v1/workforce-insights` routes in
 * `routes/staff.js`). This is a new, separate, real-Postgres-backed module,
 * same relationship `customerManagementService.js` has to `customerService.js`
 * (see that file's own naming-note doc comment for the identical precedent).
 *
 * Every exported function here takes a tenant-scoped `db`
 * (`../db/dal.js`'s `createScopedDb`, always obtained via
 * `withTenantContext(pool)` in `../routes/staffManagement.js`) -- there is no
 * code path in this module that runs a query without RLS already active on
 * the connection.
 *
 * Password reset: OUT OF SCOPE for this task. `PATCH` only ever edits
 * `name`/`role` — there is no password-change code path anywhere in this
 * module, and a `password` field in a PATCH body is silently ignored (not
 * validated, not written) rather than erroring, since the route never reads
 * it. A real reset flow (token-based, email delivery) is a separate future
 * task.
 */

import { and, desc, eq, inArray, isNull, isNotNull, sql } from 'drizzle-orm';
import { schema } from '../db/dal.js';

const MIN_PASSWORD_LENGTH = 8;
// Deliberately permissive (not a full RFC 5322 validator) -- same "validate
// by hand, don't pull in a library" convention `utils/validation.js` already
// establishes for UUID/date checks. Only job: reject obvious garbage before
// it reaches the DB's own case-insensitive uniqueness index.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ['ADMIN', 'STAFF'];

/**
 * Validate + normalize a `POST /api/v1/staff/accounts` request body.
 * `branchIds` shape (array of strings) is validated here; whether each id is
 * a real UUID belonging to THIS tenant is the route's job (needs `db`) via
 * `branchAccessService.branchExistsInTenant`, same split every other module
 * in this codebase uses for branch-scope checks.
 * @returns {{ok:true, value:object}|{ok:false, errors:string[]}}
 */
export function validateCreateStaffInput(body) {
  const errors = [];
  const b = body && typeof body === 'object' ? body : {};

  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!email) errors.push('email is required.');
  else if (!EMAIL_RE.test(email)) errors.push('email must be a valid email address.');

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) errors.push('name is required.');

  const password = typeof b.password === 'string' ? b.password : '';
  if (!password) errors.push('password is required.');
  else if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const role = typeof b.role === 'string' ? b.role.trim().toUpperCase() : '';
  if (!ROLES.includes(role)) errors.push(`role is required and must be one of: ${ROLES.join(', ')}.`);

  let branchIds = [];
  if (b.branchIds !== undefined) {
    if (!Array.isArray(b.branchIds) || b.branchIds.some((v) => typeof v !== 'string')) {
      errors.push('branchIds, if provided, must be an array of branch id strings.');
    } else {
      // De-duplicate -- a client sending the same id twice should not
      // attempt two inserts against the partial-unique-active-grant index.
      branchIds = [...new Set(b.branchIds.map((v) => v.trim()))].filter(Boolean);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, value: { email, name, password, role, branchIds } };
}

/**
 * Validate + normalize a `PATCH /api/v1/staff/accounts/:id` request body.
 * Only `name`/`role` are editable (see module doc — password reset is out of
 * scope). At least one must be present; an empty PATCH is a 400, same
 * convention as `customerManagementService.validatePatchCustomerInput`.
 * @returns {{ok:true, value:object}|{ok:false, errors:string[]}}
 */
export function validatePatchStaffInput(body) {
  const errors = [];
  const b = body && typeof body === 'object' ? body : {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const changes = {};

  if (has('name')) {
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) errors.push('name, if provided, must be a non-empty string.');
    else changes.name = name;
  }

  if (has('role')) {
    const role = typeof b.role === 'string' ? b.role.trim().toUpperCase() : '';
    if (!ROLES.includes(role)) errors.push(`role, if provided, must be one of: ${ROLES.join(', ')}.`);
    else changes.role = role;
  }

  if (Object.keys(changes).length === 0) {
    errors.push('At least one field (name/role) is required.');
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { changes } };
}

/**
 * Pre-insert uniqueness pre-check (same tenant, case-insensitive, active
 * rows only — mirrors `user_tenant_email_active_unique_idx`). This is a
 * best-effort UX check, NOT the source of truth for the constraint: the DB
 * index is (partial unique index enforces it regardless of this check, race
 * window included) — the route additionally catches a `23505` unique
 * violation on insert as defense-in-depth for the TOCTOU window between this
 * check and the write.
 */
export async function emailInUse(db, { tenantId, email }) {
  const [row] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(
      and(
        eq(schema.user.tenantId, tenantId),
        sql`lower(${schema.user.email}) = lower(${email})`,
        isNull(schema.user.deletedAt)
      )
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Insert one `user` row (STAFF or ADMIN) in the CURRENT request transaction.
 * `passwordHash` is produced by the ROUTE via
 * `passwordService.hashPassword` -- this module never hashes/verifies a
 * password itself, matching `authService.js`'s own separation.
 */
export async function createStaff(db, { tenantId, email, name, passwordHash, role }) {
  const [user] = await db
    .insert(schema.user)
    .values({ tenantId, email, name, passwordHash, role })
    .returning();
  return user;
}

/**
 * Insert one `staff_branch_access` row per branchId, all in the CURRENT
 * request transaction (same transaction the `user` insert above ran in --
 * `withTenantContext` wraps the whole handler in BEGIN...COMMIT). Only used
 * at account-creation time, when no prior grant history for this brand-new
 * user can exist, so there is no reactivate-vs-insert decision to make here
 * (that's `grantBranchAccess`'s job, used by the dedicated grant endpoint).
 */
export async function insertBranchGrants(db, { tenantId, userId, branchIds }) {
  if (!branchIds || branchIds.length === 0) return [];
  const values = branchIds.map((branchId) => ({ tenantId, userId, branchId }));
  return db.insert(schema.staffBranchAccess).values(values).returning();
}

/**
 * RLS-scoped lookup (a cross-tenant id returns null, never a leak) --
 * excludes soft-deleted rows, same `isNull(deletedAt)` convention as every
 * other module's `getXById`.
 */
export async function getStaffById(db, { id }) {
  const [row] = await db
    .select()
    .from(schema.user)
    .where(and(eq(schema.user.id, id), isNull(schema.user.deletedAt)))
    .limit(1);
  return row || null;
}

/**
 * Active (`revoked_at IS NULL`) branch assignments for one staff user, joined
 * with `branch` for a display name -- `GET /:id`'s detail view.
 */
export async function getActiveBranchAssignments(db, { userId }) {
  return db
    .select({
      id: schema.staffBranchAccess.id,
      branchId: schema.staffBranchAccess.branchId,
      branchName: schema.branch.name,
      grantedAt: schema.staffBranchAccess.createdAt,
    })
    .from(schema.staffBranchAccess)
    .innerJoin(schema.branch, eq(schema.staffBranchAccess.branchId, schema.branch.id))
    .where(and(eq(schema.staffBranchAccess.userId, userId), isNull(schema.staffBranchAccess.revokedAt)));
}

/**
 * Paginated tenant-user list (excludes soft-deleted), each row annotated
 * with its current active branch-grant count. Two queries + an in-memory
 * merge (page of users, then one grouped count query for just that page's
 * user ids) rather than a single correlated-subquery `SELECT` — simpler to
 * read/verify and this codebase has no existing correlated-subquery
 * precedent to follow.
 */
export async function listStaff(db, { page, pageSize }) {
  const whereExpr = isNull(schema.user.deletedAt);

  const [{ count }] = await db.select({ count: sql`count(*)::int` }).from(schema.user).where(whereExpr);

  const rows = await db
    .select()
    .from(schema.user)
    .where(whereExpr)
    .orderBy(desc(schema.user.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const ids = rows.map((r) => r.id);
  const countByUserId = new Map();
  if (ids.length > 0) {
    const countRows = await db
      .select({ userId: schema.staffBranchAccess.userId, count: sql`count(*)::int` })
      .from(schema.staffBranchAccess)
      .where(and(inArray(schema.staffBranchAccess.userId, ids), isNull(schema.staffBranchAccess.revokedAt)))
      .groupBy(schema.staffBranchAccess.userId);
    countRows.forEach((r) => countByUserId.set(r.userId, r.count));
  }

  return {
    data: rows.map((r) => ({ ...serializeStaff(r), activeBranchCount: countByUserId.get(r.id) ?? 0 })),
    meta: { page, pageSize, total: count },
  };
}

/**
 * Apply a PATCH edit (name/role only) to an already-fetched `user` row in
 * the CURRENT request transaction. The route always writes an `audit_log`
 * row around this call (before/after snapshot), same as every other
 * module's metadata edit.
 */
export async function updateStaff(db, { id, changes }) {
  const [updated] = await db
    .update(schema.user)
    .set({ ...changes, updatedAt: new Date() })
    .where(and(eq(schema.user.id, id), isNull(schema.user.deletedAt)))
    .returning();
  return updated || null;
}

/** Count of active (not soft-deleted) ADMIN users in the caller's tenant (RLS-scoped). Backs the last-admin self-downgrade/self-deactivation guard. */
export async function countActiveAdmins(db) {
  const [{ count }] = await db
    .select({ count: sql`count(*)::int` })
    .from(schema.user)
    .where(and(eq(schema.user.role, 'ADMIN'), isNull(schema.user.deletedAt)));
  return count;
}

/**
 * Grant branch access. Three cases, in order:
 *   1. An active grant for this user+branch already exists -> no-op,
 *      `alreadyActive: true` (idempotent, not an error).
 *   2. A REVOKED grant for this user+branch exists -> re-activate the most
 *      recently revoked one (`revoked_at` -> NULL) rather than inserting a
 *      duplicate history row, per this task's explicit instruction. Older
 *      revoked rows for the same pair (if any, from an earlier grant/revoke
 *      cycle) are left untouched as history.
 *   3. Otherwise -> insert a brand-new row.
 * The partial unique index (`staff_branch_access_active_unique_idx`, on
 * `(user_id, branch_id)` WHERE `revoked_at IS NULL`) is the schema-level
 * backstop for case 1/2 never producing two simultaneously-active rows for
 * the same pair, even under a race.
 */
export async function grantBranchAccess(db, { tenantId, userId, branchId }) {
  const [active] = await db
    .select()
    .from(schema.staffBranchAccess)
    .where(
      and(
        eq(schema.staffBranchAccess.userId, userId),
        eq(schema.staffBranchAccess.branchId, branchId),
        isNull(schema.staffBranchAccess.revokedAt)
      )
    )
    .limit(1);
  if (active) return { row: active, reactivated: false, alreadyActive: true };

  const [revoked] = await db
    .select()
    .from(schema.staffBranchAccess)
    .where(
      and(
        eq(schema.staffBranchAccess.userId, userId),
        eq(schema.staffBranchAccess.branchId, branchId),
        isNotNull(schema.staffBranchAccess.revokedAt)
      )
    )
    .orderBy(desc(schema.staffBranchAccess.revokedAt))
    .limit(1);

  if (revoked) {
    const [updated] = await db
      .update(schema.staffBranchAccess)
      .set({ revokedAt: null })
      .where(eq(schema.staffBranchAccess.id, revoked.id))
      .returning();
    return { row: updated, reactivated: true, alreadyActive: false };
  }

  const [inserted] = await db
    .insert(schema.staffBranchAccess)
    .values({ tenantId, userId, branchId })
    .returning();
  return { row: inserted, reactivated: false, alreadyActive: false };
}

/**
 * Soft-revoke the CURRENTLY ACTIVE grant for this user+branch
 * (`revoked_at` = now) -- never a hard delete, matching the table's own
 * documented soft-revoke design. Returns the revoked row, or `null` if no
 * active grant existed for this pair (route turns that into a 404).
 */
export async function revokeBranchAccess(db, { userId, branchId }) {
  const [revoked] = await db
    .update(schema.staffBranchAccess)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.staffBranchAccess.userId, userId),
        eq(schema.staffBranchAccess.branchId, branchId),
        isNull(schema.staffBranchAccess.revokedAt)
      )
    )
    .returning();
  return revoked || null;
}

/** Soft-revoke EVERY active grant for a user (used by `deactivateStaff` — deactivating a staff member closes out all their branch access, not just one). */
export async function revokeAllBranchAccessForUser(db, { userId }) {
  return db
    .update(schema.staffBranchAccess)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.staffBranchAccess.userId, userId), isNull(schema.staffBranchAccess.revokedAt)))
    .returning();
}

/**
 * Soft-revoke EVERY active session row for a user (`revoked_at` = now, same
 * field/semantics `sessionService.revokeSession` uses for logout). This is
 * the SEC-04 "staff-removal token revocation" requirement: `requireSession`
 * (`sessionAuth.js`) rejects any session where `session_revoked_at` is set,
 * so this makes an already-issued bearer token for the deactivated user stop
 * working on its very next request -- not just "no new logins", the EXISTING
 * token dies immediately.
 */
export async function revokeAllSessionsForUser(db, { userId }) {
  return db
    .update(schema.session)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.session.userId, userId), isNull(schema.session.revokedAt)))
    .returning();
}

/**
 * Soft-delete the `user` row (`deleted_at` = now). Caller
 * (`routes/staffManagement.js`) is responsible for calling this AND
 * `revokeAllBranchAccessForUser` AND `revokeAllSessionsForUser` in the SAME
 * request transaction (all three run under the one `withTenantContext`
 * BEGIN...COMMIT the handler is wrapped in — no explicit transaction
 * plumbing needed here, same pattern every other module in this codebase
 * uses for a multi-write handler).
 */
export async function softDeleteStaff(db, { id }) {
  const [deleted] = await db
    .update(schema.user)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.user.id, id), isNull(schema.user.deletedAt)))
    .returning();
  return deleted || null;
}

export function serializeStaff(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
