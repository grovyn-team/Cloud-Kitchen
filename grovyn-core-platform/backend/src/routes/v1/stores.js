/**
 * v1 Stores API. Route only handles request/response; data from service.
 */

import { storeService } from '../../services/index.js';

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function getStores(req, res) {
  const data = storeService.getAllStores();
  res.json({ data, meta: { count: data.length } });
}
