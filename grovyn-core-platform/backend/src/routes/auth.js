/**
 * Auth routes — login only. No existing API logic changed. Session in memory.
 */

import crypto from 'crypto';
import { setSession, signSessionToken } from '../middleware/authMiddleware.js';
import * as storeService from '../services/storeService.js';

/**
 * GET /api/v1/auth/stores — public list of store id/name for login dropdown. No auth.
 */
export function getStoreOptions(req, res) {
  const stores = storeService.getAllStores().map((s) => ({ id: s.id, name: s.name }));
  res.json({ data: stores, meta: { count: stores.length } });
}

/** Dummy password for demo; replace with real auth (e.g. bcrypt) in production */
const DEMO_PASSWORD = 'grovyn@123';

/**
 * POST /api/v1/auth/login
 * Body: { email, password, role: "ADMIN"|"STAFF", storeId?: string } — storeId required for STAFF.
 * Returns: { userId, role, storeIds, sessionToken }
 */
export function login(req, res) {
  const { email, password, role, storeId } = req.body || {};
  if (!email || typeof email !== 'string' || email.trim() === '') {
    return res.status(400).json({ error: 'Bad request', message: 'Email is required' });
  }
  if (!password || typeof password !== 'string') {
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
