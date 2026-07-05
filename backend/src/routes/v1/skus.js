/**
 * v1 SKUs API. Route only handles request/response; data from service.
 */

import { skuService } from '../../services/index.js';

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function getSkus(req, res) {
  const data = skuService.getAllSkus();
  res.json({ data, meta: { count: data.length } });
}
