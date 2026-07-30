/**
 * P4 backend (2026-07-30) — real, DB-backed Notifications module business
 * logic: branch-scoped list/unread-count and the two status-transition
 * writes (`read`, `resolve`). This task does NOT build the producer side
 * (low-stock trigger, staff restock request) -- those already write
 * `notification` rows today (`inventoryManagementService.maybeCreateLowStockNotification`,
 * `routes/inventoryManagement.js`'s `createRequest`) and are untouched here.
 * This module is the reader/consumer side of that same table.
 *
 * Every exported function here takes a tenant-scoped `db`
 * (`../db/dal.js`'s `createScopedDb`, always obtained via
 * `withTenantContext(pool)` in `../routes/notifications.js`) -- there is no
 * code path in this module that runs a query without RLS already active on
 * the connection, same reasoning as `customerManagementService.js`/
 * `inventoryManagementService.js`.
 *
 * `notification.branch_id` is `NOT NULL` in the shipped schema (verified by
 * reading `schema.js` before writing this file) -- there is no tenant-wide
 * NULL-branch case to special-case here; every row is scoped to exactly one
 * branch and STAFF/ADMIN visibility follows the same
 * isBranchAllowed()-and-branchExistsInTenant() split every other module
 * uses. An ADMIN omitting `branchId` still sees every branch in their own
 * tenant (no branch filter applied) -- exactly the access pattern
 * `schema.js`'s own `notification_tenant_status_idx` comment documents
 * ("Admin's cross-branch notification feed (no branch filter)").
 */

import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { schema } from '../db/dal.js';

export const NOTIFICATION_STATUSES = ['unread', 'read', 'resolved'];

/**
 * RLS-scoped lookup (a cross-tenant id returns null, never a leak) --
 * excludes soft-deleted rows, same `isNull(deletedAt)` convention as
 * `customerManagementService.getCustomerById`/
 * `inventoryManagementService.getItemById`. In practice no producer soft-
 * deletes a notification today, but the column exists on the table so this
 * function respects it like every other reader in this codebase does.
 */
export async function getNotificationById(db, { id }) {
  const [row] = await db
    .select()
    .from(schema.notification)
    .where(and(eq(schema.notification.id, id), isNull(schema.notification.deletedAt)))
    .limit(1);
  return row || null;
}

/**
 * Branch-scoped, paginated notification list.
 *
 * Default-status judgment call (documented here, fast-mode -- no
 * DECISIONS_LOG entry): `status` defaults to `'unread'` when the caller
 * omits it, NOT "all statuses". This is a notification/badge feed, not a
 * general-purpose audit list -- an admin or staff member opening the panel
 * wants "what still needs my attention" by default, matching the module's
 * own framing in `PROJECT_BRIEF.md` §3 ("staff -> admin request feed") and
 * `schema.js`'s status enum ordering (`unread` first). A caller that wants
 * the full history passes `status=read` / `status=resolved` explicitly, or
 * (not built here, no requirement surfaced for it) a future `status=all`
 * value.
 *
 * `staffBranchIds` restricts the result set for STAFF regardless of whether
 * `branchId` was supplied -- same split as
 * `customerManagementService.listCustomers`/
 * `inventoryManagementService.listItems`.
 */
export async function listNotifications(db, { branchId, staffBranchIds, status, page, pageSize }) {
  const conditions = [isNull(schema.notification.deletedAt)];
  if (branchId) {
    conditions.push(eq(schema.notification.branchId, branchId));
  } else if (Array.isArray(staffBranchIds)) {
    if (staffBranchIds.length === 0) {
      return { data: [], meta: { page, pageSize, total: 0 } };
    }
    conditions.push(inArray(schema.notification.branchId, staffBranchIds));
  }
  if (status) {
    conditions.push(eq(schema.notification.status, status));
  }

  const whereExpr = and(...conditions);

  const [{ count }] = await db.select({ count: sql`count(*)::int` }).from(schema.notification).where(whereExpr);

  const rows = await db
    .select()
    .from(schema.notification)
    .where(whereExpr)
    .orderBy(desc(schema.notification.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { data: rows.map(serializeNotification), meta: { page, pageSize, total: count } };
}

/**
 * Lightweight badge-count query: always counts `status = 'unread'`
 * regardless of what `listNotifications` defaults to -- "unread count" has
 * exactly one meaning, there is no `status` parameter to vary here. Same
 * branch-scope split as `listNotifications`.
 */
export async function getUnreadCount(db, { branchId, staffBranchIds }) {
  const conditions = [isNull(schema.notification.deletedAt), eq(schema.notification.status, 'unread')];
  if (branchId) {
    conditions.push(eq(schema.notification.branchId, branchId));
  } else if (Array.isArray(staffBranchIds)) {
    if (staffBranchIds.length === 0) return 0;
    conditions.push(inArray(schema.notification.branchId, staffBranchIds));
  }

  const [{ count }] = await db
    .select({ count: sql`count(*)::int` })
    .from(schema.notification)
    .where(and(...conditions));
  return count;
}

/**
 * Dashboard aggregation support (P2-03/P2-04) -- counts everything NOT YET
 * `resolved` (i.e. `unread` OR `read`), unlike `getUnreadCount` above which
 * counts ONLY `status = 'unread'`. A dashboard's "needs attention" tile
 * means "still open", not "never even looked at" -- a notification an admin
 * has read but not yet acted on/closed out is still an outstanding item.
 * Same branch-scope split as `getUnreadCount`/`listNotifications`.
 */
export async function getUnresolvedCount(db, { branchId, staffBranchIds }) {
  const conditions = [isNull(schema.notification.deletedAt), ne(schema.notification.status, 'resolved')];
  if (branchId) {
    conditions.push(eq(schema.notification.branchId, branchId));
  } else if (Array.isArray(staffBranchIds)) {
    if (staffBranchIds.length === 0) return 0;
    conditions.push(inArray(schema.notification.branchId, staffBranchIds));
  }

  const [{ count }] = await db
    .select({ count: sql`count(*)::int` })
    .from(schema.notification)
    .where(and(...conditions));
  return count;
}

/**
 * PATCH .../read — valid ONLY from `unread`; idempotent no-op (no error,
 * row returned unchanged) if already `read` or `resolved` -- per this
 * task's explicit spec: reading never downgrades a `resolved` notification
 * back to `read`.
 */
export async function markRead(db, { notification }) {
  if (notification.status !== 'unread') return notification;
  const [updated] = await db
    .update(schema.notification)
    .set({ status: 'read' })
    .where(and(eq(schema.notification.id, notification.id), eq(schema.notification.status, 'unread')))
    .returning();
  // Falls back to the pre-update row on a lost race (another request
  // resolved/read it between the load and this update) -- the caller's own
  // read of "current state" stays correct either way, never a stale write.
  return updated || notification;
}

/**
 * PATCH .../resolve — ADMIN-only, enforced by the ROUTE (`requireRole`
 * middleware), not this function; this function has no role awareness by
 * design, same separation `staffManagementService.js` uses (route decides
 * who may call it, service just does the write).
 *
 * Resolution split (documented here, fast-mode -- no DECISIONS_LOG entry):
 * per this task's brief ("STAFF can mark read but resolution is an admin
 * action"), matching the module's own "staff -> admin request feed"
 * framing -- STAFF raises/sees requests, ADMIN is the one who acts on and
 * closes them out. Resolving is allowed directly from EITHER `unread` or
 * `read` (an admin acting immediately on an unread request does not need to
 * "read" it first as a separate step) -- but is idempotent once already
 * `resolved`: a second resolve call is a no-op that returns the ORIGINAL
 * `resolvedByUserId`/`resolvedAt` unchanged, it does not reassign resolution
 * to whichever admin happened to call it last.
 */
export async function resolveNotification(db, { notification, resolvedByUserId }) {
  if (notification.status === 'resolved') return notification;
  const [updated] = await db
    .update(schema.notification)
    .set({ status: 'resolved', resolvedByUserId, resolvedAt: new Date() })
    .where(and(eq(schema.notification.id, notification.id), ne(schema.notification.status, 'resolved')))
    .returning();
  return updated || notification;
}

export function serializeNotification(notification) {
  return {
    id: notification.id,
    branchId: notification.branchId,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    actorUserId: notification.actorUserId ?? null,
    relatedEntityType: notification.relatedEntityType ?? null,
    relatedEntityId: notification.relatedEntityId ?? null,
    status: notification.status,
    resolvedByUserId: notification.resolvedByUserId ?? null,
    resolvedAt: notification.resolvedAt ?? null,
    createdAt: notification.createdAt,
  };
}
