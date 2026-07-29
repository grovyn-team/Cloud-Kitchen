/**
 * P2-02 — CSV sales import: parse, validate-before-commit, batch insert.
 *
 * Design decision (documented here, fast-mode -- no DECISIONS_LOG entry):
 * one CSV row == one sale with exactly one line item. Rejected alternative:
 * an implicit multi-row-per-order grouping key (e.g. an `orderRef` column) --
 * nothing in this task's spec asks for one, real POS/CSV exports vary wildly
 * in whether/how they represent that, and inventing a grouping convention
 * the frontend/CSV producers don't know about would be a worse default than
 * the simplest predictable shape. A future "one sale, many line items" CSV
 * shape is a straightforward additive change (add an `orderRef` column,
 * group rows sharing one before insert) if a real CSV export needs it later.
 *
 * Required columns: saleDate, itemName, quantity, unitPrice.
 * Optional columns: paymentMethod, sku, taxAmount.
 *
 * Formula-injection defense (OWASP CSV injection): `itemName`/`sku` go
 * through `sanitizeCsvCell()` before ever being held in a validated row or
 * written to the DB -- see `csvSanitize.js` for the full rationale. Every
 * other column is parsed into a number/date/whitelisted-enum value before
 * being accepted, so an injection payload in those columns simply fails
 * validation (a row error) rather than being stored as a literal.
 */

import { parse } from 'csv-parse/sync';
import crypto from 'crypto';
import { schema } from '../db/dal.js';
import { PAYMENT_METHODS } from './saleService.js';
import { sanitizeCsvCell } from './csvSanitize.js';
import { isValidDateString, round2 } from '../utils/validation.js';

// (b) file size limit -- also enforced independently at the multer layer
// (`middleware/csvUpload.js`) so an oversized upload is rejected before this
// module ever sees the buffer; kept here too as the documented single source
// of truth for the number, and as a second gate if this function is ever
// called from somewhere that isn't behind multer's limit.
export const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// (c) row count limit -- an explicit business-content limit (distinct from
// the byte-size limit above), checked after parsing so a >10k-row file is
// rejected as a whole batch, not partially processed.
export const MAX_IMPORT_ROWS = 10_000;

const REQUIRED_COLUMNS = ['saleDate', 'itemName', 'quantity', 'unitPrice'];

export class CsvStructureError extends Error {}
export class CsvRowLimitError extends Error {}

/**
 * Parses a CSV buffer into an array of row objects, validating structure
 * (not content) before returning: (d) never trusts the client-declared MIME
 * type -- this is the actual parse-time structural check; malformed/binary
 * content or a header missing a required column both throw here, before any
 * row-level content validation runs.
 * @param {Buffer} buffer raw file bytes (multer memoryStorage -- never
 *   touches disk, see `middleware/csvUpload.js`).
 * @returns {Record<string, string>[]}
 */
export function parseSalesCsv(buffer) {
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
    throw new CsvStructureError(`Could not parse CSV: ${err.message}`);
  }

  if (records.length === 0) {
    throw new CsvStructureError('CSV file has no data rows.');
  }

  const headers = Object.keys(records[0]);
  const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length > 0) {
    throw new CsvStructureError(`Missing required column(s): ${missing.join(', ')}.`);
  }

  if (records.length > MAX_IMPORT_ROWS) {
    throw new CsvRowLimitError(`CSV exceeds the ${MAX_IMPORT_ROWS}-row limit (found ${records.length} rows).`);
  }

  return records;
}

/**
 * Validates every parsed row and builds the exact DB-insert-ready row shape
 * for valid ones. Never partial: the caller must check `errors.length === 0`
 * before calling `insertSalesBatch` -- this function itself does not touch
 * the DB, so "validate everything first" is structural, not a discipline the
 * caller has to remember.
 * @returns {{validRows: object[], errors: {row:number, error:string}[]}}
 */
export function validateAndBuildRows(records, { tenantId, branchId, createdByUserId }) {
  const errors = [];
  const validRows = [];

  records.forEach((record, idx) => {
    const rowNum = idx + 2; // header is row 1, so the first data row is row 2

    const saleDate = typeof record.saleDate === 'string' ? record.saleDate.trim() : '';
    if (!isValidDateString(saleDate)) {
      errors.push({ row: rowNum, error: 'saleDate is required and must be YYYY-MM-DD.' });
      return;
    }

    const itemNameRaw = typeof record.itemName === 'string' ? record.itemName.trim() : '';
    if (!itemNameRaw) {
      errors.push({ row: rowNum, error: 'itemName is required.' });
      return;
    }

    const quantity = Number(record.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      errors.push({ row: rowNum, error: 'quantity must be a positive number.' });
      return;
    }

    const unitPrice = Number(record.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      errors.push({ row: rowNum, error: 'unitPrice must be a non-negative number.' });
      return;
    }

    let taxAmount = 0;
    if (record.taxAmount !== undefined && String(record.taxAmount).trim() !== '') {
      taxAmount = Number(record.taxAmount);
      if (!Number.isFinite(taxAmount) || taxAmount < 0) {
        errors.push({ row: rowNum, error: 'taxAmount must be a non-negative number.' });
        return;
      }
    }

    let paymentMethod = null;
    if (record.paymentMethod !== undefined && String(record.paymentMethod).trim() !== '') {
      const pm = String(record.paymentMethod).trim().toLowerCase();
      if (!PAYMENT_METHODS.includes(pm)) {
        errors.push({ row: rowNum, error: `paymentMethod must be one of: ${PAYMENT_METHODS.join(', ')}.` });
        return;
      }
      paymentMethod = pm;
    }

    const skuRaw = typeof record.sku === 'string' && record.sku.trim() ? record.sku.trim() : null;
    const itemName = sanitizeCsvCell(itemNameRaw);
    const sku = skuRaw ? sanitizeCsvCell(skuRaw) : null;

    const lineSubtotal = round2(quantity * unitPrice);
    const totalAmount = round2(lineSubtotal + taxAmount);
    // Generated up front (not left to the DB default) so the sale header and
    // its one line item can be batch-inserted in two multi-row INSERTs
    // without depending on Postgres's RETURNING row order matching input
    // order for a multi-row VALUES insert -- see `insertSalesBatch` below.
    const saleId = crypto.randomUUID();

    validRows.push({
      saleId,
      tenantId,
      branchId,
      saleDate,
      paymentMethod,
      subtotalAmount: lineSubtotal.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
      createdByUserId,
      lineItem: {
        saleId,
        tenantId,
        itemName,
        sku,
        quantity: quantity.toFixed(3),
        unitPrice: unitPrice.toFixed(2),
        lineSubtotal: lineSubtotal.toFixed(2),
      },
    });
  });

  return { validRows, errors };
}

/**
 * Batch-inserts every validated row's sale header + its single line item, in
 * the CURRENT request transaction (same reasoning as `saleService.createSale`
 * -- `withTenantContext(pool)` already wraps the whole handler in
 * BEGIN...COMMIT, so a throw anywhere in this function rolls back every row
 * this call already inserted, not just the failing one). The caller
 * (`routes/sales.js`) is responsible for having already confirmed
 * `errors.length === 0` from `validateAndBuildRows` -- this function does not
 * re-check that, it only ever receives rows already proven valid.
 * @returns {Promise<number>} imported row count.
 */
export async function insertSalesBatch(db, { rows, importBatchRef }) {
  if (rows.length === 0) return 0;

  const saleValues = rows.map((r) => ({
    id: r.saleId,
    tenantId: r.tenantId,
    branchId: r.branchId,
    saleDate: r.saleDate,
    source: 'csv_import',
    importBatchRef,
    paymentMethod: r.paymentMethod,
    subtotalAmount: r.subtotalAmount,
    taxAmount: r.taxAmount,
    totalAmount: r.totalAmount,
    createdByUserId: r.createdByUserId,
  }));
  const lineItemValues = rows.map((r) => r.lineItem);

  await db.insert(schema.sale).values(saleValues);
  await db.insert(schema.saleLineItem).values(lineItemValues);

  return rows.length;
}
