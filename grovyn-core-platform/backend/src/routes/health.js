/**
 * Health check. No service dependency; returns status and timestamp.
 */

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function getHealth(req, res) {
  res.status(200).json({
    status: 'ok',
    service: 'grovyn-core-data-service',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
}
