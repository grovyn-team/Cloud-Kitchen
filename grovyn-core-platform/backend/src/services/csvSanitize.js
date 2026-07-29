/**
 * P2-02 — CSV/Excel formula-injection defense (OWASP "CSV Injection" /
 * A03-adjacent). Any cell value that starts with `=`, `+`, `-`, or `@` is a
 * potential formula trigger if the data is ever re-opened/re-exported in
 * Excel/Sheets/LibreOffice (e.g. a future GST export, or an admin exporting
 * this same sales data back out) -- those tools evaluate a leading one of
 * those four characters as the start of a formula regardless of the
 * column's declared type. This module never evaluates anything; it only
 * neutralizes the value before it is ever stored, so a stored value can
 * never re-trigger formula evaluation downstream, no matter how many times
 * it round-trips through an export.
 *
 * Applied to every free-text field sourced from user/CSV input that lands in
 * a `sale_line_item` row (`itemName`, `sku`) -- both from the CSV import path
 * AND the manual-entry JSON path (defense-in-depth: the same row could later
 * be re-exported regardless of how it was created). Money/date/enum fields
 * are excluded on purpose -- they are parsed to numbers/dates/whitelisted
 * enum values before ever reaching storage, so a formula-injection payload
 * in those fields simply fails validation instead of being stored.
 */

const DANGEROUS_PREFIXES = ['=', '+', '-', '@'];

/**
 * @param {unknown} value
 * @returns {unknown} the original value if it's not a string, or not
 *   dangerous; otherwise the same string prefixed with a single quote, which
 *   forces spreadsheet software to treat it as literal text instead of a
 *   formula, while keeping the value human-readable (not stripped/mangled).
 */
export function sanitizeCsvCell(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed.length === 0) return value;
  if (DANGEROUS_PREFIXES.includes(trimmed[0])) {
    return `'${value}`;
  }
  return value;
}
