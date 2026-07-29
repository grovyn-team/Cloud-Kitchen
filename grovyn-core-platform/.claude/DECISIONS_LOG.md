# DECISIONS LOG

> Append-only. Any agent that makes a non-trivial technical/product decision
> (schema choice, library choice, tenancy model, auth strategy, etc.) logs it
> here in this format. Never delete or rewrite past entries — supersede them.

## Format

```
### D-00X — <short title>
- Date:
- Raised by:
- Decided by:
- Context: why this came up
- Decision: what was decided
- Alternatives considered:
- Consequences / follow-ups:
- Status: Proposed | Accepted | Superseded by D-00Y
```

---

> **CRITIC-GATE STATUS (updated 2026-07-28 by decision-critic — supersedes the
> prior integrity notice).** The critic gate on D-001, D-002, D-006–D-012 is now
> **satisfied by a genuine `decision-critic` subagent run** — see
> `CRITIQUES/013-genuine-critic-first-pass.md`. Every `**Critic verdict —**` line
> below was rewritten by that run to a real, independent verdict; the earlier
> versions (authored by the unregistered main session role-playing the critic, with
> `009`–`012` falsely claiming to be the registered critic) are preserved as the
> historical record in `CRITIQUES/001`–`012` with in-file correction banners, and
> are no longer cited as the gate. **One BLOCKING finding stands and is relayed to
> the user verbatim** (see D-008): the crypto-shredding one-way door (P1-13) is
> currently gated *after* the migration that creates user PII (P1-01), and user/
> staff PII is outside D-008's stated "customer PII" scope — this must be resolved
> before P1-01 runs. All other verdicts are Endorse / Endorse-with-changes. Where
> the genuine review diverged from the self-reviews is recorded in CRITIQUE 013.

### D-001 — Tenancy model & database engine
- Date: 2026-07-28
- Raised by: Database Administrator (via Phase 0)
- Decided by: **Awaiting Project Master / user sign-off**
- Context: The target product is multi-tenant SaaS (`PROJECT_BRIEF.md` §1–2).
  The current template has no persistence and no tenant concept. A tenancy model
  must be fixed before any schema or backend persistence work starts, because it
  dictates every table, every query, and the auth middleware design.
- Decision (**Proposed**): **PostgreSQL**, single shared database, **shared
  schema with a mandatory non-nullable, indexed `tenant_id` on every
  tenant-scoped table** (and `branch_id` where relevant). Enforce isolation in
  two layers: (a) a server-side tenant guard in middleware that derives
  `tenant_id` from the authenticated session — never from client input — and
  (b) a data-access layer that requires a tenant scope on every query so a
  missing scope fails closed. Adopt Postgres **Row-Level Security (RLS)** as a
  defense-in-depth backstop in a later hardening phase (not Phase 1 blocking).
- Alternatives considered:
  - **Schema-per-tenant**: stronger isolation, but painful migrations at scale
    (run every migration N times), heavier connection/pooling cost. Overkill for
    SMB/mid-market restaurant chains at launch.
  - **Database-per-tenant**: strongest isolation, highest ops cost and cost-per-
    tenant; justified only by a hard compliance/residency requirement we don't
    have yet. Revisit if an enterprise client contractually requires it.
  - **Shared-schema + `tenant_id` (chosen)**: best migration ergonomics and
    cost at this scale; isolation strength depends on disciplined enforcement —
    which is exactly why the DAL-level fail-closed rule and (later) RLS matter.
- Consequences / follow-ups: Every table, index, and query is affected. Security
  Engineer treats cross-tenant access as a standing review item. Composite
  indexes keyed on `(tenant_id, branch_id, date)` for sales/inventory rollups.
- **Amendment (2026-07-28, user):** Enable Postgres **Row-Level Security in
  Phase 1**, not as a later hardening backstop. RLS is cheap to write into initial
  migrations and painful to retrofit onto a live schema holding financial data.
  Requires: the connection-context strategy (`SET LOCAL app.current_tenant` in a
  pooled transaction), a BYPASSRLS role for migrations/seed, and app-layer DAL
  kept as the **primary** enforcement with RLS as backstop.
- Status: **Accepted (amended: RLS in Phase 1).**
- **Critic verdict (genuine, 2026-07-28) — Endorse (Significant, one-way door).**
  The override is right; the *self-sufficient* reason is retrofit cost onto live
  regulated data (verified: no ORM/schema/migrations exist yet, backend deps are
  only `cors`+`express`), not the pooling story. **Diverge from CRITIQUE 009:** its
  "PgBouncer risk retired because infra is single-container / ORM owns its pool" is
  built on an *unbuilt* premise — the repo ships **only** Vercel serverless
  (`vercel.json`, `DEPLOY.md`); D-006 single-box is Phase-7 intent with no owner.
  Risk is *conditionally mitigated if D-006 is built as specified and serverless is
  never reintroduced*, not retired. Required (001's three stand): P1-00 spike before
  first migration; BYPASSRLS role + context middleware first-class; DAL primary /
  RLS backstop; plus 009's two-sided P1-10 isolation test; plus **spike must target
  the D-006 model and treat `vercel.json`/`DEPLOY.md` as dead residue**. Same-model
  self-review flagged. See `CRITIQUES/013-genuine-critic-first-pass.md`
  (supersedes the self-authored line in `CRITIQUES/001`, `009`).

### D-002 — ORM choice
- Date: 2026-07-28
- Raised by: Database Administrator (via Phase 0)
- Decided by: **Awaiting Project Master / user sign-off**
- Context: Node 20 / Express 4 / ESM backend needs an ORM/migration tool to move
  off in-memory data. Must have first-class migrations and good TypeScript story
  (the frontend contract is TS).
- Decision (**Proposed**): **Prisma**. Rationale: best-in-class migration
  workflow (`prisma migrate`), generated types we can share with the TS
  frontend contract, mature Postgres support, and a query API that makes the
  "every query carries `tenant_id`" rule easy to centralize behind a scoped
  client. Trade-off accepted: Prisma's engine adds a runtime dependency and its
  raw-query escape hatch must be security-reviewed when used.
- Alternatives considered:
  - **Drizzle**: lighter, SQL-first, great types, no engine binary; younger
    migration ecosystem. Strong second choice — pick this if we want thinner
    runtime and are comfortable writing more SQL.
  - **Sequelize**: mature but weaker TS ergonomics and clunkier migrations;
    not preferred for a TS-contract product.
- Consequences / follow-ups: If Prisma, add a scoped-client wrapper so callers
  cannot issue an unscoped tenant query by accident. Migrations become the only
  way schema changes ship (no hand edits).
- **Update (2026-07-28):** Deployment is now locked to Docker/Dokploy with a
  long-lived Postgres pool (D-006), which makes Prisma safe on the pooling axis —
  but the amended D-001 (RLS in Phase 1) reintroduces a Prisma sharp edge
  (`SET LOCAL` on the same pooled connection as the query). **Resolve via the
  P1-00 spike** (prototype the RLS-pooling pattern in Prisma *and* Drizzle, pick
  on the result) before writing the first migration.
- **Resolution (2026-07-29, Database Administrator — P1-00 spike executed):**
  **Adopt Drizzle** (`drizzle-orm` + `drizzle-kit`). Full spike doc:
  `spikes/p1-00-rls-pooling/SPIKE.md` (pre-registered criteria, raw evidence,
  reproduction instructions — nothing in it was edited after the run).
  - Ran a real throwaway `postgres:16-alpine` container (Docker, no PgBouncer,
    matching the D-006 single-box/long-lived-pool target — `vercel.json` was
    not touched), two isolated databases, a non-`BYPASSRLS` `grovyn_app`
    runtime role, 5 tenants × 20 rows, pool size 10.
  - **Both candidates passed all 5 binary gates identically** — transaction↔
    connection affinity, no cross-checkout leakage, 150 concurrent-request runs
    (50×3 repeats, pool=10 < N=50) with **zero cross-tenant reads**, fail-closed
    on missing context, and real privilege separation
    (`grovyn_app.rolbypassrls=false` verified via `pg_roles`). This validates
    the RLS+pooled-single-box pattern itself (D-001/D-006) — no escalation
    needed, the approach is sound regardless of which ORM was picked.
  - **Decided on gate 7 (migration workflow survives RLS), promoted to a hard
    gate per the critic's sharpening.** Empirically: `schema.prisma` has zero
    DSL for RLS — `prisma migrate dev --create-only` against the RLS-unaware
    schema produced a literal, verified-empty migration file, and `ENABLE ROW
    LEVEL SECURITY` / `FORCE` / `CREATE POLICY` all had to be hand-typed in
    before `prisma migrate dev` would apply them. Drizzle's `pg-core` has
    native `pgPolicy()` + `.enableRLS()` schema primitives; `drizzle-kit
    generate` auto-produced the `ENABLE ROW LEVEL SECURITY` and full `CREATE
    POLICY ... USING (...)` statements verbatim from `schema.ts` with **zero**
    hand-written SQL. (`FORCE`/`GRANT` needed one small hand-written custom
    migration in *both* — not a differentiator; `CREATE POLICY`, the actual
    tenant-isolation predicate, being auto-generated in one and 100% manual in
    the other, is.) This is exactly the "RLS erodes the ORM ergonomics that
    justified it" risk D-001 flagged, now failing concretely and repeatedly
    (once per tenant-scoped table, for the life of the project) under Prisma.
  - Latency: both well inside the pre-registered budget (≤15ms p50 / ≤40ms p95
    interactive-transaction-wrapper overhead) — Prisma 3.43ms/3.62ms, Drizzle
    2.65ms/2.85ms (p50/p95) on localhost. Not decisive on its own; recorded per
    the pre-registration requirement.
  - Prisma 7 also surfaced an unplanned migration-workflow wrinkle unrelated to
    RLS: it removed schema-level `datasource.url` in favor of
    `prisma.config.ts` + a driver adapter (`@prisma/adapter-pg`) — extra
    ceremony that had to be worked around to even run the spike. Noted as
    corroborating evidence, not counted as a separate gate.
  - Consequence: P1-01 (minimal migrations) proceeds on Drizzle. Backend adds
    `drizzle-orm`/`drizzle-kit`/`pg` as dependencies; `backend/package.json`
    currently has none. Every tenant-scoped table's RLS policy is defined via
    `pgPolicy()`/`.enableRLS()` in the schema, not hand-appended SQL, going
    forward — the DAL fail-closed wrapper (P1-03) remains primary enforcement
    regardless, RLS is the backstop per D-001.
- Status: **Accepted — Drizzle, resolved by P1-00 spike (evidence:
  `spikes/p1-00-rls-pooling/SPIKE.md`); decision-critic re-review COMPLETE and
  the gate is SATISFIED (CRITIQUE 015). P1-01 is unblocked to author migrations
  on Drizzle.** One Significant, non-optional correction is carried forward to
  **P1-02** (it does not affect the ORM choice or P1-01): set per-request tenant
  context via `set_config('app.current_tenant', $1, true)` with a **bound
  parameter**, not via string interpolation into raw SQL. The spike's conclusion
  that a raw/unsafe interpolation path is "unavoidable" is false — `set_config`
  with `is_local=true` is parameter-bindable and transaction-scoped like
  `SET LOCAL`; UUID validation stays as defense-in-depth, not the primary control.
- **Prior critic verdict (genuine, 2026-07-28, on the spike's criteria before it
  ran) — Endorse the spike + its criteria (Minor; two-way now, hardens fast).**
  Don't lock Prisma by inertia. CRITIQUE 010's pre-committed PASS/FAIL criteria
  are genuinely decisive (binary, pre-registered, anti-rationalization; gate 1
  transaction↔connection affinity is the decisive one) — concur. **Sharpening:**
  promote gate 7 (migration workflow survives RLS) from tie-breaker toward a
  hard gate, since RLS-forcing-manual-SQL is the exact failure D-001 worried
  about; and pre-register a latency budget for the interactive-transaction
  wrapper. See `CRITIQUES/013-genuine-critic-first-pass.md` (supersedes lines in
  `CRITIQUES/001`, `010`). **This sharpening is what gate 7 above applied, and
  is the actual deciding factor in the executed spike.**
- **Critic verdict (genuine, 2026-07-29, independent re-review of the executed
  spike) — ENDORSE DRIZZLE; Endorse-with-changes (Significant). Gate SATISFIED,
  P1-01 unblocked.** Verified the harness code, generated/hand-written migration
  artifacts, SQL bootstrap/seed, and the non-BYPASSRLS runtime role directly
  against the repo (did not re-execute the container; verified the harness is
  genuinely *capable* of detecting the failures it reports zero of). Gate 3 is a
  real 5× pool-oversubscription contention test that would catch a broken
  transaction↔connection affinity or any cross-tenant bleed — not a toy. Pre-
  registration is binary and externally anchored to CRITIQUES 010/013 (provenance
  caveat: uncommitted, so no git-timestamped freeze — anchor it in a commit next
  time). Gate 7 is the correct decider and nothing in the results should have
  outranked it; latency was non-decisive as pre-declared. **Self-review flagged:**
  these criteria were specified by my own prior run (CRITIQUE 013), so I attacked
  "gate 7 is decisive" hardest — and found a real gap my prior framing missed
  (below), which is why this is not a rubber stamp. **Non-optional changes:**
  (1) the cross-cutting SET LOCAL finding is TRUE but its remedy is WRONG — P1-02
  must use `set_config(..., $1, true)` parameter-bound, not raw interpolation +
  regex; amend SPIKE.md's "unavoidable" claim. (2) Do not carry the "drift caught
  forever" claim into P1-01 as proven — only initial generation was tested; verify
  `WITH CHECK`/per-role policy emission when P1-01's real tables need them.
  *Objection tried:* "Blocking — wrong control on the tenancy chokepoint is a
  one-way security door." *Why it fails:* P1-02 is unbuilt, the fix is a one-line
  spec change with no data/schema committed to it, and the ORM decision it attaches
  to is sound and unaffected — Significant, not Blocking. See
  `CRITIQUES/015-d002-spike-independent-rereview.md`.

### D-003 — Fix broken `npm run verify` (missing password field)
- Date: 2026-07-28
- Raised by: Backend Developer (Phase 0 stabilization)
- Decided by: Executed under kickoff authorization (low-risk stabilization).
- Context: `backend/tests/system.test.js` posted `{ email, role }` to
  `/api/v1/auth/login`, but `auth.js` now requires a `password`. Login returned
  400, so `sessionToken` was absent and every authenticated assertion failed.
- Decision: Added a `DEMO_PASSWORD` constant to the test
  (`process.env.AUTH_DEMO_PASSWORD || 'grovyn@123'`) and included `password` in
  both login POST bodies. Also replaced the test's infinite health-retry loop
  with a single fail-fast (`waitForHealth` already polls for `MAX_WAIT_MS`; the
  old code retried it forever, which turned a port conflict into a hang).
- Alternatives considered: Deleting the failing assertions (rejected — hides the
  regression, violates the kickoff's explicit "don't delete the test").
- Consequences / follow-ups: The test still depends on the hardcoded demo
  password. When D-005 (real auth) lands, the verify harness must switch to a
  seeded test user. **Runtime-confirmed PASS is still pending** — the backend
  has no installed `node_modules` in this environment (`express` missing), so
  the suite can't be run until `npm install` is done. Code fix is complete and
  correct by inspection.
- Status: **Accepted** (code applied; runtime re-run pending dependency install).

### D-004 — "Uncommitted Vite 5→8 bump" does not exist
- Date: 2026-07-28
- Raised by: Frontend Developer (Phase 0 stabilization)
- Decided by: Finding of fact.
- Context: The kickoff and `PROJECT_BRIEF.md` §5 describe an uncommitted Vite
  `^5.4.10 → ^8.1.5` bump with dirty lockfiles to evaluate/commit/revert.
- Decision: **No action — there is nothing to bump.** `frontend/package.json`
  pins `vite ^5.4.10` in the working tree and in **every commit in git
  history** (`git log -p -- frontend/package.json` shows only `^5.4.10`). The
  working tree is clean except `backend/.gitignore` (staged) and untracked
  `.claude/`. There are no dirty lockfiles. T-004 is closed as not-applicable.
- Consequences / follow-ups: If a Vite 8 upgrade is desired later, it becomes a
  fresh, scoped task (build + dev-server + UI smoke + `npm audit` + security
  review), not a pending merge. `PROJECT_BRIEF.md` §5 item 4 should be marked
  resolved/incorrect.
- Status: **Accepted (no-op) — SUPERSEDED same day.**
- **Supersede note (2026-07-28, later same day):** The bump has since **appeared
  in the working tree** — `git diff frontend/package.json` shows
  `- "vite": "^5.4.10"` → `+ "^8.1.5"` (plus lockfile), uncommitted and untested.
  So D-004's "does not exist" is stale. **Re-opened as an isolated task**
  (P0-07): build + dev-server smoke + `npm audit` + `@vitejs/plugin-react` compat
  + security-engineer review before merge. It is **not** to be swept into the
  `.claude/` commit. Lesson: the audit doc drifted from the tree within one day —
  repo is ground truth over prose.

### D-005 — Real authentication & the demo-password / session-secret risk (PLACEHOLDER)
- Date: 2026-07-28
- Raised by: Security Engineer (Phase 0 baseline)
- Decided by: **Awaiting Phase 1 design + user sign-off**
- Context: Current auth is a shared hardcoded password + client-asserted role,
  with tokens signed by a **public default secret** and no expiry. See
  `SECURITY_REVIEWS/000-baseline-owasp.md` findings SEC-01..SEC-04. This must be
  replaced before any real tenant onboards.
- Decision: TBD in Phase 1 — real per-tenant user records, password hashing
  (argon2id/bcrypt), tenant-scoped JWT/session with expiry + rotation, mandatory
  `SESSION_SECRET` (fail boot if unset in prod), and the demo password gated
  behind a demo-mode env flag that is impossible to reach in production.
- Status: **Proposed** (design pending, implemented in P1-04).
- **Critic note (genuine, 2026-07-28):** Trap independently verified in code —
  `backend/src/routes/auth.js:18` hardcodes `DEMO_PASSWORD='grovyn@123'` and
  ignores `AUTH_DEMO_PASSWORD` (which `backend/.env.example:22` invites setting);
  `backend/src/config/index.js:31` defaults `sessionSecret` to a public literal;
  role is client-asserted in the login body. Correctly scheduled to close in
  P1-04/P1-12. No separate decision to gate.

### D-006 — Deployment target & runtime model
- Date: 2026-07-28
- Raised by: User (Phase 0 sign-off)
- Decided by: User.
- Context: The repo ships Vercel (backend) + Netlify (frontend) config, which the
  Phase 0 audit confirmed is demo residue, not a decision. The tenancy model
  (D-001) + RLS amendment need a stable, long-lived Postgres connection model.
- Decision: **Docker Compose via Dokploy on self-hosted infra, with a long-lived
  Postgres connection pool.** Remove the Vercel/Netlify residue in Phase 7. This
  unblocks D-002 (ORM) and D-001's RLS connection-context strategy.
- Alternatives considered: Vercel/Netlify serverless (rejected — connection-storm
  + `SET LOCAL`/pooling friction for RLS); managed Postgres (viable, revisit if a
  client's residency/ops needs demand it).
- Consequences / follow-ups: **Backups / tested restore / offsite copy for the
  72-month retention obligation (D-008) become the team's responsibility** and
  need a named owner (P7-02). Single-box is an availability SPOF for O1.
- Status: **Accepted.**
- **Critic verdict (genuine, 2026-07-28) — Endorse with changes (Significant).**
  Right for Prisma+RLS. Non-optional: delete Vercel/Netlify residue in the same
  change; add P7-02 backup/restore/DR with a **named human owner**. Concur with
  CRITIQUE 012 that 004 conflated **availability** (uptime SPOF) with
  **durability** (tested restore) — accept single-box availability *explicitly,
  with a trigger* (revisit HA at first uptime-carrying tenant). **Added drift
  finding:** D-006 is scheduled dead-last (Phase 7) yet its *architecture*
  (single-box / long-lived pool / no external pooler) is a **Phase-1 input** to the
  RLS spike, and P7-02 backup/DR is a **prerequisite** of D-008's erasure design —
  name P7-02's owner now and record the architecture as a Phase-1 assumption. See
  `CRITIQUES/013-genuine-critic-first-pass.md` (supersedes line in `CRITIQUES/004`).

### D-007 — Tax module: scope (GST India) & positioning (CA-in-the-loop)
- Date: 2026-07-28
- Raised by: User (Phase 0 sign-off)
- Decided by: User (taking professional advice separately).
- Context: The brief described the Tax Assistant as providing "a valid audit" —
  an overclaim. GST audit/certification (e.g. GSTR-9C reconciliation) is regulated
  CA work in India; software emitting authoritative filing figures carries real
  professional-liability exposure.
- Decision: (a) **India GST only at launch**, with a jurisdiction abstraction
  **seam** (an interface boundary, not a plugin framework) so a second isn't a
  rewrite; build only one now. (b) **Reposition** the module as *preparing and
  reconciling data for the client's CA* — CA in the loop, not a substitute for one.
- Consequences / follow-ups: The positioning must land in **UI copy, report
  headers ("Prepared for CA review — not a certified filing"), and TOS**, not just
  design docs, or it provides no liability protection.
- Status: **Accepted.**
- **Critic verdict (genuine, 2026-07-28) — Endorse (Significant on positioning /
  Minor on scope).** Concur fully with CRITIQUE 005. The "valid audit" overclaim
  was a real professional-liability exposure; CA-in-the-loop repositioning is
  correct and not optional. Non-optional: propagate the disclaimer to UI copy,
  report headers, and TOS; constrain the seam to an interface, not a framework. See
  `CRITIQUES/013-genuine-critic-first-pass.md` (supersedes line in `CRITIQUES/005`).

### D-008 — Data retention, soft-delete & PII erasure
- Date: 2026-07-28
- Raised by: User (Phase 0 sign-off)
- Decided by: User (design to be produced before schema).
- Context: Financial data carries a statutory retention floor (CGST §36: 72 months
  from the annual-return due date, +1 year after final disposal of any appeal),
  while customer PII carries a DPDP right-to-erasure — which is **not absolute**
  and yields to legal retention duties (a GST invoice must retain recipient
  name/GSTIN/address).
- Decision: **Soft-delete only** for sales, inventory movements, tax records, and
  audit logs, with a retention-policy field. Deleting a branch **tombstones** it
  (hidden in UI, records survive). Customer PII supports genuine **hard-delete on
  request**, resolved by splitting **erasable customer-master PII** from **frozen
  invoice-snapshot PII** (the name/address as it appeared on a legally-required
  invoice — retained, not a live FK). Erasure hits the master and de-links future
  use; invoices keep their statutory snapshot.
- Consequences / follow-ups: "Hard-delete PII" is a **crypto-shredding or
  pseudonymization pipeline** reaching every copy — indexes, caches, logs, and the
  6 years of PG backups (D-006). Choose crypto-shredding (per-subject key, delete
  the key) *or* a documented backup-expiry policy; couple to the DR design. Design
  doc P1-13, approved before any customer-PII schema.
- Status: **Accepted (direction); design pending (P1-13) — BLOCKING scheduling
  item open (see verdict).**
- **Critic verdict (genuine, 2026-07-28) — Endorse direction; BLOCKING on
  scheduling (Significant, one-way door).** The master-vs-invoice-snapshot split is
  the correct resolution; concur with CRITIQUE 006 and with 011's crypto-shredding-
  cannot-be-retrofitted finding (the sharpest correct point in the 001–012 set) and
  its live-DB-as-system-of-record vs backups-as-bounded-DR coupling. **BLOCKING
  finding (relayed to user verbatim):** crypto-shredding requires per-subject
  encryption from the *first migration that persists PII*; D-008 scopes only
  "customer PII" and is silent on **user/staff PII**, which lands in **P1-01** —
  while the design gate **P1-13 `Depends On: P1-01`**, i.e. is scheduled *after*
  it. If user PII is in erasure scope and crypto-shredding is chosen, P1-01 writes
  plaintext user PII before P1-13 decides to encrypt it — the one-way door closes
  before its own gate. **Required before P1-01 runs:** (1) decide whether user/staff
  PII is in erasure/crypto-shred scope or excluded on a separate lawful basis;
  (2) if in scope, resolve the crypto-shred-vs-backup-expiry fork before P1-01 and
  invert the P1-13↔P1-01 dependency for the encryption-architecture question. See
  `CRITIQUES/013-genuine-critic-first-pass.md` (supersedes lines in `CRITIQUES/006`,
  `011`). **RESOLUTION: the scope question in (1) is answered by D-013 (user/staff
  PII excluded from crypto-shred), which the critic confirms in CRITIQUE 014
  DISCHARGES this Blocking scheduling item (with two non-optional corrections to
  D-013's legal rationale — see D-013 status).**

### D-009 — Plan/pricing tier schema hooks
- Date: 2026-07-28
- Raised by: User (Phase 0 sign-off)
- Decided by: User.
- Context: Plan tiers/limits are expensive to retrofit onto live tenants
  (backfill + grandfather) but cheap to reserve now.
- Decision: Add `plan`, `branch_limit`, `seat_limit` to the tenant table in
  Phase 1; route **every** creation path through one `checkLimit()` function that
  currently returns `true`. Enforcement later, billing much later.
- Consequences / follow-ups: The chokepoint becomes security-relevant when enabled
  (resource-creation abuse + billing integrity). Document each field's semantics
  now (is a "seat" a user? per branch? does `branch_limit` count tombstoned
  branches?) so the dormant columns aren't archaeology later.
- Status: **Accepted.**
- **Critic verdict (genuine, 2026-07-28) — Endorse (Minor; two-way for columns).**
  Concur with CRITIQUE 007: correctly-priced option, the single `checkLimit()`
  chokepoint is the value; required non-optional change — write each field's
  semantics down now. Standing note: this traces to no O1–O4 outcome (business-model
  plumbing), legitimate only because it is near-free now; block it if it grows into
  an actual enforcement/billing engine before need. See
  `CRITIQUES/013-genuine-critic-first-pass.md` (supersedes line in `CRITIQUES/007`).

### D-010 — AI / Hugging Face policy & paid-inference estimate
- Date: 2026-07-28
- Raised by: User (Phase 0 sign-off) + Security/Planner stance
- Decided by: User.
- Context: HF free Inference API has no SLA, cold starts, rate limits — unfit as a
  sole dependency for anything enterprise-critical or billable.
- Decision: HF free tier permitted **only** for non-critical, non-billable
  features, behind strict timeout + cache-last-good + fallback. **No O1 or O3
  capability may be unavailable because a model is** (expansion planning is a
  deterministic engine; AI is a Phase-5 narrative garnish). Produce a rough
  paid-inference cost estimate before Phase 5 for the client conversation.
- Rough estimate (to firm up): narrative-only usage → pay-per-token hosted open
  model likely **~$5–20/tenant/mo** with a real SLA; a dedicated HF Inference
  Endpoint (always-on small GPU) is **~$400+/mo flat**, justified only at scale or
  for residency needs. Firm quote needs a separate costing (model, calls/tenant,
  residency).
- Status: **Accepted (policy); estimate pending firm costing before Phase 5.**
- **Critic verdict (genuine, 2026-07-28) — Endorse (Minor; two-way policy).**
  Policy is correct and — decisively — enforced *structurally* by scheduling (AI is
  Phase 5; expansion is the deterministic Phase-3.5 engine, verified real in
  `expansionPlanner.js`), not by intention. The $5–20 / $400+ figures are
  directional and unsourced — must not reach a client as numbers before the firm
  costing. See `CRITIQUES/013-genuine-critic-first-pass.md`.

### D-011 — Goal outcomes O1–O4 adopted as the planning anchor
- Date: 2026-07-28
- Raised by: User (Phase 0 sign-off)
- Decided by: User.
- Decision: Adopt O1 See / O2 Run / O3 Plan / O4 Trust (PROJECT_BRIEF §1a). Every
  TASK_BOARD row cites an outcome; infra names the capability it unblocks; unmapped
  work is surfaced, not built.
- Status: **Accepted.**
- **Critic verdict (genuine, 2026-07-28) — Endorse (governance; low-stakes,
  high-value).** The anchor is working (rows cite outcomes; unmapped work like
  D-009 is surfaced). **Critique upward (unchanged from 008/012):** the goal's
  "experience good enough to sell to an enterprise" bar is owned by **no** outcome —
  O1–O4 are all functional. Either adopt an O5 with *objective, falsifiable*
  criteria or assign the premium bar to frontend-developer as a per-phase DoD line;
  do not adopt an unmeasurable O5. See `CRITIQUES/013-genuine-critic-first-pass.md`.

### D-012 — Adopt `decision-critic` as the 7th agent (+ registration fix)
- Date: 2026-07-28
- Raised by: User (Phase 0 sign-off)
- Decided by: User.
- Context: The agent file (`decision-critics.md`) had **no YAML frontmatter**, so
  Claude Code never registered it — the mandatory critic gate did not actually
  exist. Also named plural vs the singular used everywhere.
- Decision: Renamed to `decision-critic.md` with proper frontmatter
  (`name: decision-critic`, `tools: Read, Grep, Glob, Write, WebSearch`,
  `model: opus`). Wired the gate into CLAUDE.md, PROJECT_BRIEF §6, project-master,
  and ORCHESTRATION_GUIDE: no decision → `Accepted` without a critic review;
  drift review at every phase boundary; **Blocking verdicts relayed to the user
  verbatim**; critic may critique upward. Unlike security-engineer, the critic has
  Write — only for `CRITIQUES/` and DECISIONS_LOG verdict lines.
- Consequences / follow-ups: Registers on next session relaunch. The critic runs
  on opus (same as implementers) → its own "flag self-review" rule always applies.
- Status: **Accepted.**
- **Critic verdict (genuine, 2026-07-28) — Endorse (governance).** This was the
  keystone defect — a mandatory gate that did not exist. **This very run is the
  evidence the fix works**, and it is the run that discharges the gate on every
  entry above. Correct. See `CRITIQUES/013-genuine-critic-first-pass.md`.

### D-013 — User/staff PII excluded from DPDP erasure/crypto-shred scope
- Date: 2026-07-29
- Raised by: `decision-critic` (Blocking finding in CRITIQUE 013): D-008's
  crypto-shred design doc (P1-13) was scheduled *after* P1-01, the migration that
  first persists `user` (admin/staff) PII — a one-way door closing before its own
  gate, and D-008 was silent on whether user/staff PII was even in erasure scope.
- Decided by: User (directed the call be made now, so P1-00 isn't blocked on it).
- Context: D-008 designed the master-vs-snapshot / crypto-shred-vs-backup-expiry
  split for **customer** PII (diners on invoices). It never addressed **user/staff**
  PII — the `user` table's name+email for tenant admin/staff login identities,
  first persisted in P1-01, three tasks before P1-13 would decide the erasure
  mechanism.
- Decision: **User/staff PII is out of DPDP erasure/crypto-shred scope**, on an
  employment-necessity lawful basis (DPDP Act 2023 §17(2)(a) exempts personal data
  processing necessary for employment purposes — hiring, termination, employee
  benefits, safeguarding the employer — from the Act's consent/erasure machinery).
  A tenant admin/staff account exists to operate the business as an employee, not
  as a customer the tenant serves — a different relationship than the one D-008
  was written for. Consequence: the `user` table in P1-01 gets the **same
  treatment as sales/inventory/audit records** — soft-delete + retention field, no
  per-subject crypto column. No irreversible door opens at P1-01.
- Consequences / follow-ups:
  1. **This is a legal-basis call, not purely an engineering one.** Directionally
     sound but needs real legal confirmation before GA — specifically, how long the
     employment exemption survives *after* termination.
  2. Until legal confirms a labor-law-specific floor (Payment of Wages
     Act / PF / ESI retention windows are the likely anchors, commonly 3–8 years),
     default terminated-staff records to the **same statutory floor as GST records
     (72 months)** as a conservative placeholder — over-retention is the smaller
     risk here, not under-retention, for records subject to labor inspection.
  3. **P1-13's scope is now explicit**: it gates Phase 3 customer-PII schema only.
     It does not block or gate P1-01. `TASK_BOARD.md` P1-01/P1-13 notes updated to
     reflect this — the dependency arrow (P1-13 depends on P1-01 for the schema
     *pattern*) stays, but the false "P1-13 must resolve before P1-01 is safe" gate
     is removed since user PII was the only thing making it urgent.
- Status: **Accepted (direction). BLOCKING scheduling item from CRITIQUE 013 is
  DISCHARGED-WITH-CONDITIONS per CRITIQUE 014** — P1-01 no longer walks through an
  irreversible crypto-shred door ahead of its P1-13 gate; the engineering call (no
  per-subject crypto column for staff at first migration) is sound and holds
  independently of the citation error below. **Two non-optional corrections
  (Significant), due now not before-GA:** (1) the statutory citation is wrong — the
  basis is **DPDP §7** (legitimate use — employment; removes *consent*, not
  erasure) + **§12(3)/§8(7)** (retention permitted where necessary for legal
  compliance), **not §17(2)(a)**, which is the State-instrumentality sovereignty
  exemption and is inapplicable to a private SaaS tenant's staff data; (2) reframe
  "out of erasure scope" → staff retain §12 erasure rights, *subordinated to legal
  retention and satisfied by backup-expiry rather than per-subject crypto-shred*
  (labour floors ≈/> backup horizon), so no crypto column is needed at P1-01.
  Minor: let the labour-law floor, not GST 72 months, set the terminated-staff
  retention default (GST anchor is over-retention of PII). Legal confirmation of
  the post-termination boundary remains legitimately pending before GA — that hedge
  is adequate; the citation error is not covered by it (it is checkable without
  counsel). See `CRITIQUES/014-d013-confirmation.md`.
- **Critic verdict (genuine, 2026-07-29) — DISCHARGED-WITH-CONDITIONS
  (Significant).** The CRITIQUE 013 Blocking scheduling item is genuinely closed;
  board notes P1-01/P1-13 are accurate. Objection tried (residual staff erasure
  window between labour-floor expiry and backup horizon) → fails as Blocking
  because it is not a first-migration one-way door, is the same backup-expiry
  trade-off the customer design already tolerates, and is bounded/self-healing;
  logged as a future risk with a trigger instead. Same-model self-review flagged
  (this resolves my own prior finding) — the DPDP citation was verified against
  sources, not memory. Two corrections above are non-optional. See
  `CRITIQUES/014-d013-confirmation.md`.

### D-014 — P1-01 minimal migrations: concrete schema, RLS verification, GRANT-layer immutability
- Date: 2026-07-29
- Raised by: Database Administrator (executing P1-01)
- Decided by: **Awaiting decision-critic review before Accepted** (schema/
  migration work per the Definition of Done — not marked Done yet).
- Context: P1-01 required the first real migrations for `tenant`, `user`,
  `session`, `audit_log` on the Drizzle/RLS pattern D-002/P1-00 validated, plus
  two items CRITIQUE 015 flagged as unverified in the spike (not by inspection —
  by re-running the spike's rigor against real tables and a real container).
- Decision: Schema lives in `backend/src/db/schema.js`; migrations in
  `backend/drizzle/` (`0000_conscious_namor.sql` auto-generated tables +
  `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY ... WITH CHECK`,
  `0001_force_rls_and_grants.sql` hand-written `FORCE ROW LEVEL SECURITY` +
  `GRANT`, `bootstrap-roles.sql` — deliberately **outside** the versioned
  migration chain since `CREATE ROLE` is cluster-wide, not per-database, and
  belongs in the chain would break a second database on the same cluster).
  Concrete, non-trivial choices made beyond what D-001/D-002/D-008/D-009/D-013
  already settled:
  1. **`tenant` is not `tenant_id`-scoped** (it IS the tenant) — its RLS policy
     compares its own `id` to the session GUC instead, so a scoped connection
     can read/write its own account row and cannot enumerate other tenants'
     name/slug/plan. Not previously specified by any prior decision.
  2. **Shared `retention_category` Postgres enum** (`standard` |
     `financial_72mo` | `employment_72mo_placeholder`) reused across tables
     instead of a bespoke marker per table, so Phase 2 financial tables slot
     into the same vocabulary rather than inventing a parallel one. Plus a
     `retain_until` timestamp column (app-computed at soft-delete time, no
     purge job yet) alongside `deleted_at`, so a future purge job has one
     indexed column instead of recomputing the floor from category each run.
  3. **`session.revoked_at`** used instead of a generic `deleted_at` name for
     session's tombstone-equivalent field — same soft-delete role D-008 asks
     for, named for what it operationally means (logout/forced revoke).
     `retention_category` defaults to `'standard'` for sessions (no statutory
     floor; kept non-hard-deletable per this task's blanket rule for
     incident-forensics value, not because law requires it).
  4. **`user` gets a partial, case-insensitive unique index** on
     `(tenant_id, lower(email)) WHERE deleted_at IS NULL` — uniqueness is
     tenant-scoped (not global/SSO) and only enforced among active rows, so a
     departed employee's email can be reissued to a new hire without a
     tombstoned row blocking it.
  5. **`audit_log` immutability enforced at the GRANT layer, not just RLS**:
     the runtime role (`grovyn_app`) is granted `SELECT, INSERT` only on
     `audit_log` — no `UPDATE`/`DELETE` grant at all — vs. `SELECT, INSERT,
     UPDATE` (no `DELETE`) on `tenant`/`user`/`session`. A buggy or
     compromised application identity cannot alter or remove an existing
     audit row even via a bypassed application check; Postgres refuses the
     privilege before RLS is evaluated. This is stricter than what D-008
     literally asked for (soft-delete) since audit_log needs no soft-delete
     at all (append-only) — verified live (see below).
  6. **Every policy sets `using` AND `withCheck` explicitly** to the same
     tenant-isolation predicate, rather than relying on Postgres's documented
     `FOR ALL`-with-only-`USING` fallback — removes ambiguity for future
     reviewers/edits, doesn't change current behavior.
  7. **Bootstrap roles split from versioned migrations** (`bootstrap-roles.sql`,
     run once per cluster, not tracked by drizzle-kit) — `grovyn_migrator`
     (BYPASSRLS, migrations/seed only) and `grovyn_app` (NOBYPASSRLS, runtime).
     Only `grovyn_migrator`/`grovyn_app` creation is in scope here — the
     per-request context wiring (P1-02) and DAL (P1-03) are explicitly not
     built in this task.
  8. **Postgres 15+ default-privilege gotcha found during verification**: a
     freshly created non-owner role has neither `CREATE` on schema `public`
     nor `CREATE` on the database by default (changed from pre-15 behavior).
     `bootstrap-roles.sql`'s companion grants (documented inline) must include
     `GRANT CREATE ON SCHEMA public TO grovyn_migrator` and
     `GRANT CREATE ON DATABASE <db> TO grovyn_migrator`, or `drizzle-kit
     migrate` fails to create anything (observed: it hung/errored silently
     rather than surfacing a clear permission error — a CLI UX sharp edge to
     flag for whoever runs this against a fresh cluster).
  - **CRITIQUE 015 verification item 1 (does `pgPolicy()` emit `WITH CHECK` for
    INSERT paths) — CONFIRMED, with real functional evidence, not just static
    SQL inspection.** `drizzle-kit generate` produced literal
    `WITH CHECK (...)` clauses for all 4 tables (see `0000_conscious_namor.sql`
    line 72-75). Ran a real throwaway `postgres:16-alpine` container, applied
    the migrations, connected as the non-BYPASSRLS `grovyn_app` role, and: a
    cross-tenant `INSERT` (tenant-A context, `tenant_id` = tenant B row) was
    **rejected** with `new row violates row-level security policy for table
    "user"`; the same INSERT with a matching `tenant_id` **succeeded**; a
    cross-tenant `UPDATE` on `tenant` was silently no-op'd (0 rows, governed by
    `USING`, not an error, as expected for `UPDATE`'s two-phase check); a query
    with **no context set at all** returned 0 rows (fail-closed); and an
    `UPDATE` attempt against `audit_log` was refused with `permission denied`
    (the GRANT-layer control in #5 above, not RLS) — 5/5 pass.
  - **CRITIQUE 015 verification item 2 (does Drizzle's diffing survive an
    alter/regenerate cycle, not just cold-start) — CONFIRMED.** In an isolated
    scratch copy (not part of the real migration history — deleted after the
    test), widened the `session` policy's `USING` predicate with an extra
    `AND revoked_at IS NULL` clause and added a brand-new tenant-scoped table
    (`scratch_note`) with its own policy, then re-ran `generate`. Result: a
    correct incremental `ALTER POLICY "session_tenant_isolation" ... USING
    (...)` (not a drop+recreate, and untouched tables produced zero
    statements) plus a correct fresh `CREATE POLICY ... WITH CHECK` on the new
    table — applied live and confirmed via `pg_policies.qual`/`with_check` in
    the catalog. The migration-diffing engine tracks RLS policy state
    correctly across snapshots, not just on a first generate.
  - Dependencies added to `backend/package.json`: `drizzle-orm@^0.45.2`,
    `pg@^8.22.0` (runtime); `drizzle-kit@^0.31.10`, `dotenv@^17.4.2` (dev-only,
    used solely by the drizzle-kit CLI, never imported by application code).
    No TypeScript exists anywhere in the backend (confirmed by search before
    choosing plain `.js` schema/config files over `.ts` — consistent with the
    rest of the ESM JS backend, avoids adding a TS toolchain this task doesn't
    need). `npm audit` flags 4 moderate advisories, all inside
    `drizzle-kit`'s bundled dev-only esbuild (its local dev-server component,
    which this project never runs — only the `generate`/`migrate` CLI
    commands are used); flagged to security-engineer as informational, not
    blocking.
  - **Confirmed no regression**: grepped for any existing runtime code reading
    a persistent store before adding these deps — none exists; all current
    services/routes (`bootstrap.js`, `seed/`, `auth.js`, etc.) run entirely
    in-memory. `npm run verify` (the existing system smoke test) still passes
    unmodified after this change, confirming the addition is purely additive
    — real DB wiring is P1-02/P1-03/P1-07's job, not this task's.
- Alternatives considered: A single `deleted_at` field name for `session`
  (rejected — `revoked_at` is the operationally correct name and this task's
  own scope note treats the concept as table-specific); a generic `metadata
  jsonb` catch-all instead of the explicit `retention_category` enum (rejected
  — an enum is queryable/indexable and self-documenting, a jsonb blob is not);
  embedding `CREATE ROLE` in the versioned migration chain (rejected — see #7,
  cluster-wide vs. per-database mismatch would break a second database sharing
  the cluster).
- Consequences / follow-ups: P1-02 (context middleware) and P1-03 (fail-closed
  DAL) build directly on this schema and `bootstrap-roles.sql`'s role split.
  P1-06 replaces the provisional `user.role` enum with real branch-scoped
  role/permission tables. Phase 2 financial tables should reuse
  `retentionCategoryEnum` rather than inventing a new one. The Postgres 15+
  default-privilege gotcha (#8) should be carried into any deployment runbook
  (P7-01/P7-02) so a fresh production cluster doesn't repeat the same silent
  failure.
- Status: **Accepted (with non-optional forward-spec conditions — see verdict);
  P1-01 task remains In Review (Security).** The decision-critic gate on D-014 is
  SATISFIED per `CRITIQUES/016-d014-p1-01-schema-rls.md`. The schema/migration
  artifacts are sound, correctly scoped, and honestly framed; none of the five
  required changes alter the P1-01 artifacts (except one DBA-owned comment fix) —
  they are forward specs on P1-02/P1-04/P1-10/P1-13/P7. The P1-01 **task** does
  NOT move to Done on this: the parallel security-engineer OWASP pass is a
  separate Definition-of-Done gate that is not yet closed.
- **Critic verdict (genuine, 2026-07-29) — ENDORSE WITH CHANGES (Significant).
  Critic gate on D-014 SATISFIED; may move to Accepted.** The reframe that matters:
  what is actually being decided is larger than "first migrations + two spike
  verifications" — it is the physical shape of the four root entities every later
  table FKs into, the RLS isolation predicate copy-pasted across the whole schema,
  and the enforcement-by-privilege (GRANT-layer) model. These become one-way doors
  the moment the first tenant's data lands (P1-07+); no real data lands in P1-01, so
  accepting the artifacts now is safe and cheap. Goal alignment is direct (O4
  foundation, unblocks O1/O2); no table/column/policy traces to no outcome. The four
  items D-014 asked the critic to bless were not rubber-stamped (§B): GRANT-layer
  audit_log immutability is SOUND (verified in `0001`); `bootstrap-roles.sql` outside
  the versioned chain is the RIGHT CALL; app-computed `retain_until` is acceptable now
  with a fail-closed condition; the other one-way doors (shared enum, partial unique
  index, `revoked_at`) are fine. The two findings the critic pressed *against* the
  design (§C) are forward specs, not P1-01 defects. **Five non-optional changes (all
  forward specs; only the §C.1/§D `schema.js` `tenant.slug` comment fix touches a
  P1-01 artifact, and that is DBA-owned):** (1) [P1-02/P1-04] own the pre-context read
  path — how a request resolves tenant + authenticates before tenant context exists,
  without the request-forbidden migrator role; correct the misleading `tenant.slug`
  comment. (2) [P1-13] bring audit_log into customer-PII erasure (crypto-shred the
  immutable jsonb snapshot fields). (3) [purge/P1-13] fail-closed `retain_until` —
  single soft-delete chokepoint always sets it; purge treats `deleted_at IS NOT NULL
  AND retain_until IS NULL` as do-not-purge-and-alert. (4) [P1-10] assert
  `grovyn_app.rolbypassrls = false` against the deployed cluster; make
  `bootstrap-roles.sql` idempotent. (5) [P7 runbook] document the audit_log correction
  escape hatch (migrator-only, change-controlled, itself un-audited). *Objection tried
  ("Block — §C.1 commits the product to an undesigned auth/onboarding model on a
  one-way-door schema") and why it fails:* the schema forecloses none of the viable
  resolutions (narrow auth role or SECURITY DEFINER resolvers all sit on top of these
  tables, add nothing irreversible), and no tenant data lands in P1-01 — a real unowned
  gap to close before P1-04, not a defect that makes accepting P1-01 wrong. Same-model
  self-review flagged. See `CRITIQUES/016-d014-p1-01-schema-rls.md`.
