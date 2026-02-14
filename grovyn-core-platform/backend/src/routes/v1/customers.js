/**
 * v1 Customers API. Route only handles request/response; data from service.
 */

import { customerService } from '../../services/index.js';

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function getCustomers(req, res) {
  const data = customerService.getAllCustomers();
  res.json({ data, meta: { count: data.length } });
}
