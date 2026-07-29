/**
 * P2-02 — CSV upload middleware for `POST /api/v1/sales/import`.
 *
 * New dependency added for this task: `multer` (memoryStorage) -- there was
 * no multipart/file-upload handling anywhere in `backend/package.json`
 * before this. `csv-parse` (used in `services/salesCsvImportService.js`) is
 * the second new dependency, for the same reason -- neither a multipart
 * parser nor a CSV parser previously existed in this repo. Both are the
 * de facto standard, actively maintained libraries for their job in the
 * Node/Express ecosystem (multer is the Express project's own recommended
 * multipart middleware; csv-parse is part of the widely-used `node-csv`
 * toolkit) -- picked over hand-rolling either (a hand-rolled CSV parser in
 * particular is exactly the kind of thing that looks fine until a quoted
 * field containing a comma or an embedded newline shows up).
 *
 * (e) Memory storage only -- `multer.memoryStorage()` never writes to disk,
 * so there is no client-supplied filename anywhere near a filesystem path;
 * the parsed buffer lives only in `req.file.buffer` for the duration of the
 * request.
 * (b) File size limit: 5MB (`MAX_IMPORT_FILE_SIZE_BYTES`, shared constant
 * with `salesCsvImportService.js` so the two stay in sync). Enforced by
 * multer itself during the multipart parse -- an oversized upload is
 * rejected before the full file is even buffered in memory.
 * (d) Extension check only, not MIME type: `file.mimetype` is entirely
 * client-declared and untrustworthy (a browser/curl can send any value it
 * likes) -- the actual structural validation happens at parse time in
 * `parseSalesCsv()`, which throws on malformed/binary content regardless of
 * what extension or MIME type the request claimed.
 */

import multer from 'multer';
import { MAX_IMPORT_FILE_SIZE_BYTES } from '../services/salesCsvImportService.js';

function csvFileFilter(_req, file, cb) {
  const extOk = /\.csv$/i.test(file.originalname || '');
  if (!extOk) {
    const err = new Error('Only .csv files are accepted.');
    err.code = 'INVALID_FILE_TYPE';
    return cb(err);
  }
  cb(null, true);
}

export const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_FILE_SIZE_BYTES, files: 1 },
  fileFilter: csvFileFilter,
});

/**
 * Express error-handling middleware (4-arg signature) mounted right after
 * `csvUpload.single('file')` on the import route -- translates multer's raw
 * errors (which include internal details not meant for a client, e.g. field
 * names/limits in library-specific phrasing) into the same consistent error
 * shape every other endpoint in this codebase uses.
 */
// eslint-disable-next-line no-unused-vars
export function handleUploadError(err, _req, res, next) {
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
    return res.status(400).json({ error: 'BadRequest', message: 'Only .csv files are accepted.' });
  }

  return next(err);
}
