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
 * P1-08 / item 10: the OLD demo/seed login (`demoLogin`) and its store-list
 * helper (`getDemoStoreOptions`) are UNCHANGED in behavior but are no longer
 * exported as `login`/`getStoreOptions` -- `routes/v1/index.js` only mounts
 * them at all when `config.auth.demoModeEnabled` is true (default false),
 * and each handler re-checks the same flag itself as defense-in-depth (a
 * 404, not a 200 that then denies -- the route effectively doesn't exist
 * when disabled).
 */

import crypto from 'crypto';
import { config } from '../config/index.js';
import { setSession, signSessionToken } from '../middleware/authMiddleware.js';
import * as storeService from '../services/storeService.js';
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

// ============================================================================
// Demo/seed login (P1-08) -- UNCHANGED logic from the pre-P1-04 template,
// gated behind `config.auth.demoModeEnabled` (default false) at mount time
// AND re-checked here. Never wired to the real `session`/`user` tables --
// entirely in-memory, exactly as before. Reads `AUTH_DEMO_PASSWORD` (the
// mismatch the baseline review flagged -- previously hardcoded and ignored
// the env var entirely) via `config`.
// ============================================================================

const DEMO_PASSWORD = process.env.AUTH_DEMO_PASSWORD || 'grovyn@123';

/** GET /api/v1/auth/demo-stores — public list of store id/name for the demo login dropdown. */
export function getDemoStoreOptions(req, res) {
  if (!config.auth.demoModeEnabled) {
    return res.status(404).json({ error: 'NotFound', message: 'Not found.' });
  }
  const stores = storeService.getAllStores().map((s) => ({ id: s.id, name: s.name }));
  res.json({ data: stores, meta: { count: stores.length } });
}

/**
 * POST /api/v1/auth/demo-login
 * Body: { email, password, role: "ADMIN"|"STAFF", storeId? }
 * Demo-only. Never reachable unless AUTH_DEMO_MODE=true.
 */
export function demoLogin(req, res) {
  if (!config.auth.demoModeEnabled) {
    return res.status(404).json({ error: 'NotFound', message: 'Not found.' });
  }

  const body = req.body || {};
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password.trim() : '';
  const role = body.role;
  const storeId = body.storeId;

  if (!email) {
    return res.status(400).json({ error: 'Bad request', message: 'Email is required' });
  }
  if (password === '') {
    return res.status(400).json({ error: 'Bad request', message: 'Password is required' });
  }
  if (password !== DEMO_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid email or password' });
  }
  if (!role || !['ADMIN', 'STAFF'].includes(role)) {
    return res.status(400).json({ error: 'Bad request', message: 'Role must be ADMIN or STAFF' });
  }

  let storeIds = [];
  if (role === 'STAFF') {
    if (!storeId || typeof storeId !== 'string' || storeId.trim() === '') {
      return res.status(400).json({ error: 'Bad request', message: 'Store selection is required for Staff' });
    }
    const store = storeService.getStoreById(storeId.trim());
    if (!store) {
      return res.status(400).json({ error: 'Bad request', message: 'Invalid store' });
    }
    storeIds = [store.id];
  } else {
    storeIds = storeService.getAllStores().map((s) => s.id);
  }

  const userId = `u-${crypto.randomUUID().slice(0, 8)}`;
  const payload = { userId, role, storeIds };
  const sessionToken = signSessionToken(payload);
  setSession(sessionToken, payload);

  res.status(200).json({
    userId,
    role,
    storeIds,
    sessionToken,
  });
}
