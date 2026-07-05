/**
 * Health check. No service dependency; returns status, service name, timestamp, and version.
 */

import { config } from '../config/index.js';

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function getHealth(req, res) {
  res.status(200).json({
    status: 'ok',
    service: config.serviceName,
    timestamp: new Date().toISOString(),
    version: config.version,
  });
}
