# 005 — Sales CSV Upload Path — Security Review (P2-02 / P2-03)

Reviewer: security-engineer (independent re-verification, not a rubber-stamp)
Date: 2026-07-29

Scope (exactly these files, no further exploration):
- backend/src/routes/sales.js — POST /sales/import + sibling handlers
- backend/src/services/salesCsvImportService.js — parse/validate/insert
- backend/src/services/csvSanitize.js — formula-injection sanitizer
- backend/src/middleware/csvUpload.js — multer config
- backend/src/services/saleService.js — branchExistsInTenant cross-tenant gate
- backend/tests/sales.pgtest.mjs — implementer's real-Postgres verification

VERDICT: CLEAR WITH FOLLOW-UPS. No Critical, no High. The cross-tenant
branch-ID-smuggling fix is real and independently confirmed; injection is
parameterized; formula-injection defense is complete for every stored field.
The follow-ups below are all Low/Info and do NOT block P2-02/P2-03 to Done.

---

## What I verified (not taking "43/43" on faith)

### 1. CSV formula injection — PASS
- csvSanitize.js neutralizes leading = + - @ by prefixing a single-quote.
- Tab/CR-prefixed variants: handled, but IMPLICITLY via double-trim, not by the
  prefix list. csv-parse runs with trim:true AND validateAndBuildRows calls
  .trim() again before sanitizeCsvCell. A leading tab/CR/space is stripped
  before the first-char test, so it can never survive into storage as a leading
  char. Correct outcome; the mechanism is undocumented (Low-1).
- Applied to EVERY stored free-text field, not just itemName: confirmed. The
  only free-text columns reaching storage are sale_line_item.item_name and .sku,
  both sanitized (CSV path 149-150; manual path saleService.js 97-98).
  paymentMethod is a lowercased whitelist enum; saleDate is validated YYYY-MM-DD;
  money fields are Number()-parsed + toFixed(); source/importBatchRef are server
  constants/UUIDs. An injection payload in any numeric/date/enum column fails
  validation as a row error rather than being stored.

### 2. DoS surface — PASS with a Low follow-up
- File size cap: 5MB enforced by multer limits.fileSize (csvUpload.js 46) — fails
  closed at the multipart layer, before parseSalesCsv runs. limits.files:1 caps
  to a single file. Enforced by config, not app code — not bypassable.
- Decompression bomb: N/A — multer reads the raw multipart stream; nothing here
  decompresses request bodies, so 5MB is raw wire bytes (assumes no
  Content-Encoding request-decompression middleware upfront).
- Auth-before-parse ordering: csv-parse work is gated behind requireSession ->
  requireRole -> branchId validation -> isBranchAllowed -> branchExistsInTenant ->
  then parseSalesCsv (sales.js 117-135). Wrong-branch caller never triggers parse.
- Low-2: the 10k ROW cap is checked AFTER the full buffer is parsed (83-85). It
  does NOT bound parse cost — only the 5MB byte cap does. A 5MB file of minimal
  rows (~150k records) forces a synchronous csv-parse/sync pass that blocks the
  event loop before the row cap rejects it. Bounded by 5MB so modest, but a real
  availability nibble under concurrent abuse. Fix: streaming/to_line row cap, or
  lower the size cap. Non-blocking.

### 3. Path / filename handling — PASS
- multer.memoryStorage() confirmed (45); buffer lives only in req.file.buffer. No
  disk write. file.originalname used solely in a regex extension test; never
  reaches any filesystem API. No path-traversal surface.

### 4. MIME / extension trust — PASS
- csvFileFilter checks extension only and explicitly does NOT trust file.mimetype
  (28-42). The real gate is structural: parseSalesCsv throws CsvStructureError on
  malformed/binary content and on a missing required column, regardless of type.

### 5. Branch-ID-smuggling fix — PASS (independently confirmed, incl. ADMIN path)
Every branchId site in sales.js / saleService.js:
- createSale (66-80), importSales (119-128): client branchId -> isValidUuid ->
  isBranchAllowed -> branchExistsInTenant -> write. All three gates, every role.
- getRollup (192-201), listSales (224-233): branchId optional; when present, all
  three gates run. When absent, STAFF is confined to server-derived req.branchIds;
  ADMIN gets all-tenant — no client branch to smuggle.
- getSale (260-272): branchId comes from the fetched row (RLS-scoped), never
  client input; STAFF out-of-scope -> 404.
- branchExistsInTenant (260-267) works: SELECTs branch through the RLS-scoped db.
  The FK/RLS gap is genuine — sale.branch_id is a plain single-column FK, and
  Postgres FK-validation does not apply the referencing role's RLS, so
  isBranchAllowed (unconditionally true for ADMIN) plus the bare FK would let an
  ADMIN of tenant B insert tenant_id=B, branch_id=<tenant A branch>. The SELECT on
  branch IS RLS-enforced, so a foreign branch returns zero rows -> 403. The check
  is an unconditional AND-gate after isBranchAllowed — NO role path, including
  ADMIN, skips it. Verified by tests at 327-336 (manual) and 461-466 (import).
- Durable fix (composite unique(id,tenant_id) + composite FKs) correctly flagged
  to database-administrator in-comment; app-layer closure is a sufficient interim.

### 6. Injection / raw SQL — PASS
- Only raw SQL is getRollup via db.raw() (326-340): fully parameterized ($1
  period, $2 branchId/uuid[] array). The interpolated ${branchFilterSql} is one of
  two CONSTANT strings chosen by branch — never user data. period is whitelisted
  against PERIODS AND bound as a param. No concatenation of user input into SQL.
  All other reads/writes use the Drizzle builder / .values() — parameterized.

### 7. Error handling — PASS with Low follow-ups
- parse/row-limit/structure errors map to clean 413/400 bodies. Multer errors
  translated to generic 400/413 by handleUploadError (no library field names
  leak). Unexpected DB errors re-thrown; atomicity test (359-364) asserts an FK
  violation surfaces as a generic 500 with no "constraint" text.
- Low-3: parseSalesCsv surfaces the underlying parser message verbatim (line 70
  -> badRequest). Not security-sensitive (no paths/SQL/secrets), but internal
  wording; consider a generic message.
- Low-4: the 500-no-leak guarantee is proven only against the TEST harness's own
  generic handler (193-195), not the production app-level handler (outside these 6
  files). Confirm app.js / routes/v1 terminates unhandled errors with a generic
  500 (no stack, no err.message).

---

## Findings by severity

- Low-1 (A03 Injection/CSV, csvSanitize.js 22-38): tab/CR-prefixed formula
  variants neutralized only implicitly via upstream double-trim; correct but
  fragile if a future caller passes un-trimmed input. Fix: add tab/CR awareness in
  the sanitizer, or document that callers MUST pass trimmed input.
- Low-2 (A05/availability, salesCsvImportService.js 59-88): row cap checked
  post-parse; parse cost bounded only by the 5MB byte cap (~150k rows sync-parsed,
  event-loop blocking). Fix: streaming/to_line row cap, or lower size cap.
- Low-3 (A05 misconfig/info leak, salesCsvImportService.js 70): parser error text
  returned verbatim. Fix: generic "Could not parse CSV" without err.message.
- Low-4 (A09/A05, prod error handler — out of scope of these 6 files):
  no-leak-on-500 proven only against the test's own handler. Fix: confirm the prod
  terminal handler returns a generic 500.
- Test-1 (Info, sales.pgtest.mjs 502-508): formula-injection assertion covers
  item_name only, not sku; no tab/CR-prefixed variant tested. Fold a sku +
  tab-prefixed injection row into the good-batch fixture next time it is touched.

NONE of the above blocks P2-02 / P2-03 to Done. Track the Low follow-ups; do not
gate on them.
