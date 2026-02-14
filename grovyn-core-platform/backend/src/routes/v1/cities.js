/**
 * v1 Cities API. Route only handles request/response; data from service.
 */

import { cityService } from '../../services/index.js';

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function getCities(req, res) {
  const data = cityService.getAllCities();
  res.json({ data, meta: { count: data.length } });
}
