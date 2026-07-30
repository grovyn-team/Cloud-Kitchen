# 006 — Inventory Excel/CSV Upload Path — Security Review (P2-05 backend)

Reviewer: security-engineer (independent verification, not a rubber-stamp)
Date: 2026-07-30
Prior baseline: review 005 (Sales CSV upload) — CSV mechanics inherited and already cleared.

Scope (exactly these files; plus the two targeted verification greps the task requested):
- backend/src/routes/inventoryManagement.js — POST /inventory/import + siblings
- backend/src/services/inventoryImportService.js — CSV (csv-parse) + XLSX (exceljs) parse/validate/insert
- backend/src/middleware/inventoryUpload.js — multer config
- backend/src/services/branchAccessService.js — extracted branchExistsInTenant (shared Sales+Inventory)
- backend/src/services/csvSanitize.js — formula-injection sanitizer (reused)
- backend/tests/inventory.pgtest.mjs — implementer real-Postgres verification

VERDICT: CLEAR WITH FOLLOW-UPS. No Critical, no High — does NOT block P2-05
backend to Done. The new XLSX surface is handled correctly for tenant-isolation
and formula-safety; the branchExistsInTenant extraction is a verified
no-behavior-change relocation with no regression at any Sales or Inventory call
site; the read-only exceljs claim is confirmed. One Medium (XLSX
decompression/zip-bomb + post-parse unbounded row array — availability,
shared-instance blast radius) and several Low/Info follow-ups below. Track,
do not gate.

---

## Focus-area findings

### 1. XLSX zip-bomb / decompression, and formula-cell safety

Zip-bomb / memory exhaustion — MEDIUM (A05/A06, inventoryImportService.js
119-161, 175-205). .xlsx is a ZIP(DEFLATE) container. workbook.xlsx.load(buffer)
(line 122) inflates the ENTIRE workbook into memory with no decompression-ratio
bound — exceljs enforces none. The only bound before load is the 5MB
compressed-size check (parseInventoryFile line 176, and multer limits.fileSize).
DEFLATE tops out near ~1000:1 on repetitive XML, so a <=5MB upload can inflate to
multiple GB and OOM the Node process. Strictly larger surface than the Sales CSV
path (CSV has no compression vector); the implementer correctly flagged it as
unresolved. Compounding: the MAX_IMPORT_ROWS (10k) cap is checked in
parseInventoryFile (line 200) AFTER parseInventoryXlsx has already materialized
the full records array from every sheet row — so the row cap bounds neither
load() cost nor the records-array size; only the 5MB byte cap does, indirectly.
Requires an authenticated ADMIN/STAFF, but one malicious/compromised tenant user
can degrade the shared instance for ALL tenants — that cross-tenant availability
blast radius is why this is Medium, not Low. Recommend: (a) lower the XLSX size
cap materially (e.g. 1-2MB) OR enforce a hard container memory limit (Docker
--memory) so a bomb kills one request not the host; (b) reject workbooks whose
declared dimensions exceed MAX_IMPORT_ROWS before iterating rows, if exceljs
exposes dimensions pre-materialization. Not a merge blocker.

Formula-cell handling — PASS (correct on inspection; see Test-3). cellToString
(95-113) never reads formula TEXT: a formula cell ({ formula, result }) hits the
'result' in value branch (line 107) and uses the cached RESULT only, recursing so
a nested error/null result normalizes to ''. Hyperlink cells ({ text, hyperlink })
return the label text, not the URL — no SSRF, the URL is discarded. Rich text
concatenates run text. The result then flows through the SAME
validateAndBuildRows -> sanitizeCsvCell path as CSV (name/sku/unit sanitized;
quantity/threshold/cost are Number()-parsed so a formula payload there fails
validation rather than storing). Module never triggers evaluation. Correct — but
the test does not exercise this branch (Test-3 below).

### 2. exceljs read-only claim — VERIFIED (Info: residual supply-chain)
Grep of backend/src for xlsx.write|writeBuffer|writeFile: the ONLY hit is the doc
comment in inventoryImportService.js line 28. The single live call is
workbook.xlsx.load (line 122). No production path invokes the vulnerable
archiver -> glob/minimatch/brace-expansion write chain (GHSA-mh99-v99m-4gvg).
Claim confirmed: installed-but-never-invoked. The test harness DOES call
workbook.xlsx.writeBuffer() (inventory.pgtest.mjs 335) to build fixtures —
test-only, ships nothing. Residual = any FUTURE write path reaches the vuln.
Follow-ups: (Low-A) add npm audit / audit-ci as a standing CI gate; (Info) track
the advisory so a future export feature does not silently reintroduce it.

### 3. branchExistsInTenant reuse — PASS (no regression, both modules)
Single verbatim definition now in branchAccessService.js (31-38); saleService.js
re-exports it under the original name (line 258), so Sales call sites are
unchanged by construction. Grep confirms every call site still gates:
- Sales (sales.js 78, 126, 199, 231): createSale / importSales unconditional;
  getRollup / listSales conditional-on-branchId-present. Matches review 005.
- Inventory (inventoryManagement.js 103, 208, 289, 356): createItem, importItems,
  createRequest unconditional; listItems conditional-on-branchId-present.
Each is an AND-gate AFTER isBranchAllowed with NO role bypass — the ADMIN path
(isBranchAllowed unconditionally true for ADMIN) is still closed by the
RLS-scoped SELECT on branch, so a foreign-tenant branch id returns zero rows ->
403. Tenant-isolation property from 005 holds. Test-verified: cross-tenant
smuggling -> 403 for create (397), import (571), request (683).

### 4. Sale-triggered decrement — PASS on tested behavior; one caveat
decrementForSaleLineItems lives in inventoryManagementService.js, OUTSIDE my read
scope ("read exactly these files"), so I verify via the real-DB test assertions +
the RLS model rather than the source:
- Branch-mismatch skip is genuinely enforced, not just documented:
  inventory.pgtest.mjs 751-763 puts an item in BRANCH_A2, sells it under
  BRANCH_A1, asserts sale succeeds AND item2 stock is UNCHANGED — a DB-readback
  assertion, not a mock.
- Cross-module atomicity: 765-799 — a bad-FK line item rolls back the whole tx
  including the valid line decrement and its movement row. Verified.
- Cross-TENANT vector: the decrement runs in the RLS-scoped request tx
  (req.tenantId), and getItemById is RLS-scoped (proven by the cross-tenant 404
  read tests 541-542), so a foreign-tenant inventoryItemId in a sale line returns
  null -> skipped exactly like a branch mismatch. Mechanism is sound. CAVEAT
  (Test-1): no dedicated test uses a DIFFERENT-TENANT item id in a sale line —
  only different-BRANCH-same-tenant. Same RLS gate proven elsewhere, so a coverage
  gap, not a believed hole.

### 5. Baseline (parity with review 005)
- Size cap before parse — PASS. multer limits.fileSize 5MB + files:1 fails at the
  multipart layer (inventoryUpload.js 37); parseInventoryFile re-checks
  buffer.length BEFORE dispatching to any parser (176) — for XLSX this is before
  load(). Defense-in-depth intact.
- Row cap — see Medium above (post-parse; does not bound parse/load cost).
- memoryStorage only — PASS (inventoryUpload.js 36). Buffer lives only in
  req.file.buffer; no disk write.
- Filename — PASS. originalname used solely in regex extension tests
  (inventoryUpload.js 26, inventoryImportService.js 182-183). Never reaches an fs
  API. No path-traversal surface.
- MIME trust — PASS. Extension-only filter; explicitly does not trust
  file.mimetype. Structural validation at parse time is the real gate.
- Raw SQL / injection — PASS. insertInventoryImportBatch uses the Drizzle builder
  + .values() throughout; the one sql-template lower(name)=lower(row.name) (311)
  binds row.name as a PARAMETER, not string concatenation. No user data is
  concatenated into SQL. createRequest insert is parameterized via .values().
- Error-response leakage — Low (A05). parseInventoryXlsx (124) and
  parseInventoryCsv (84) surface the underlying parser err.message verbatim in the
  400 body. For exceljs on a malformed ZIP this can leak library-internal wording.
  No paths/SQL/secrets. Same as 005 Low-3; recommend a generic message.

---

## Findings by severity

- MEDIUM (A05/A06, availability — inventoryImportService.js 119-161, 175-205):
  XLSX decompression/zip-bomb via unbounded xlsx.load, plus post-parse unbounded
  records-array (row cap checked after full materialization). <=5MB compressed ->
  multi-GB inflate -> OOM affecting the shared multi-tenant instance. Fix: lower
  XLSX size cap and/or hard container memory limit; reject over-dimension sheets
  pre-materialization if feasible. Does NOT block Done.
- Low-A (A06): add npm audit / audit-ci as a standing CI gate; the exceljs
  write-chain vuln (GHSA-mh99-v99m-4gvg) is installed-but-dormant and should be
  tracked so a future export path does not silently activate it.
- Low-B (A05 info-leak, inventoryImportService.js 84, 124): parser err.message
  returned verbatim on parse failure. Use a generic message.
- Low-C (A09/A05, carried from 005 Low-4, outside these 6 files): the
  no-leak-on-500 guarantee is proven only against the test harness own generic
  handler (inventory.pgtest.mjs 245-247). Confirm the PRODUCTION terminal error
  handler returns a generic 500 (no stack, no err.message).
- Test-1 (Info): no cross-TENANT inventoryItemId in a sale line item is tested —
  only cross-branch/same-tenant. Add one for completeness (mechanism sound via RLS).
- Test-2 (Info): no zip-bomb / high-ratio XLSX fixture — the Medium above is
  untested. Add a decompression-ratio fixture when the cap fix lands.
- Test-3 (Info, inventory.pgtest.mjs 640-660): the XLSX "formula" fixture uses
  sheet.addRow(['=1+1', ...]), which exceljs stores as a plain STRING cell, not a
  live formula object. So the cellToString formula-cell branch ('result' in value,
  line 107) — the exact code point focus-area #1 asked about — has ZERO test
  coverage; the test only re-exercises the string-looks-like-formula
  (CSV-equivalent) path. Add a real cell.value = { formula, result } fixture to
  prove the cached-result path.

None of the above is Critical or High; per the Definition-of-Done gate none blocks
the P2-05 backend row from moving to Done. Track the Medium and the Low
follow-ups.
