# 007 - Tax (GST) Module - Security Review (Phase 6)

Reviewer: security-engineer (independent verification, not a rubber-stamp)
Date: 2026-07-31
Prior baselines reused: 005 (Sales CSV - sanitizeCsvCell, branchExistsInTenant,
raw-SQL parameterization), 006 (Inventory - same branchExistsInTenant extraction),
CRITIQUE 018 / SECURITY_REVIEWS/003 (reply() branded envelope,
commit-before-response), CRITIQUE 016 (_journal.json registration check).

Scope: the files the task named + two targeted verifications the focus areas
require outside them: _journal.json and the partial-unique-index definition the
upsert's ON CONFLICT depends on (0006_eager_wildside.sql:179; schema.js:1110-1112).

## VERDICT: CLEAR WITH FOLLOW-UPS

No Critical, no High. The two properties the task flagged as most likely to hide a
real bug - money-computation integrity (#1) and idempotent-upsert concurrency (#5)
- both hold, and hold by construction, not just by assertion. Follow-ups below are
Low/Info and do NOT block the Phase 6 Tax row to Done.

---

## Focus-area findings

### 1. Money-computation integrity - PASS (verified directly, the key property)
- computeGstFromSales (taxService.js 104-126) is a real SQL aggregation that SUMs
  subtotal_amount -> taxableAmount and tax_amount -> taxAmount directly from the
  sale table. There is NO arithmetic on gstRate anywhere in the query or the JS.
- gstRate is resolved on a SEPARATE path (getTenantTaxSettings -> resolveGstRate,
  70-89) and only ever stored/emitted as a descriptive label: upsertPeriodSummary
  writes gstRate.toFixed(2) into its own column and never multiplies it into
  taxableAmount/taxAmount (passed through verbatim as .toFixed(2) of the real
  SUMs). serializeSummary (223-235) emits row.gstRate, row.taxableAmount,
  row.taxAmount straight from the persisted row. I traced every write and read of
  all three fields: no code path lets a tenant-configurable rate feed the reported
  money. A misconfigured tenant.settings.tax.gstRate changes only the label, never
  the figures a CA reconciles. Exactly the D-007 property asked for, genuinely true.
- Test corroboration is real, not a "34/34" wave-through: tenant B carries
  settings.tax.gstRate=12 yet its taxAmount asserts to the recorded 15.00 (not 12%
  of 300 = 36.00) - a direct disproof of any rate-derived path (tax.pgtest.mjs
  425-428, seed 106-109). Soft-deleted + out-of-window rows proven excluded (408).
- resolveGstRate is hardened against NaN/Infinity/out-of-range (0-100 clamp, finite
  check) - a garbage settings value falls back to 5.0, never poisons even the label.

### 2. A01 Access control - PASS
- ADMIN-only on BOTH routes, enforced at the router level (requireRole(['ADMIN'])),
  not in-handler - matches finance/summary. Test proves STAFF -> 403 on /summary AND
  /export (391, 394): the gate is on route composition, not something a handler
  could forget.
- Cross-tenant/branch isolation: parseAndAuthorize (62-97) runs the same two-gate
  discipline reviews 005/006 cleared - isBranchAllowed (role/own-branch scope) AND
  branchExistsInTenant (RLS-scoped SELECT on branch; a foreign branch id returns
  zero rows -> 403). No role path, including ADMIN, skips the second gate. No
  regression vs. Sales/Inventory: same shared branchAccessService.branchExistsInTenant.
  Test proves cross-tenant branchId smuggling -> 403 on /summary (399-400) and
  /export (487-488).
- periodStart/periodEnd/branchId cannot be manipulated to reach another tenant's
  data: branchId is UUID-validated then ownership-verified; the aggregation runs on
  the RLS-scoped db, so a valid-but-foreign branch id is already excluded by RLS
  before the ownership gate. tenantId comes from req.tenantId (session-derived,
  never a query param). Dates are validated YYYY-MM-DD with start <= end and are
  bound params - they only widen/narrow the window WITHIN the caller's own tenant.

### 3. A03 Injection - PASS
- The only raw SQL (computeGstFromSales, 105-118) is fully parameterized:
  branchId/periodStart/periodEnd are $1/$2/$3 bound params, zero string
  interpolation. Everything else uses the Drizzle builder / .values() /
  .onConflictDoUpdate() - parameterized.
- CSV formula injection: branchName - the only tenant-editable free-text field
  reaching the file - goes through sanitizeCsvCell (buildCsvExport, 268) which
  neutralizes leading = + - @ (and, via its internal .trim() before the first-char
  test, tab/CR-prefixed variants - same mechanism review 005 Low-1 noted). All
  other CSV cells are server-controlled: branchId (validated UUID),
  periodStart/periodEnd (validated dates), gstRate/taxableAmount/taxAmount (DB
  numerics), saleCount (int) - none is attacker free-text, so routing them through
  escapeCsvCell (RFC-4180 quoting) rather than sanitizeCsvCell is correct, not a
  gap. Sanitize-then-escape ordering is safe (the ' prefix applied first, then
  CSV-quoted). Test confirms the branch name lands in the body (483).

### 4. replyRaw envelope - PASS (no weakening of reply()'s properties)
- Commit-before-response preserved: replyRaw only constructs a branded plain
  object; the terminal res.set()/res.send() happens in withTenantContext (269-273)
  AFTER runInTenantContext has already COMMIT+DISCARD ALL+released (or rolled back).
  The CSV path uses the identical return-a-value-then-respond discipline as reply()
  - it never touches res inside the transaction, so the res.on('finish')
  post-hoc-commit footgun the module was built to avoid is still avoided.
- Branded-envelope non-confusability preserved: RAW_REPLY_ENVELOPE is a
  module-private Symbol, same technique as REPLY_ENVELOPE (CRITIQUE 018 F1).
  Ordinary tenant data can never own it, so a data row with status/body/headers
  columns cannot be mistaken for a raw envelope. Dispatch order in wrap (raw ->
  reply -> plain 200) is unambiguous - each check keys on a distinct private Symbol,
  not on duck-typed property names.
- Header-injection angle (specifically chased): the ONLY replyRaw call
  (routes/tax.js 161-164) sets Content-Type (constant) and Content-Disposition
  whose interpolated filename is gst-summary_<branchId>_<periodStart>_to_<periodEnd>.csv
  - every component is already validated (branchId UUID regex, dates YYYY-MM-DD
  regex) and cannot contain CR/LF/". The tenant-controlled branchName is
  deliberately NOT in the header, only in the body. No CRLF/header-splitting vector
  exists today; Node's http layer also rejects CR/LF header values as
  defense-in-depth. See Low-1 for the residual design note.

### 5. Idempotent upsert under concurrency - PASS (real ON CONFLICT, not TOCTOU)
- upsertPeriodSummary (141-185) uses onConflictDoUpdate targeting
  (tenantId, branchId, periodStart, periodEnd, gstRate) with
  targetWhere: isNull(deletedAt) - a genuine DB-level upsert, NOT a
  check-then-insert. I confirmed the backing partial unique index actually exists
  and matches: tax_period_summary_active_unique_idx on exactly those five columns
  WHERE deleted_at IS NULL (0006_eager_wildside.sql:179; schema.js:1110-1112). The
  targetWhere repeats the index's partial WHERE verbatim, which Postgres requires to
  infer a partial unique index - so ON CONFLICT binds to the index rather than
  throwing "no matching constraint".
- Concurrency outcome: two near-simultaneous requests for the same
  tenant/branch/period/rate - the unique index serializes them; one INSERTs, the
  other takes the DO UPDATE branch. Exactly one active row, no duplicate, no partial
  row (every column supplied on both insert values and update set, atomically). The
  "idempotent" claim is sound.
- Evidence: the test proves sequential idempotency (exactly ONE persisted row after
  repeated calls, 443-457) and, indirectly, that the partial index exists and is
  inferable - had the ON CONFLICT/index pairing been wrong, the second call would
  500 rather than return 200 with one row. A truly-concurrent (parallel) test is not
  present; the property holds by construction, so this is an Info coverage note, not
  a hole (Test-1).

### 6. Composite-FK migration 0012 - PASS
- Registered correctly: _journal.json idx 12, tag
  0012_tax_period_summary_branch_composite_fk, matching the filename exactly (the
  same registration check CRITIQUE 016 did for 0001/0004). Applies in sequence on a
  fresh cluster.
- Content is sound: drops the single-column FK
  (tax_period_summary_branch_id_branch_id_fk) and adds the composite FK on
  (branch_id, tenant_id) REFERENCES branch(id, tenant_id) - the same tenant-pinning
  hardening reviews 005/006 established for sale, closing the ADMIN-cross-tenant-
  insert gap at the DB layer (previously only app-layer). The DROP CONSTRAINT has no
  IF EXISTS, so on any cluster missing the old name it fails LOUD (errors the
  migration), not silently - acceptable; the old name is Drizzle's deterministic
  default from 0006, present on the real chain.
- Test verifies the constraint actually bites via the BYPASSRLS migrator connection
  (so it's the FK, not RLS, being tested): a tenant_id=A / branch_id=<B's branch>
  insert is rejected with SQLSTATE 23503, and the matching pair is accepted
  (verifyCompositeFk, 228-269). Real proof the composite FK is live, not just declared.

### 7. D-007 disclaimer positioning - PASS
- CA_REVIEW_DISCLAIMER is a single exported constant, emitted UNCONDITIONALLY in
  both shapes: serializeSummary always sets disclaimer (233), and buildCsvExport
  always pushes it as the literal first line of the file (257). No route parameter,
  format flag, or branch can suppress either - there is no conditional around either
  emission. Test proves both: JSON field equals the constant verbatim (413-416) and
  the CSV body contains it verbatim (477-481).

---

## Findings by severity

- Low-1 (A05/Insecure-design, tenantContext.js 134-136 / routes/tax.js 161-164):
  replyRaw accepts an ARBITRARY headers map and applies it with res.set(). Today's
  sole caller passes only validated values, so no injection exists. But the
  primitive imposes no constraint - a FUTURE handler could pass a tenant-influenced
  string (e.g. a user-supplied filename, or a value with CR/LF) into a header and
  reintroduce a header-injection/response-splitting angle that reply() (JSON-only,
  fixed headers) structurally cannot have. Recommend: document replyRaw's contract
  ("callers MUST pass only server-controlled, CRLF-free header values") in its doc
  comment, or have replyRaw reject header values containing CR/LF. Non-blocking;
  defense-in-depth on a currently-safe path.

- Low-2 (A04/data-hygiene, taxService.js 141-185): gstRate is part of the ON CONFLICT
  target. If a tenant changes settings.tax.gstRate between two /summary calls for the
  same period, the second call inserts a SECOND active row (old-rate + new-rate both
  deleted_at IS NULL) rather than updating the first - so "one active row per period"
  is only true while the rate is stable. Not a corruption and not served wrong (both
  endpoints return the freshly-upserted current-rate row via .returning(), and money
  is rate-independent so both rows' figures match), but stale old-rate rows accumulate
  and any future non-rate-filtered reader of tax_period_summary would see duplicates.
  Recommend: on rate change, soft-delete/supersede prior active rows for the period,
  OR key the conflict on period only and treat gst_rate as a plain updatable column.
  Non-blocking; flag to database-administrator / project-planner as a modeling call.

- Low-3 (A09, carried from 005 Low-4 / 006 Low-C - outside these files): the
  no-leak-on-500 guarantee is again proven only against the test harness's own generic
  error handler (tax.pgtest.mjs 286-288). Confirm the PRODUCTION terminal handler
  returns a generic 500 (no stack, no err.message). Standing item, not Tax-specific.

- Test-1 (Info, tax.pgtest.mjs 443-457): idempotency proven SEQUENTIALLY only; no
  truly-parallel request test. The concurrency property holds by construction (partial
  unique index + ON CONFLICT), so this is a coverage nicety, not a believed hole. Add
  a Promise.all() double-fire fixture when the file is next touched.

- Test-2 (Info): no CSV formula-injection fixture - the sanitizeCsvCell branch on
  branchName (a leading =/+/-/@ branch name) has no direct assertion here (mechanism
  inherited-and-cleared from 005/006). Fold a branchName='=cmd()' fixture asserting the
  leading ' into the export test.

None of the above is Critical or High; per the Definition-of-Done gate none blocks the
Phase 6 Tax row from moving to Done. Track the Lows (Low-1 and Low-2 warrant an explicit
owner); the money-integrity (#1) and idempotent-upsert (#5) properties - the two the
task singled out - are confirmed sound.
