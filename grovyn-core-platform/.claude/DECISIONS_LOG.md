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
- **Critic verdict — Endorse with changes (Significant, one-way door):** the
  deferral was the weaker call; retrofit onto live regulated data is the expensive
  direction a one-way door exists to avoid. Non-optional changes: (1) resolve
  D-002 via the P1-00 RLS-pooling spike *before* the first migration — RLS+Prisma
  is a known sharp edge and may argue for Drizzle; (2) BYPASSRLS role + context
  middleware are first-class P1 deliverables; (3) DAL primary, RLS backstop. Self-
  review noted: the original "defer" line was an opus (DBA) recommendation and the
  critic is opus. See `CRITIQUES/001-d001-rls-in-phase1.md`.

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
- Status: **Hold → resolved by P1-00 spike.**
- **Critic verdict — Endorse the spike (Minor):** don't lock Prisma by inertia;
  the RLS+pooling prototype is cheap now and decisive. See
  `CRITIQUES/001-d001-rls-in-phase1.md`.

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
- **Critic verdict — Endorse with changes (Significant):** right for Prisma+RLS,
  but it silently adopts an ops burden (backups/DR, TLS, PG patching) nobody owns.
  Non-optional: add P7-02 (backup/restore/DR + owner); delete Vercel/Netlify
  residue in the same change; run the P1-00 spike (RLS-through-Prisma still argues
  for evaluating Drizzle). See `CRITIQUES/004-d006-deployment.md`.

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
- **Critic verdict — Endorse (Significant on positioning / Minor on scope):** the
  overclaim was a real liability; repositioning is correct and not optional.
  Constrain the seam to an interface, not a framework; propagate the disclaimer to
  user-facing artifacts + TOS. See `CRITIQUES/005-d007-tax.md`.

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
- Status: **Accepted (direction); design pending (P1-13).**
- **Critic verdict — Endorse with changes; design-before-build (Significant,
  one-way door):** direction right; the master-vs-snapshot split and the
  backup-erasure mechanism must be designed and user-signed-off before schema;
  document that financial retention lawfully overrides DPDP erasure in the erasure
  UX. See `CRITIQUES/006-d008-retention-pii.md`.

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
- **Critic verdict — Endorse (Minor):** correctly-priced option; the single
  chokepoint is the valuable part. Required: write the field semantics down now.
  See `CRITIQUES/007-d009-plan-tiers.md`.

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
- **Critic verdict — Endorse (Minor):** policy is correct and enforced structurally
  by D-001-era scheduling; estimate is directional, flag it as such to the client.

### D-011 — Goal outcomes O1–O4 adopted as the planning anchor
- Date: 2026-07-28
- Raised by: User (Phase 0 sign-off)
- Decided by: User.
- Decision: Adopt O1 See / O2 Run / O3 Plan / O4 Trust (PROJECT_BRIEF §1a). Every
  TASK_BOARD row cites an outcome; infra names the capability it unblocks; unmapped
  work is surfaced, not built.
- Status: **Accepted.**

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
