/**
 * P1-04 — real, DB-backed session verification + branch-scope middleware.
 *
 * `requireSession(pool)` is the per-request middleware item 8 of this task
 * asks for: it derives `req.tenantId` STRICTLY from a verified session --
 * never from a client-supplied header/query/body value -- so it is safe to
 * feed straight into `withTenantContext` (P1-02) for every downstream
 * handler. It also sets `req.userId` / `req.userRole` from the same
 * DB-verified row, so role is read from the database record on every
 * request, never trusted from the client (CLAUDE.md's non-optional rule;
 * confirmed by grepping the whole codebase for role/STAFF/ADMIN usage before
 * writing this -- see this task's report).
 *
 * Verifying a bearer token is, like login, inherently pre-context: the
 * server does not know which tenant a token belongs to until it looks the
 * token up, and the `session` table's RLS policy requires that tenant
 * context to already be set to query it at all. This mirrors D-015's login
 * problem exactly, so it reuses the same shape: a third `SECURITY DEFINER`
 * resolver function (`resolve_session_by_token_hash`,
 * `drizzle/0005_pre_context_session_resolver.sql`) called through the same
 * narrow `runPreContextQuery` helper login uses -- not a second, competing
 * escape hatch to the raw pool.
 */

import { runPreContextQuery } from '../db/preContext.js';
import { hashToken } from '../services/sessionService.js';

function unauthorized(res) {
  return res.status(401).json({ error: 'Unauthorized', message: 'Valid session required.' });
}

function extractBearerToken(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

/**
 * @param {import('pg').Pool} pool the `grovyn_app` runtime pool.
 * @returns {import('express').RequestHandler}
 */
export function requireSession(pool) {
  return async function sessionMiddleware(req, res, next) {
    const token = extractBearerToken(req);
    if (!token) return unauthorized(res);

    let row;
    try {
      const result = await runPreContextQuery(pool, (client) =>
        client.query('SELECT * FROM resolve_session_by_token_hash($1)', [hashToken(token)])
      );
      row = result.rows[0];
    } catch (err) {
      return next(err);
    }

    if (!row) return unauthorized(res);
    if (row.user_deleted_at) return unauthorized(res);
    if (row.session_revoked_at) return unauthorized(res);
    if (new Date(row.session_expires_at).getTime() <= Date.now()) return unauthorized(res);

    // Server-verified, DB-sourced values only -- this is the one place in
    // the request lifecycle allowed to set these.
    req.sessionId = row.session_id;
    req.tenantId = row.tenant_id;
    req.userId = row.user_id;
    req.userRole = row.user_role;
    req.branchIds = Array.isArray(row.branch_ids) ? row.branch_ids : [];

    next();
  };
}

/**
 * @param {string[]} allowedRoles
 * @returns {import('express').RequestHandler}
 */
export function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.userRole || !allowedRoles.includes(req.userRole)) {
      return res.status(403).json({ error: 'Forbidden', message: 'Insufficient role.' });
    }
    next();
  };
}

/**
 * ADMIN implicitly has access to every branch within their own tenant (RLS
 * already confines them to their tenant's branches; this only gates STAFF).
 * @param {string} paramName request-param name holding the branch id.
 * @returns {import('express').RequestHandler}
 */
export function requireBranchAccess(paramName = 'branchId') {
  return (req, res, next) => {
    if (req.userRole === 'ADMIN') return next();
    const branchId = req.params[paramName];
    if (!branchId || !req.branchIds || !req.branchIds.includes(branchId)) {
      return res.status(403).json({ error: 'Forbidden', message: 'Access to this branch is not permitted.' });
    }
    next();
  };
}
