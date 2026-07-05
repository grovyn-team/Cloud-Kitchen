/**
 * v1 Brands API. Route only handles request/response; data from service.
 */

import { brandService } from '../../services/index.js';

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function getBrands(req, res) {
  const data = brandService.getAllBrands();
  res.json({ data, meta: { count: data.length } });
}
