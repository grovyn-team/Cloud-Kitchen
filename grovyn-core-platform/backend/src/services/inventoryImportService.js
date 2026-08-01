/**
 * P2-05 backend (2026-07-30) — Excel/CSV bulk inventory import: parse,
 * validate-before-commit, batch create-or-update. Same defensive posture as
 * `salesCsvImportService.js` (that module's own doc comment is the template
 * this one follows): validate everything in-memory first, only THEN touch
 * the DB, so any row error commits zero rows; formula-injection sanitization
 * on every free-text field; explicit file-size + row-count caps, independent
 * of and in addition to the multer-layer size limit
 * (`middleware/inventoryUpload.js`).
 *
 * Library choice: `exceljs` (not `xlsx`/SheetJS). Documented here (fast-mode
 * -- no DECISIONS_LOG entry, but flagged for the dedicated security review
 * this task's own instructions say is coming separately):
 *   - `exceljs` is actively maintained (regular releases, no unpatched
 *     direct CVEs against the package itself) and is the de facto standard
 *     for server-side XLSX read/write in the Node ecosystem, same tier of
 *     "boring, well-known dependency" as `csv-parse`/`multer` already in
 *     this repo.
 *   - `xlsx` (SheetJS)'s npm-published free-tier releases have had multiple
 *     CVEs (prototype pollution, ReDoS) that SheetJS only patches on their
 *     own CDN, not on the npm registry — `npm install xlsx` alone does not
 *     get you the fix. That mismatch is a worse default for a repo that
 *     otherwise sources dependencies from npm/GitHub normally.
 *   - KNOWN RESIDUAL RISK, flagged explicitly for security-engineer:
 *     `npm audit` reports high-severity transitive vulnerabilities
 *     (`archiver` -> `archiver-utils`/`zip-stream`/`readdir-glob` ->
 *     `glob`/`minimatch`/`brace-expansion` ReDoS/DoS chain, GHSA-mh99-v99m-4gvg)
 *     pulled in by `exceljs`'s WRITE path (`workbook.xlsx.write*`). This
 *     import feature ONLY ever calls the READ path (`workbook.xlsx.load`,
 *     see `parseInventoryXlsx` below) — the vulnerable code is installed
 *     but never invoked by any code path this task added. Still a real
 *     supply-chain exposure (any other future code path that imports
 *     `exceljs` and writes a workbook would reach it) — not resolved here,
 *     surfaced for the dedicated security review.
 *   - SEC-006 (Integration Task 3, closed): `.xlsx` is a ZIP container, so a
 *     small-on-disk file can decompress to something far larger ("zip
 *     bomb") — the row-count cap alone (`MAX_IMPORT_ROWS`) was NOT a real
 *     bound, because it only ran AFTER `workbook.xlsx.load()` had already
 *     fully decompressed and parsed every worksheet into memory. Fixed by
 *     `assertSafeXlsxSize()` below: reads the zip CENTRAL DIRECTORY only
 *     (`unzipper.Open.buffer`, never decompresses entry content) to check
 *     every entry's declared uncompressed size and total entry count BEFORE
 *     `workbook.xlsx.load()` ever runs. Sales' import is CSV-only (no XLSX
 *     path exists there — `middleware/csvUpload.js`'s `fileFilter` accepts
 *     only `.csv`), so CSV has no compression-expansion vector to fix; this
 *     is the only XLSX upload path in the codebase.
 */

import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import unzipper from 'unzipper';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema } from '../db/dal.js';
import { sanitizeCsvCell } from './csvSanitize.js';
import { maybeCreateLowStockNotification } from './inventoryManagementService.js';

// Same values as `salesCsvImportService.js`'s constants, intentionally kept
// in parity rather than imported cross-module (Inventory owns its own import
// limits even though the numbers currently match Sales').
export const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
export const MAX_IMPORT_ROWS = 10_000;

// SEC-006 fix (Integration Task 3): a zip bomb is defined by its
// DECOMPRESSED size, not its on-disk (compressed) size -- the 5MB cap above
// bounds nothing here. A legitimate 10,000-row inventory sheet's XML content
// is a few MB at most even with heavy formatting; 50MB is generous headroom
// (~10x the compressed cap, comfortably above realistic compression ratios
// for text-heavy XLSX content) while still bounding a malicious file's
// worst-case decompressed footprint to a fixed, small multiple of the
// compressed cap instead of unbounded gigabytes. The app and Postgres run on
// one host (D-006) -- an uncapped decompression bomb starves both, not just
// this request.
export const MAX_DECOMPRESSED_BYTES = 50 * 1024 * 1024; // 50MB
// A legitimate XLSX workbook has a small, fixed number of zip entries
// ([Content_Types].xml, a few rels/metadata parts, one worksheet, optionally
// sharedStrings/styles/theme). A "many tiny entries" zip bomb variant can
// have a huge decompressed total from files that individually look small --
// capping entry count is a second, independent guard against that shape,
// not redundant with the byte-total cap above.
export const MAX_ZIP_ENTRIES = 200;

const REQUIRED_COLUMNS = ['name', 'unit', 'quantity'];

export class InventoryImportStructureError extends Error {}
export class InventoryImportRowLimitError extends Error {}
// Distinct from `InventoryImportRowLimitError` (10,000-row cap) -- this one
// is the byte-size cap. Both map to the same 413 PayloadTooLarge at the
// route layer; kept as separate classes so the two failure causes stay
// distinguishable in code/logs even though the client sees the same status.
export class InventoryImportFileTooLargeError extends Error {}

/**
 * @param {Buffer} buffer
 * @returns {Record<string, string>[]}
 */
function parseInventoryCsv(buffer) {
  let records;
  try {
    records = parse(buffer, {
      columns: true,
      bom: true,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: false,
    });
  } catch (err) {
    throw new InventoryImportStructureError(`Could not parse CSV: ${err.message}`);
  }
  return records;
}

/**
 * Normalizes an ExcelJS cell value to a plain string, matching the shape
 * `csv-parse` already produces for `parseInventoryCsv` above, so both
 * parsers can feed the SAME `validateAndBuildRows` below -- one validation
 * path, not two.
 */
function cellToString(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    // Rich text: concatenate the runs' plain text.
    if (Array.isArray(value.richText)) {
      return value.richText.map((run) => run.text ?? '').join('');
    }
    // Formula cell: use the cached result, NEVER the formula text itself --
    // this module never evaluates a formula, it only reads whatever result
    // Excel last cached, same "never re-trigger evaluation" posture as
    // `csvSanitize.js`.
    if ('result' in value) return cellToString(value.result);
    if ('text' in value) return String(value.text ?? '');
    if ('error' in value) return '';
    return '';
  }
  return String(value);
}

/**
 * SEC-006 fix (Integration Task 3): reads ONLY the zip central directory
 * (`unzipper.Open.buffer` -- parses local/central-directory headers, never
 * calls `.buffer()`/`.stream()` on any entry) to learn every entry's
 * DECLARED uncompressed size and total entry count, and rejects before
 * `exceljs`'s `workbook.xlsx.load()` (which unconditionally decompresses
 * every entry into memory, see this module's top doc comment) ever runs.
 * This is a real bound, not a cooperative one: an attacker fully controls
 * the header-declared size field, but zip decompression cannot exceed what
 * the entry headers declare without corrupting the stream, so a file that
 * lies with a SMALL declared size to slip past this check cannot actually
 * decompress to something larger than it declared -- the attack this
 * defends against (declare small, decompress huge) is exactly what checking
 * the header value up front prevents.
 * @param {Buffer} buffer
 */
async function assertSafeXlsxSize(buffer) {
  let directory;
  try {
    directory = await unzipper.Open.buffer(buffer);
  } catch (err) {
    throw new InventoryImportStructureError(`Could not parse Excel file: ${err.message}`);
  }

  const entries = await directory.files;
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new InventoryImportFileTooLargeError(
      `Excel file has ${entries.length} internal parts, exceeding the ${MAX_ZIP_ENTRIES}-part limit.`
    );
  }

  const totalUncompressed = entries.reduce((sum, entry) => sum + (entry.uncompressedSize || 0), 0);
  if (totalUncompressed > MAX_DECOMPRESSED_BYTES) {
    throw new InventoryImportFileTooLargeError(
      `Excel file would decompress to ${Math.ceil(totalUncompressed / (1024 * 1024))}MB, exceeding the ` +
        `${Math.floor(MAX_DECOMPRESSED_BYTES / (1024 * 1024))}MB limit.`
    );
  }
}

/**
 * @param {Buffer} buffer
 * @returns {Promise<Record<string, string>[]>}
 */
async function parseInventoryXlsx(buffer) {
  await assertSafeXlsxSize(buffer);

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (err) {
    throw new InventoryImportStructureError(`Could not parse Excel file: ${err.message}`);
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new InventoryImportStructureError('Excel file has no worksheets.');
  }

  const headerRow = sheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = cellToString(cell.value).trim();
  });
  if (headers.filter(Boolean).length === 0) {
    throw new InventoryImportStructureError('Excel file has no header row.');
  }

  const records = [];
  for (let rowNum = 2; rowNum <= sheet.rowCount; rowNum += 1) {
    const row = sheet.getRow(rowNum);
    // `eachRow`/`getRow` on a sparsely-populated sheet can still return a
    // row object for a fully blank row -- skip those rather than emitting
    // an all-empty record (matches `csv-parse`'s `skip_empty_lines: true`).
    if (row.cellCount === 0) continue;
    const record = {};
    let hasValue = false;
    for (let col = 1; col < headers.length; col += 1) {
      const header = headers[col];
      if (!header) continue;
      const raw = cellToString(row.getCell(col).value).trim();
      record[header] = raw;
      if (raw !== '') hasValue = true;
    }
    if (hasValue) records.push(record);
  }

  return records;
}

/**
 * Dispatches to the CSV or XLSX parser based on the uploaded file's
 * extension (already gated to `.csv`/`.xlsx` by `middleware/inventoryUpload.js`'s
 * `fileFilter` -- this is a defensive second check, same posture as
 * `parseSalesCsv` never trusting the client-declared MIME type). Applies
 * BOTH caps -- (b) file size (also enforced independently at the multer
 * layer) and (c) row count -- to either format, after parsing, before any
 * row-level content validation runs.
 * @param {Buffer} buffer
 * @param {string} originalname
 * @returns {Promise<Record<string, string>[]>}
 */
export async function parseInventoryFile(buffer, originalname) {
  if (buffer.length > MAX_IMPORT_FILE_SIZE_BYTES) {
    throw new InventoryImportFileTooLargeError(
      `File exceeds the ${Math.floor(MAX_IMPORT_FILE_SIZE_BYTES / (1024 * 1024))}MB limit.`
    );
  }

  const isXlsx = /\.xlsx$/i.test(originalname || '');
  const isCsv = /\.csv$/i.test(originalname || '');
  if (!isXlsx && !isCsv) {
    throw new InventoryImportStructureError('Only .csv or .xlsx files are accepted.');
  }

  const records = isXlsx ? await parseInventoryXlsx(buffer) : parseInventoryCsv(buffer);

  if (records.length === 0) {
    throw new InventoryImportStructureError('File has no data rows.');
  }

  const headers = Object.keys(records[0]);
  const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length > 0) {
    throw new InventoryImportStructureError(`Missing required column(s): ${missing.join(', ')}.`);
  }

  if (records.length > MAX_IMPORT_ROWS) {
    throw new InventoryImportRowLimitError(`File exceeds the ${MAX_IMPORT_ROWS}-row limit (found ${records.length} rows).`);
  }

  return records;
}

/**
 * Validates every parsed row and builds the exact upsert-ready row shape for
 * valid ones. Never partial: the caller must check `errors.length === 0`
 * before calling `insertInventoryImportBatch` -- this function itself does
 * not touch the DB.
 * @returns {{validRows: object[], errors: {row:number, error:string}[]}}
 */
export function validateAndBuildRows(records) {
  const errors = [];
  const validRows = [];

  records.forEach((record, idx) => {
    const rowNum = idx + 2; // header is row 1, so the first data row is row 2

    const nameRaw = typeof record.name === 'string' ? record.name.trim() : '';
    if (!nameRaw) {
      errors.push({ row: rowNum, error: 'name is required.' });
      return;
    }

    const unitRaw = typeof record.unit === 'string' ? record.unit.trim() : '';
    if (!unitRaw) {
      errors.push({ row: rowNum, error: 'unit is required.' });
      return;
    }

    const quantity = Number(record.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) {
      errors.push({ row: rowNum, error: 'quantity must be a non-negative number.' });
      return;
    }

    let lowStockThreshold = null;
    if (record.lowStockThreshold !== undefined && String(record.lowStockThreshold).trim() !== '') {
      lowStockThreshold = Number(record.lowStockThreshold);
      if (!Number.isFinite(lowStockThreshold) || lowStockThreshold < 0) {
        errors.push({ row: rowNum, error: 'lowStockThreshold must be a non-negative number.' });
        return;
      }
    }

    let costPerUnit = null;
    if (record.costPerUnit !== undefined && String(record.costPerUnit).trim() !== '') {
      costPerUnit = Number(record.costPerUnit);
      if (!Number.isFinite(costPerUnit) || costPerUnit < 0) {
        errors.push({ row: rowNum, error: 'costPerUnit must be a non-negative number.' });
        return;
      }
    }

    const skuRaw = typeof record.sku === 'string' && record.sku.trim() ? record.sku.trim() : null;

    validRows.push({
      name: sanitizeCsvCell(nameRaw),
      sku: skuRaw ? sanitizeCsvCell(skuRaw) : null,
      unit: sanitizeCsvCell(unitRaw),
      quantity,
      lowStockThreshold,
      costPerUnit,
    });
  });

  return { validRows, errors };
}

/**
 * Create-or-update matching rule (documented here, fast-mode -- no
 * DECISIONS_LOG entry): a row matches an EXISTING item, within the same
 * tenant (RLS-scoped) + branch, by `sku` (case-sensitive exact match) if the
 * row has a `sku`; otherwise by `name` (case-INsensitive exact match, since
 * free-text names are far more likely to differ only by casing between two
 * import runs than SKUs are). No match -> a new item is created. This is a
 * simple, predictable rule, not a fuzzy-match/dedup heuristic -- a tenant
 * that wants SKU-based matching should include a `sku` column.
 *
 * Every row (whether it creates or updates) writes exactly one
 * `inventory_movement` row tagged with the shared `importBatchRef`, per this
 * task's explicit instruction -- even a `quantity: 0` row, so the import
 * batch's movement rows are a complete, literal record of what the file
 * said, not just the rows that happened to add stock.
 *
 * Runs in the CURRENT request transaction (same reasoning as
 * `insertSalesBatch`/`saleService.createSale`): the caller
 * (`routes/inventoryManagement.js`) only calls this after confirming
 * `errors.length === 0` from `validateAndBuildRows` -- nothing here
 * re-validates that.
 *
 * Implementation note: this loops row-by-row (a SELECT to find a match, then
 * an INSERT or UPDATE, then an INSERT for the movement) rather than a
 * multi-row batch INSERT like `insertSalesBatch` -- the create-or-update
 * branching per row doesn't reduce cleanly to Sales' "always insert" shape.
 * Fine at the current `MAX_IMPORT_ROWS` cap (10,000); a future perf pass
 * (e.g. a single `INSERT ... ON CONFLICT` per batch) is a real option if
 * that cap is ever raised, not built here.
 */
export async function insertInventoryImportBatch(db, { rows, tenantId, branchId, actorUserId, importBatchRef }) {
  let createdCount = 0;
  let updatedCount = 0;

  for (const row of rows) {
    const matchCondition = row.sku
      ? and(eq(schema.inventoryItem.branchId, branchId), eq(schema.inventoryItem.sku, row.sku), isNull(schema.inventoryItem.deletedAt))
      : and(
          eq(schema.inventoryItem.branchId, branchId),
          sql`lower(${schema.inventoryItem.name}) = lower(${row.name})`,
          isNull(schema.inventoryItem.deletedAt)
        );

    const [existing] = await db.select().from(schema.inventoryItem).where(matchCondition).limit(1);

    let item;
    if (existing) {
      const newStock = Number(existing.currentStock) + row.quantity;
      const newStockStr = newStock.toFixed(3);
      const updateValues = { currentStock: newStockStr, updatedAt: new Date() };
      if (row.lowStockThreshold !== null) updateValues.lowStockThreshold = row.lowStockThreshold.toFixed(3);
      if (row.costPerUnit !== null) updateValues.costPerUnit = row.costPerUnit.toFixed(2);
      const [updated] = await db
        .update(schema.inventoryItem)
        .set(updateValues)
        .where(eq(schema.inventoryItem.id, existing.id))
        .returning();
      item = updated;
      updatedCount += 1;
    } else {
      const [created] = await db
        .insert(schema.inventoryItem)
        .values({
          tenantId,
          branchId,
          name: row.name,
          sku: row.sku,
          unit: row.unit,
          currentStock: row.quantity.toFixed(3),
          lowStockThreshold: row.lowStockThreshold === null ? null : row.lowStockThreshold.toFixed(3),
          costPerUnit: row.costPerUnit === null ? null : row.costPerUnit.toFixed(2),
        })
        .returning();
      item = created;
      createdCount += 1;
    }

    const resultingStockStr = item.currentStock;
    await db.insert(schema.inventoryMovement).values({
      tenantId,
      branchId,
      itemId: item.id,
      movementType: 'excel_import',
      quantityDelta: row.quantity.toFixed(3),
      resultingStock: resultingStockStr,
      reason: null,
      actorUserId,
      importBatchRef,
    });

    await maybeCreateLowStockNotification(db, { tenantId, item, resultingStock: resultingStockStr });
  }

  return { importedCount: rows.length, createdCount, updatedCount };
}
