/**
 * P2-02 — small, shared, dependency-free validation primitives reused by the
 * Sales module's manual-entry and CSV-import validation paths (and anything
 * else that needs a UUID/date-string check later). Not a new abstraction
 * layer over a validation library -- the rest of this codebase validates
 * request input by hand (see `routes/auth.js`'s login handler), this just
 * names the couple of checks that would otherwise be copy-pasted between
 * `saleService.js` and `salesCsvImportService.js`.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

// Strict ISO date-only format (YYYY-MM-DD), matching the `date` column type
// `sale.sale_date` uses. Deliberately does not accept a full timestamp or a
// locale-formatted date -- CSV/manual-entry callers must send this exact
// shape; anything else is a row/field validation error, not a silent coerce.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

/**
 * Round to 2 decimal places using a small epsilon nudge to avoid the classic
 * `0.1 + 0.2` binary-float artifact before formatting money for storage.
 * Money columns are `numeric(12,2)`/`numeric(14,2)` in Postgres -- this is a
 * JS-side rounding aid only, the DB column itself is the source of truth for
 * precision once stored.
 */
export function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
