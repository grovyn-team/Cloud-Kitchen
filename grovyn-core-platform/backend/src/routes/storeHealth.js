/**
 * Store health API routes. Validate input, call service, return response.
 * No business logic or data access in this file.
 */

import * as storeHealthService from '../services/storeHealthService.js';

/**
 * GET /api/v1/store-health — health for all stores
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function getAllStoreHealth(req, res) {
  const data = storeHealthService.getHealthForAllStores();
  res.json({ data, meta: { count: data.length } });
}

/**
 * GET /api/v1/stores/:id/health — health for one store
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function getStoreHealthById(req, res) {
  const id = req.params.id;
  if (!id || typeof id !== 'string' || id.trim() === '') {
    res.status(400).json({ error: 'Store id is required' });
    return;
  }
  const storeId = id.trim();
  const result = storeHealthService.getHealthForStore(storeId);
  if (result === null) {
    res.status(404).json({ error: 'Store not found' });
    return;
  }
  res.json(result);
}
