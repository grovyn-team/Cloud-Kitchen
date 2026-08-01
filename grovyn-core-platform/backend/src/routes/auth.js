/**
 * Auth routes.
 *
 * P1-04 real, DB-backed auth: `login`/`refresh`/`logout`/`me`. Login is
 * inherently pre-context (see `../services/authService.js`) so it is NOT
 * wrapped by `withTenantContext` -- `refresh`/`logout`/`me` run AFTER
 * `requireSession` has derived `req.tenantId` from a verified session, so
 * they use the ordinary `withTenantContext(pool)` composition every other
 * tenant-scoped handler will (P1-05+).
 *
 * The OLD demo/seed login (`demoLogin`/`getDemoStoreOptions`, P1-08) and the
 * legacy in-memory HMAC session signer it depended on
 * (`middleware/authMiddleware.js`) have been retired (Integration Task 2) --
 * every module is on the real DB-backed session model now, so a surviving
 * legacy auth path was either an unreachable demo-only bypass or dead code,
 * never a route real tenant data flowed through. See this task's report for
 * what depended on it and what replaced it (`backend/tests/system.test.js`
 * lost its only DB-free auth path as a direct consequence -- real endpoint
 * coverage now lives entirely in the `*.pgtest.mjs` suites).
 */

import * as authService from '../services/authService.js';
import * as sessionService from '../services/sessionService.js';
import { logAuditEvent } from '../services/auditService.js';
import { withTenantContext } from '../middleware/tenantContext.js';

// ============================================================================
// Real auth (P1-04)
// ============================================================================

/**
 * POST /api/v1/auth/login
 * Body: { tenantSlug, email, password }. No `role` field -- role is never
 * accepted from the client (SEC-04); it is read back from the DB record
 * `authenticate_lookup` resolved and returned as part of the response.
 * @param {import('pg').Pool} pool
 */
export function login(pool) {
  return async function loginHandler(req, res, next) {
    const body = req.body || {};
    const tenantSlug = typeof body.tenantSlug === 'string' ? body.tenantSlug.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!tenantSlug || !email || !password) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'tenantSlug, email and password are required.',
      });
    }

    let result;
    try {
      result = await authService.login(pool, { tenantSlug, email, password });
    } catch (err) {
      return next(err);
    }

    if (!result.ok) {
      // Deliberately identical status/body for every failure cause (unknown
      // tenant, unknown user, wrong password) -- CRITIQUE 017's timing-oracle
      // fix is only meaningful if the RESPONSE is indistinguishable too.
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid credentials.' });
    }

    return res.status(200).json({
      sessionToken: result.sessionToken,
      expiresAt: result.expiresAt,
      tenant: { id: result.tenantId, name: result.tenantName, slug: result.tenantSlug },
      user: { id: result.userId, email: result.email, name: result.name, role: result.role },
    });
  };
}

/**
 * POST /api/v1/auth/refresh — rotates the caller's own session token and
 * extends its expiry. Requires `requireSession` to have already run.
 * @param {import('pg').Pool} pool
 */
export function refresh(pool) {
  return withTenantContext(pool)(async (req, db) => {
    const { token, expiresAt } = await sessionService.refreshSession(db, req.sessionId);
    await logAuditEvent(db, {
      tenantId: req.tenantId,
      actorUserId: req.userId,
      action: 'auth.session_refresh',
      entityType: 'session',
      entityId: req.sessionId,
    });
    return { sessionToken: token, expiresAt };
  });
}

/**
 * POST /api/v1/auth/logout — revokes the caller's own session.
 * @param {import('pg').Pool} pool
 */
export function logout(pool) {
  return withTenantContext(pool)(async (req, db) => {
    await sessionService.revokeSession(db, req.sessionId);
    await logAuditEvent(db, {
      tenantId: req.tenantId,
      actorUserId: req.userId,
      action: 'auth.logout',
      entityType: 'session',
      entityId: req.sessionId,
    });
    return undefined; // withTenantContext maps `undefined` -> 204 No Content
  });
}

/**
 * GET /api/v1/auth/me — who-am-I, sourced entirely from the verified
 * session (`requireSession`), never from client input.
 * @param {import('pg').Pool} pool
 */
export function me(pool) {
  return withTenantContext(pool)(async (req) => ({
    tenant: { id: req.tenantId },
    user: { id: req.userId, role: req.userRole },
    branchIds: req.branchIds,
  }));
}
