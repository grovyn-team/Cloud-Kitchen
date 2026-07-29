/**
 * P1-04 — real authentication service. Isolates the login orchestration
 * (pre-context tenant/user resolution, password verification, the
 * timing-oracle mitigation, session issuance, audit logging) from the HTTP
 * layer (`src/routes/auth.js` only validates input shape and translates this
 * module's result into a response).
 *
 * Login is inherently pre-context (D-015 / CRITIQUE 016 §C.1): it cannot go
 * through `withTenantContext`/the scoped DAL because no `tenant_id` is known
 * yet. It runs the D-015 `SECURITY DEFINER` resolvers
 * (`resolve_tenant_by_slug`, `authenticate_lookup`) through the narrow
 * `runPreContextQuery` helper (`../db/preContext.js`) -- never the raw pool
 * directly, and never a hand-rolled competing query (CRITIQUE 016 §B.4: the
 * case-insensitive, `deleted_at IS NULL`-filtered lookup is baked into
 * `authenticate_lookup` itself; this module trusts it, not a second copy of
 * that logic).
 *
 * Timing oracle (CRITIQUE 017, non-optional): every failure path -- tenant
 * not found, user not found, wrong password -- performs exactly one argon2id
 * verify (real on the password-mismatch path, `dummyVerify()` on the other
 * two) before returning, and every failure path returns the SAME generic
 * `{ ok: false }` result shape with no information about which stage failed.
 * `src/routes/auth.js` maps every `{ ok: false }` to one identical 401
 * response.
 */

import { runPreContextQuery } from '../db/preContext.js';
import { runInTenantContext } from '../middleware/tenantContext.js';
import { verifyPassword, dummyVerify } from './passwordService.js';
import { createSession } from './sessionService.js';
import { logAuditEvent } from './auditService.js';

/**
 * @param {import('pg').Pool} pool the `grovyn_app` runtime pool.
 * @param {{ tenantSlug: string, email: string, password: string }} input
 * @returns {Promise<
 *   | { ok: true, tenantId: string, tenantName: string, tenantSlug: string,
 *       userId: string, email: string, name: string, role: 'ADMIN'|'STAFF',
 *       sessionToken: string, expiresAt: Date }
 *   | { ok: false }
 * >}
 */
export async function login(pool, { tenantSlug, email, password }) {
  const tenantRows = await runPreContextQuery(pool, (client) =>
    client.query('SELECT * FROM resolve_tenant_by_slug($1)', [tenantSlug])
  );
  const tenant = tenantRows.rows[0];

  if (!tenant) {
    // No tenant to attribute an audit_log row to (tenant_id is NOT NULL and
    // itself the RLS-scoping column -- there is no legitimate tenant context
    // to write this failure under). Console-logged only, not audit_log; see
    // module doc / this task's report for the reasoning.
    await dummyVerify();
    console.warn('[auth] login attempt against unknown tenant slug', { tenantSlug });
    return { ok: false };
  }

  const userRows = await runPreContextQuery(pool, (client) =>
    client.query('SELECT * FROM authenticate_lookup($1, $2)', [tenant.id, email])
  );
  const user = userRows.rows[0];

  if (!user) {
    await dummyVerify();
    return runInTenantContext(pool, tenant.id, async (db) => {
      await logAuditEvent(db, {
        tenantId: tenant.id,
        actorUserId: null,
        action: 'auth.login_failure',
        entityType: 'user',
        entityId: email,
        after: { reason: 'user_not_found' },
      });
      return { ok: false };
    });
  }

  const passwordOk = await verifyPassword(user.password_hash, password);
  if (!passwordOk) {
    return runInTenantContext(pool, tenant.id, async (db) => {
      await logAuditEvent(db, {
        tenantId: tenant.id,
        actorUserId: user.id,
        action: 'auth.login_failure',
        entityType: 'user',
        entityId: user.id,
        after: { reason: 'invalid_password' },
      });
      return { ok: false };
    });
  }

  return runInTenantContext(pool, tenant.id, async (db) => {
    const { sessionId, token, expiresAt } = await createSession(db, {
      tenantId: tenant.id,
      userId: user.id,
    });
    await logAuditEvent(db, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: 'auth.login_success',
      entityType: 'session',
      entityId: sessionId,
    });
    return {
      ok: true,
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      userId: user.id,
      email: user.email,
      name: user.name,
      // Role read from the DB record `authenticate_lookup` returned --
      // never from the request body. See `src/routes/auth.js`: the request
      // body's shape for login does not even have a `role` field.
      role: user.role,
      sessionToken: token,
      expiresAt,
    };
  });
}
