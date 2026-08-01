/**
 * Integration Task 3, round 3 — `tenant.branch_limit`/`tenant.seat_limit`
 * (columns shipped since P1-01, never enforced anywhere until now). One
 * chokepoint per resource type, called from the two write paths that create
 * the resource it limits (`routes/branches.js#createBranch`,
 * `routes/staffManagement.js#createStaff`) -- same "one chokepoint, not
 * scattered checks" discipline every other invariant in this codebase uses
 * (D-009's pattern, referenced repeatedly across this schema's comments).
 *
 * Counts ACTIVE rows only (`deleted_at IS NULL` / soft-revoked staff
 * excluded) -- a limit is about how much of a tenant's plan is currently in
 * use, not how many rows have ever existed.
 */

import { and, count, eq, isNull } from 'drizzle-orm';
import { schema } from '../db/dal.js';

export class TenantLimitExceededError extends Error {
  constructor(message, { limit, current }) {
    super(message);
    this.limit = limit;
    this.current = current;
  }
}

async function getTenantLimits(db, tenantId) {
  const [tenant] = await db
    .select({ branchLimit: schema.tenant.branchLimit, seatLimit: schema.tenant.seatLimit })
    .from(schema.tenant)
    .where(eq(schema.tenant.id, tenantId))
    .limit(1);
  return tenant;
}

/**
 * Throws `TenantLimitExceededError` if creating one more branch would
 * exceed `tenant.branch_limit`. Call BEFORE inserting the new branch.
 * @param {*} db
 * @param {string} tenantId
 */
export async function assertBranchLimitNotExceeded(db, tenantId) {
  const tenant = await getTenantLimits(db, tenantId);
  if (!tenant) return; // tenant row not found is not this function's concern

  const [{ value: activeBranchCount }] = await db
    .select({ value: count() })
    .from(schema.branch)
    .where(and(eq(schema.branch.tenantId, tenantId), isNull(schema.branch.deletedAt)));

  if (activeBranchCount >= tenant.branchLimit) {
    throw new TenantLimitExceededError(
      `Branch limit reached (${tenant.branchLimit} on your plan). Upgrade your plan or remove an existing branch before adding another.`,
      { limit: tenant.branchLimit, current: activeBranchCount }
    );
  }
}

/**
 * Throws `TenantLimitExceededError` if creating one more staff/admin
 * account would exceed `tenant.seat_limit`. Call BEFORE inserting the new
 * user. Counts every active (non-deleted) user regardless of role (ADMIN
 * and STAFF both occupy a seat) -- `tenant.seat_limit`'s own name/doc intent
 * is total accounts, not a per-role sub-limit.
 * @param {*} db
 * @param {string} tenantId
 */
export async function assertSeatLimitNotExceeded(db, tenantId) {
  const tenant = await getTenantLimits(db, tenantId);
  if (!tenant) return;

  const [{ value: activeSeatCount }] = await db
    .select({ value: count() })
    .from(schema.user)
    .where(and(eq(schema.user.tenantId, tenantId), isNull(schema.user.deletedAt)));

  if (activeSeatCount >= tenant.seatLimit) {
    throw new TenantLimitExceededError(
      `Seat limit reached (${tenant.seatLimit} on your plan). Upgrade your plan or deactivate an existing account before adding another.`,
      { limit: tenant.seatLimit, current: activeSeatCount }
    );
  }
}
