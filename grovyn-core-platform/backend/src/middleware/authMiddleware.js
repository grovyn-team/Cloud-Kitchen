/**
 * Auth middleware — stateless signed tokens (works on Vercel serverless) + optional in-memory for local dev.
 * Reads Authorization: Bearer <token>, attaches req.user. Use requireRole for RBAC.
 */

import crypto from 'crypto';
import { config } from '../config/index.js';

/** @type {Map<string, { userId: string, role: string, storeIds: string[] }>} */
const sessions = new Map();

export function getSessions() {
  return sessions;
}

/**
 * Register a session (used by login for in-memory fallback; stateless token is primary).
 * @param {string} token
 * @param {{ userId: string, role: string, storeIds: string[] }} payload
 */
export function setSession(token, payload) {
  sessions.set(token, payload);
}

const SECRET = config.sessionSecret;

/**
 * Create a stateless session token (HMAC-signed). Works across serverless invocations.
 * @param {{ userId: string, role: string, storeIds: string[] }} payload
 * @returns {string} token
 */
export function signSessionToken(payload) {
  const payloadJson = JSON.stringify({
    userId: payload.userId,
    role: payload.role,
    storeIds: payload.storeIds || [],
  });
  const payloadB64 = Buffer.from(payloadJson, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

/**
 * Verify a stateless session token. Returns payload or null.
 * @param {string} token
 * @returns {{ userId: string, role: string, storeIds: string[] } | null}
 */
export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const expectedSig = crypto.createHmac('sha256', SECRET).update(payloadB64).digest('base64url');
    if (expectedSig !== sig) return null;
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson);
    if (!payload.userId || !payload.role) return null;
    return {
      userId: payload.userId,
      role: payload.role,
      storeIds: Array.isArray(payload.storeIds) ? payload.storeIds : [],
    };
  } catch {
    return null;
  }
}

/**
 * Optional auth: if Bearer token present and valid (stateless or in-memory), set req.user. Else req.user = undefined.
 */
export function authOptional(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    req.user = undefined;
    return next();
  }
  const token = header.slice(7).trim();
  let session = sessions.get(token);
  if (!session) {
    session = verifySessionToken(token);
  }
  if (!session) {
    req.user = undefined;
    return next();
  }
  req.user = { userId: session.userId, role: session.role, storeIds: session.storeIds || [] };
  next();
}

/**
 * Require valid auth. If no valid token → 401.
 */
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Valid session required' });
  }
  next();
}

/**
 * Require one of the given roles. Call after requireAuth (or authOptional + requireAuth).
 * @param {string[]} allowedRoles
 */
export function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Valid session required' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden', message: 'Insufficient role' });
    }
    next();
  };
}

/**
 * For STAFF: require that req.params.storeId (or req.params.id when resource is a store) is in req.user.storeIds.
 * Call after requireRole. Use on routes like GET /stores/:id/health.
 */
export function requireStoreAccess(paramName = 'id') {
  return (req, res, next) => {
    if (req.user.role === 'ADMIN') return next();
    const storeId = req.params[paramName] || req.params.storeId;
    if (!storeId || !req.user.storeIds || !req.user.storeIds.includes(storeId)) {
      return res.status(403).json({ error: 'Forbidden', message: 'Access to this store not allowed' });
    }
    next();
  };
}
