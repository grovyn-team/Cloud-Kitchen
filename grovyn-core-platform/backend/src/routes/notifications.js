/**
 * P4 backend (2026-07-30) — real, DB-backed Notifications module routes:
 * branch-scoped list, unread badge-count, mark-read (ADMIN or STAFF), and
 * resolve (ADMIN-only -- enforced at the ROUTER level in `routes/v1/index.js`
 * via an extra `requireRole(['ADMIN'])` layered onto the shared
 * `notificationsAuth` array, same composition style `routes/v1/index.js`
 * already uses for `adminOnly` vs `adminOrStaff` groups). Thin: validate
 * input shape, enforce branch scope, call `notificationService.js`, shape
 * the response via `reply()` -- same `withTenantContext(pool)(async (req,
 * db) => ...)` composition pattern as `routes/customers.js`/
 * `routes/inventoryManagement.js`, never a bare `(req, res, next)` handler
 * that reaches for `res` directly.
 *
 * This file is the READER/consumer side of the `notification` table only.
 * The PRODUCER side (low-stock trigger, staff restock request writing a
 * `notification` row) already exists in `inventoryManagementService.js`/
 * `routes/inventoryManagement.js` and is untouched by this task.
 *
 * Every handler here composes with `requireSession(pool)` +
 * `requireRole([...])` at the router level -- this file never trusts
 * `req.tenantId`/`req.userRole`/`req.branchIds` from anywhere except what
 * `requireSession` already verified server-side from the DB-backed session
 * row.
 *
 * Branch scope: `branchId` arrives via a QUERY param (`listNotifications`,
 * `unreadCount`), never a route `:param` -- same split every other module in
 * this codebase uses, via the same `isBranchAllowed(req, branchId)`
 * predicate + `branchExistsInTenant` check.
 */

import { withTenantContext, reply } from '../middleware/tenantContext.js';
import { isBranchAllowed } from '../middleware/sessionAuth.js';
import { isValidUuid } from '../utils/validation.js';
import { branchExistsInTenant } from '../services/branchAccessService.js';
import * as notificationService from '../services/notificationService.js';

function badRequest(message, details) {
  return reply(400, { error: 'BadRequest', message, ...(details ? { details } : {}) });
}

function forbidden() {
  return reply(403, { error: 'Forbidden', message: 'Access to this branch is not permitted.' });
}

function notFound(message = 'Notification not found.') {
  return reply(404, { error: 'NotFound', message });
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Resolves + validates the `branchId` QUERY param shared by
 * `listNotifications`/`unreadCount`: malformed -> 400, outside the caller's
 * own access -> 403 (`isBranchAllowed`), a real id from another tenant ->
 * 403 (`branchExistsInTenant`, RLS-scoped so a foreign-tenant branch id
 * resolves to zero rows -- same no-cross-tenant-reference discipline as
 * `routes/customers.js`/`routes/inventoryManagement.js`).
 * @returns {Promise<{error:object}|{branchId:string|null}>}
 */
async function resolveBranchFilter(req, db) {
  const query = req.query || {};
  const branchId = typeof query.branchId === 'string' ? query.branchId.trim() : '';
  if (!branchId) return { branchId: null };
  if (!isValidUuid(branchId)) return { error: badRequest('branchId must be a valid UUID.') };
  if (!isBranchAllowed(req, branchId)) return { error: forbidden() };
  if (!(await branchExistsInTenant(db, branchId))) return { error: forbidden() };
  return { branchId };
}

/**
 * Fetches the notification (RLS-scoped, so a cross-tenant id already
 * returns null) and checks branch scope, returning either the notification
 * or a `reply()` envelope to hand straight back -- same no-existence-leak
 * pattern as `routes/customers.js`'s `loadCustomerOr404`/
 * `routes/inventoryManagement.js`'s `loadItemOr404`: a STAFF request for a
 * notification outside their assigned branches gets 404, not 403, so a
 * STAFF member can't probe for the existence of another branch's requests.
 */
async function loadNotificationOr404(req, db, id) {
  if (!isValidUuid(id)) return { error: notFound() };
  const notification = await notificationService.getNotificationById(db, { id });
  if (!notification) return { error: notFound() };
  if (req.userRole === 'STAFF' && !isBranchAllowed(req, notification.branchId)) {
    return { error: notFound() };
  }
  return { notification };
}

/**
 * GET /api/v1/notifications?status=unread|read|resolved&branchId=&page=&pageSize=
 * — paginated, branch-scoped list. `status` defaults to `unread` when
 * omitted (see `notificationService.listNotifications`'s doc comment for
 * the reasoning).
 * @param {import('pg').Pool} pool
 */
export function listNotifications(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const branchFilter = await resolveBranchFilter(req, db);
    if (branchFilter.error) return branchFilter.error;

    const query = req.query || {};
    let status = 'unread';
    if (typeof query.status === 'string' && query.status.trim()) {
      const candidate = query.status.trim();
      if (!notificationService.NOTIFICATION_STATUSES.includes(candidate)) {
        return badRequest('status must be one of: unread, read, resolved.');
      }
      status = candidate;
    }

    const page = clampInt(query.page, 1, 1, 1_000_000);
    const pageSize = clampInt(query.pageSize, 20, 1, 100);

    return notificationService.listNotifications(db, {
      branchId: branchFilter.branchId,
      staffBranchIds: req.userRole === 'STAFF' ? req.branchIds : null,
      status,
      page,
      pageSize,
    });
  });
}

/**
 * GET /api/v1/notifications/unread-count?branchId= — lightweight badge
 * count, same branch-scope rules as the list endpoint. Always counts
 * `status = 'unread'` -- there is no `status` param here by design.
 * @param {import('pg').Pool} pool
 */
export function unreadCount(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const branchFilter = await resolveBranchFilter(req, db);
    if (branchFilter.error) return branchFilter.error;

    const count = await notificationService.getUnreadCount(db, {
      branchId: branchFilter.branchId,
      staffBranchIds: req.userRole === 'STAFF' ? req.branchIds : null,
    });
    return { count };
  });
}

/**
 * PATCH /api/v1/notifications/:id/read — mark as read. Valid only from
 * `unread`; idempotent no-op (200, unchanged row) if already `read` or
 * `resolved`. Reachable by ADMIN or STAFF (router-level role gate) as long
 * as the notification is within the caller's own branch scope (STAFF) or
 * tenant (ADMIN, implicit all-branch).
 * @param {import('pg').Pool} pool
 */
export function markRead(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const loaded = await loadNotificationOr404(req, db, req.params.id);
    if (loaded.error) return loaded.error;

    const updated = await notificationService.markRead(db, { notification: loaded.notification });
    return notificationService.serializeNotification(updated);
  });
}

/**
 * PATCH /api/v1/notifications/:id/resolve — mark as resolved, stamping
 * `resolvedByUserId`/`resolvedAt` from the session. ADMIN-only -- enforced
 * by the router mounting an extra `requireRole(['ADMIN'])` in front of this
 * handler (see this file's module doc comment); STAFF hitting this route at
 * all gets a router-level 403 before this handler ever runs. Idempotent:
 * resolving an already-resolved notification is a no-op (does not reassign
 * `resolvedByUserId` to a second caller).
 * @param {import('pg').Pool} pool
 */
export function resolveNotification(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const loaded = await loadNotificationOr404(req, db, req.params.id);
    if (loaded.error) return loaded.error;

    const updated = await notificationService.resolveNotification(db, {
      notification: loaded.notification,
      resolvedByUserId: req.userId,
    });
    return notificationService.serializeNotification(updated);
  });
}
