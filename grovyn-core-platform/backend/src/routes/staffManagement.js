/**
 * P3 backend (2026-07-30) — real, DB-backed Staff management module routes:
 * ADMIN-only staff/admin account create, list/detail, name/role edit,
 * deactivate, and branch-access grant/revoke. Thin: validate input shape,
 * call `staffManagementService.js`, shape the response via `reply()` — same
 * composition pattern as `routes/customers.js`
 * (`withTenantContext(pool)(async (req, db) => ...)`), never a bare
 * `(req, res, next)` handler that reaches for `res` directly.
 *
 * ADMIN-ONLY, enforced at the ROUTER level (`routes/v1/index.js` composes
 * every handler here with `requireSession(pool)` +
 * `requireRole(['ADMIN'])` from `sessionAuth.js`, the real DB-backed session
 * model — NOT the legacy `authMiddleware.js` HMAC scheme) — a STAFF-role
 * session gets 403 before any handler in this file runs. This file never
 * re-derives role from anywhere except what `requireSession` already
 * verified server-side from the DB-backed session row (`req.userRole`).
 *
 * MOUNT PATH NOTE (deviation from the literal task brief, logged here since
 * this is fast-mode with no DECISIONS_LOG entry): the brief specifies
 * `POST/GET /api/v1/staff` for create/list. That exact path is ALREADY
 * mounted (`routes/staff.js`'s legacy `getStaff`, an in-memory workforce
 * snapshot, `ADMIN or STAFF`) and IS actively consumed by the frontend
 * (`frontend/src/services/api.ts`'s `apiPaths.staff`, confirmed by grep
 * before making this choice) — unlike `routes/customers.js`'s identical-
 * shaped precedent, where the legacy mock at the same path was confirmed
 * UNUSED by the frontend and could be safely superseded. Silently replacing
 * a real, consumed endpoint's shape/auth (ADMIN-or-STAFF workforce snapshot
 * -> ADMIN-only account-management list) would break the live frontend
 * without a frontend change to match, which is out of this task's lane
 * (guardrail: "don't merge unrelated frontend changes"). Mounted this real
 * module's routes under `/staff/accounts` instead — the exact same
 * collision-avoidance move `routes/inventoryManagement.js` already made for
 * Inventory (`/inventory/items` vs. the legacy `/inventory`). No
 * `API_CONTRACT.md` exists yet to update (P1-11 still Backlog); flagged here
 * and in this task's report instead.
 */

import { withTenantContext, reply } from '../middleware/tenantContext.js';
import { isValidUuid } from '../utils/validation.js';
import { branchExistsInTenant } from '../services/branchAccessService.js';
import { hashPassword } from '../services/passwordService.js';
import * as staffManagementService from '../services/staffManagementService.js';
import { logAuditEvent } from '../services/auditService.js';

function badRequest(message, details) {
  return reply(400, { error: 'BadRequest', message, ...(details ? { details } : {}) });
}

function conflict(message) {
  return reply(409, { error: 'Conflict', message });
}

function notFound(message = 'Staff account not found.') {
  return reply(404, { error: 'NotFound', message });
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Shared not-found loader — a nonexistent/cross-tenant/soft-deleted id all collapse to an identical 404, same no-existence-leak posture every other module in this codebase uses. */
async function loadStaffOr404(db, id) {
  if (!isValidUuid(id)) return { error: notFound() };
  const staff = await staffManagementService.getStaffById(db, { id });
  if (!staff) return { error: notFound() };
  return { staff };
}

/**
 * Simple last-admin guard (per this task's explicit "keep it simple" scope):
 * an ADMIN acting on THEIR OWN account cannot downgrade their own role away
 * from ADMIN, nor deactivate themselves, if doing so would drop the tenant's
 * active-ADMIN count to 0. Only self-targeting triggers this check — an
 * admin managing a DIFFERENT admin's account is not guarded here, matching
 * the brief's literal scope.
 * @returns {Promise<import('../middleware/tenantContext.js').reply|null>} a
 *   `reply()` envelope to return immediately, or `null` if the action is
 *   allowed.
 */
async function guardLastAdmin(db, { req, target, isDeactivation, newRole }) {
  if (target.id !== req.userId) return null;
  if (target.role !== 'ADMIN') return null;
  const isDowngrade = isDeactivation || (newRole && newRole !== 'ADMIN');
  if (!isDowngrade) return null;

  const activeAdmins = await staffManagementService.countActiveAdmins(db);
  if (activeAdmins <= 1) {
    return badRequest(
      isDeactivation
        ? 'Cannot deactivate your own account: you are the last active ADMIN for this tenant.'
        : 'Cannot change your own role away from ADMIN: you are the last active ADMIN for this tenant.'
    );
  }
  return null;
}

/**
 * POST /api/v1/staff/accounts — create a new STAFF or ADMIN account.
 * Body: `{email, name, password, role, branchIds?:[]}`.
 * @param {import('pg').Pool} pool
 */
export function createStaff(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const validation = staffManagementService.validateCreateStaffInput(req.body);
    if (!validation.ok) {
      return badRequest('Invalid staff account payload.', validation.errors);
    }
    const { email, name, password, role, branchIds } = validation.value;

    // Validate branchIds shape (UUID) + tenant ownership BEFORE any write —
    // never a partial commit (create the user, then fail on a bad branch
    // grant), same "validate before commit" discipline the file-import
    // modules use for row-level validation.
    for (const branchId of branchIds) {
      if (!isValidUuid(branchId)) {
        return badRequest('branchIds must each be a valid UUID.', [branchId]);
      }
    }
    for (const branchId of branchIds) {
      // eslint-disable-next-line no-await-in-loop -- small, bounded list (a
      // real admin grants a handful of branches, not hundreds); sequential
      // is simpler to reason about than Promise.all + partial-failure
      // bookkeeping for something this small.
      if (!(await branchExistsInTenant(db, branchId))) {
        return badRequest('One or more branchIds do not belong to this tenant.', [branchId]);
      }
    }

    if (await staffManagementService.emailInUse(db, { tenantId: req.tenantId, email })) {
      return conflict('A staff account with this email already exists.');
    }

    const passwordHash = await hashPassword(password);

    let user;
    try {
      user = await staffManagementService.createStaff(db, {
        tenantId: req.tenantId,
        email,
        name,
        passwordHash,
        role,
      });
    } catch (err) {
      // Defense-in-depth for the TOCTOU race window between the
      // `emailInUse` pre-check above and this insert — the partial unique
      // index (`user_tenant_email_active_unique_idx`) is the actual source
      // of truth; this only turns its violation into a clean 409 instead of
      // a leaked 500/stack trace.
      if (err && err.code === '23505') {
        return conflict('A staff account with this email already exists.');
      }
      throw err;
    }

    const grants = await staffManagementService.insertBranchGrants(db, {
      tenantId: req.tenantId,
      userId: user.id,
      branchIds,
    });

    await logAuditEvent(db, {
      tenantId: req.tenantId,
      actorUserId: req.userId,
      action: 'staff.create',
      entityType: 'user',
      entityId: user.id,
      after: { ...staffManagementService.serializeStaff(user), branchIds },
    });

    return reply(201, {
      ...staffManagementService.serializeStaff(user),
      branchIds: grants.map((g) => g.branchId),
    });
  });
}

/**
 * GET /api/v1/staff/accounts?page=&pageSize= — paginated list of this
 * tenant's active (not soft-deleted) user accounts, each annotated with its
 * current active branch-grant count.
 * @param {import('pg').Pool} pool
 */
export function listStaff(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const query = req.query || {};
    const page = clampInt(query.page, 1, 1, 1_000_000);
    const pageSize = clampInt(query.pageSize, 20, 1, 100);
    return staffManagementService.listStaff(db, { page, pageSize });
  });
}

/**
 * GET /api/v1/staff/accounts/:id — detail, including current active branch
 * assignments.
 * @param {import('pg').Pool} pool
 */
export function getStaffDetail(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const loaded = await loadStaffOr404(db, req.params.id);
    if (loaded.error) return loaded.error;

    const branchAssignments = await staffManagementService.getActiveBranchAssignments(db, {
      userId: loaded.staff.id,
    });

    return { ...staffManagementService.serializeStaff(loaded.staff), branchAssignments };
  });
}

/**
 * PATCH /api/v1/staff/accounts/:id — edit name/role only. Password reset is
 * explicitly OUT OF SCOPE for this task (see `staffManagementService.js`'s
 * module doc) — a `password` field in the body is simply never read.
 * @param {import('pg').Pool} pool
 */
export function updateStaff(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const loaded = await loadStaffOr404(db, req.params.id);
    if (loaded.error) return loaded.error;
    const { staff } = loaded;

    const validation = staffManagementService.validatePatchStaffInput(req.body);
    if (!validation.ok) {
      return badRequest('Invalid staff edit payload.', validation.errors);
    }
    const { changes } = validation.value;

    const guardReply = await guardLastAdmin(db, { req, target: staff, newRole: changes.role });
    if (guardReply) return guardReply;

    const updated = await staffManagementService.updateStaff(db, { id: staff.id, changes });
    if (!updated) return notFound();

    await logAuditEvent(db, {
      tenantId: req.tenantId,
      actorUserId: req.userId,
      action: 'staff.update',
      entityType: 'user',
      entityId: staff.id,
      before: staffManagementService.serializeStaff(staff),
      after: staffManagementService.serializeStaff(updated),
    });

    return staffManagementService.serializeStaff(updated);
  });
}

/**
 * DELETE /api/v1/staff/accounts/:id — deactivate: soft-delete the `user`
 * row AND revoke every active `staff_branch_access` grant AND revoke every
 * active `session` row for that user, all in the SAME request transaction
 * (`withTenantContext` already wraps this whole handler in
 * BEGIN...COMMIT). The session-revocation half is the SEC-04
 * "staff-removal token revocation" requirement — see
 * `staffManagementService.revokeAllSessionsForUser`'s doc comment.
 * @param {import('pg').Pool} pool
 */
export function deactivateStaff(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const loaded = await loadStaffOr404(db, req.params.id);
    if (loaded.error) return loaded.error;
    const { staff } = loaded;

    const guardReply = await guardLastAdmin(db, { req, target: staff, isDeactivation: true });
    if (guardReply) return guardReply;

    const deleted = await staffManagementService.softDeleteStaff(db, { id: staff.id });
    // Can only be null here on a concurrent delete between the load above
    // and this update in the same transaction — vanishingly unlikely, but
    // handled the same no-existence-leak way as `customers.js`'s DELETE.
    if (!deleted) return notFound();

    await staffManagementService.revokeAllBranchAccessForUser(db, { userId: staff.id });
    await staffManagementService.revokeAllSessionsForUser(db, { userId: staff.id });

    await logAuditEvent(db, {
      tenantId: req.tenantId,
      actorUserId: req.userId,
      action: 'staff.deactivate',
      entityType: 'user',
      entityId: staff.id,
      before: staffManagementService.serializeStaff(staff),
      after: null,
    });

    // undefined -> withTenantContext sends 204 No Content.
  });
}

/**
 * POST /api/v1/staff/accounts/:id/branches — grant branch access.
 * Body: `{branchId}`. Re-activates an existing revoked grant for the same
 * user+branch instead of inserting a duplicate (see
 * `staffManagementService.grantBranchAccess`'s doc comment for the three-case
 * logic this defers to).
 * @param {import('pg').Pool} pool
 */
export function grantStaffBranchAccess(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const loaded = await loadStaffOr404(db, req.params.id);
    if (loaded.error) return loaded.error;
    const { staff } = loaded;

    const branchId = typeof req.body?.branchId === 'string' ? req.body.branchId.trim() : '';
    if (!isValidUuid(branchId)) {
      return badRequest('branchId is required and must be a valid UUID.');
    }
    if (!(await branchExistsInTenant(db, branchId))) {
      return badRequest('branchId does not belong to this tenant.');
    }

    const { row, reactivated, alreadyActive } = await staffManagementService.grantBranchAccess(db, {
      tenantId: req.tenantId,
      userId: staff.id,
      branchId,
    });

    await logAuditEvent(db, {
      tenantId: req.tenantId,
      actorUserId: req.userId,
      action: 'staff.branch_grant',
      entityType: 'staff_branch_access',
      entityId: row.id,
      after: { userId: staff.id, branchId, reactivated, alreadyActive },
    });

    return reply(alreadyActive || reactivated ? 200 : 201, {
      id: row.id,
      userId: staff.id,
      branchId: row.branchId,
      grantedAt: row.createdAt,
      reactivated,
      alreadyActive,
    });
  });
}

/**
 * DELETE /api/v1/staff/accounts/:id/branches/:branchId — soft-revoke only
 * (`revoked_at` = now on the `staff_branch_access` row) — never a hard
 * delete, matching the table's own documented soft-revoke design.
 * @param {import('pg').Pool} pool
 */
export function revokeStaffBranchAccess(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const loaded = await loadStaffOr404(db, req.params.id);
    if (loaded.error) return loaded.error;
    const { staff } = loaded;

    const branchId = req.params.branchId;
    if (!isValidUuid(branchId)) {
      return badRequest('branchId must be a valid UUID.');
    }

    const revoked = await staffManagementService.revokeBranchAccess(db, { userId: staff.id, branchId });
    if (!revoked) {
      return reply(404, { error: 'NotFound', message: 'No active branch grant found for this staff member/branch.' });
    }

    await logAuditEvent(db, {
      tenantId: req.tenantId,
      actorUserId: req.userId,
      action: 'staff.branch_revoke',
      entityType: 'staff_branch_access',
      entityId: revoked.id,
      before: { userId: staff.id, branchId, revokedAt: null },
      after: { userId: staff.id, branchId, revokedAt: revoked.revokedAt },
    });

    // undefined -> withTenantContext sends 204 No Content.
  });
}
