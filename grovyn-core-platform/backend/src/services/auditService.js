/**
 * P1-04 — thin helper around `audit_log` inserts, reused by the auth events
 * this task requires (login success, login failure, logout, session
 * refresh). Not a new abstraction layer: `db.insert(schema.auditLog)` would
 * work identically inline everywhere -- this just names the shape once so
 * every call site passes the same fields in the same order and nobody
 * forgets `entityType`/`entityId` (both NOT NULL on the schema).
 *
 * @param {ReturnType<import('../db/dal.js').createScopedDb>} db a tenant-
 *   scoped DAL instance -- the caller MUST already be inside
 *   `runInTenantContext`/`withTenantContext` for the correct tenant, exactly
 *   like any other write. This module has no pool/context access of its own
 *   on purpose.
 * @param {{
 *   tenantId: string,
 *   actorUserId?: string | null,
 *   action: string,
 *   entityType: string,
 *   entityId: string,
 *   before?: unknown,
 *   after?: unknown,
 * }} event `tenantId` is REQUIRED and must be passed explicitly -- RLS's
 *   `WITH CHECK` only *validates* the column against the session GUC on
 *   INSERT, it does not populate it; `tenant_id` has no schema-level
 *   `DEFAULT`, so an insert that omits it sends `NULL`, which fails the
 *   RLS `WITH CHECK` (NULL = anything is unknown, i.e. not-true) before it
 *   would even reach the `NOT NULL` constraint. Always pass the same
 *   `tenantId` the surrounding `runInTenantContext`/`withTenantContext`
 *   call was opened with.
 */
import { schema } from '../db/dal.js';

export async function logAuditEvent(db, event) {
  await db.insert(schema.auditLog).values({
    tenantId: event.tenantId,
    actorUserId: event.actorUserId ?? null,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    beforeData: event.before ?? null,
    afterData: event.after ?? null,
  });
}
