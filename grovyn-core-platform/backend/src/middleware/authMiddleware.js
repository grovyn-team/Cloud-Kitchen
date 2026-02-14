/**
 * Auth middleware — in-memory sessions only. No DB, no JWT. Demo-safe.
 * Reads Authorization: Bearer <token>, attaches req.user. Use requireRole for RBAC.
 */

/** @type {Map<string, { userId: string, role: string, storeIds: string[] }>} */
const sessions = new Map();

export function getSessions() {
  return sessions;
}

/**
 * Register a session (used by login route).
 * @param {string} token
 * @param {{ userId: string, role: string, storeIds: string[] }} payload
 */
export function setSession(token, payload) {
  sessions.set(token, payload);
}

/**
 * Optional auth: if Bearer token present and valid, set req.user. Else req.user = undefined.
 */
export function authOptional(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    req.user = undefined;
    return next();
  }
  const token = header.slice(7).trim();
  const session = sessions.get(token);
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
