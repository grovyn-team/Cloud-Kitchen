/**
 * v1 Stores API. Route only handles request/response; data from service. RBAC: STAFF sees only assigned stores.
 */

import { storeService } from '../../services/index.js';

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function getStores(req, res) {
  let data = storeService.getAllStores();
  if (req.user && req.user.role === 'STAFF' && req.user.storeIds?.length) {
    const idSet = new Set(req.user.storeIds);
    data = data.filter((s) => idSet.has(s.id));
  }
  res.json({ data, meta: { count: data.length } });
}
