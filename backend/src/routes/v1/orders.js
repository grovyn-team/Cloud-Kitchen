/**
 * v1 Orders API. Route only handles request/response; data from service.
 * Returns normalized orders with channel and commissionAmount (Milestone 3).
 */

import * as commissionService from '../../services/commissionService.js';

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function getOrders(req, res) {
  const data = commissionService.getOrdersWithCommission();
  res.json({ data, meta: { count: data.length } });
}
