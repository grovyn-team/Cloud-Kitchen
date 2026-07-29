/**
 * P2-05 backend (2026-07-30) — Excel/CSV upload middleware for
 * `POST /api/v1/inventory/import`. Same shape/rationale as
 * `middleware/csvUpload.js` (Sales' CSV import), extended to accept both
 * `.csv` and `.xlsx`.
 *
 * (e) Memory storage only -- `multer.memoryStorage()` never writes to disk.
 * (b) File size limit: 5MB (`MAX_IMPORT_FILE_SIZE_BYTES`, shared constant
 * with `inventoryImportService.js`). Enforced by multer during the
 * multipart parse -- an oversized upload is rejected before the full file
 * is buffered in memory. `inventoryImportService.parseInventoryFile` also
 * re-checks this independently (defense-in-depth, see that module's doc
 * comment for why XLSX's zip-container shape makes the extra check worth
 * having).
 * (d) Extension check only, not MIME type -- `file.mimetype` is entirely
 * client-declared and untrustworthy; the actual structural validation
 * happens at parse time in `inventoryImportService.parseInventoryFile`,
 * which throws on malformed/binary content regardless of what extension or
 * MIME type the request claimed.
 */

import multer from 'multer';
import { MAX_IMPORT_FILE_SIZE_BYTES } from '../services/inventoryImportService.js';

function inventoryFileFilter(_req, file, cb) {
  const extOk = /\.(csv|xlsx)$/i.test(file.originalname || '');
  if (!extOk) {
    const err = new Error('Only .csv or .xlsx files are accepted.');
    err.code = 'INVALID_FILE_TYPE';
    return cb(err);
  }
  cb(null, true);
}

export const inventoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_FILE_SIZE_BYTES, files: 1 },
  fileFilter: inventoryFileFilter,
});

/**
 * Express error-handling middleware (4-arg signature), same translation job
 * as `csvUpload.js`'s `handleUploadError` -- multer's raw errors include
 * internal details not meant for a client; this maps them to the same
 * consistent error shape every other endpoint in this codebase uses.
 */
// eslint-disable-next-line no-unused-vars
export function handleInventoryUploadError(err, _req, res, next) {
  if (!err) return next();

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'PayloadTooLarge',
        message: `File exceeds the ${Math.floor(MAX_IMPORT_FILE_SIZE_BYTES / (1024 * 1024))}MB limit.`,
      });
    }
    return res.status(400).json({ error: 'BadRequest', message: 'File upload error.' });
  }

  if (err.code === 'INVALID_FILE_TYPE') {
    return res.status(400).json({ error: 'BadRequest', message: 'Only .csv or .xlsx files are accepted.' });
  }

  return next(err);
}
