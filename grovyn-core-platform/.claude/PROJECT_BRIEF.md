# PROJECT BRIEF — Grovyn (Multi-Tenant Restaurant Ops Platform)

> This is the single source of truth. Every agent reads this file before starting
> any task, and Project Master keeps it current as decisions are made. If code and
> this doc disagree, this doc wins until an agent explicitly updates it.

## 1. Goal

A multi-tenant SaaS platform for restaurants / cloud-kitchen businesses to monitor
and manage daily/monthly/overall operations, and to plan expansion. One deployable
codebase serves many business clients (tenants), each fully data-isolated. The bar
is an experience and efficiency good enough to sell to an enterprise.

## 1a. Goal Outcomes (O1–O4) — the anchor for every task

Everything we build serves one of four outcomes. Every task in `TASK_BOARD.md`
cites the outcome(s) it serves; infrastructure tasks cite the outcome they unblock
and name the user-visible capability they enable. "Good engineering practice" is
not an outcome. Any task that traces to nothing is scope creep or an unstated
requirement — surface it rather than build it.

- **O1 — See the business.** An owner opens one screen and understands how every
  branch is performing right now, and over time.
- **O2 — Run the business.** Sales, inventory, customers, and staff captured and
  maintained with minimum friction, branch by branch.
- **O3 — Plan ahead.** The business makes an expansion, cost, or marketing
  decision using its own real data. (Deterministic — not AI-gated.)
- **O4 — Trust it.** Correct numbers, isolated tenant data, auditable history,
  compliance that survives scrutiny.

## 2. Tenancy & Roles

- **Tenant = Business entity** (e.g. a restaurant brand). Each tenant can have
  multiple **branches** (stores/locations).
- **Admin** (per tenant):
  - Sees aggregated dashboard across all branches: sales, revenue, profit, margin.
  - Can create/manage Staff roles and permissions, per branch.
  - Manages inventory and customer base for every branch.
  - Views day/week/month sales, uploadable via Excel/CSV.
  - Views staff details, receives notifications (e.g. staff inventory requests).
  - Gets AI dashboard insights + AI expansion/strategy suggestions.
  - Gets Tax Assistant (CA) reports.
- **Staff** (scoped to one assigned branch):
  - Sees/uploads sales for their branch only.
  - Sees inventory, can request more inventory → triggers Admin notification.
  - Can edit inventory (all edits are logged/audited, attributed to the staff member).
  - No financial visibility beyond their own scope (mirrors existing Grovyn RBAC
    pattern: frontend route-gating + backend `requireRole`/`requireStoreAccess`).

## 3. Core Modules

| Module | Summary |
|---|---|
| Dashboard | Admin: cross-branch executive view. Staff: branch-scoped operational view. |
| Sales | Manual entry + Excel/CSV import, day/week/month rollups, per branch. |
| Inventory | Manual + Excel add, branch-scoped, auto-adjusts from sales, staff edits are logged, low-stock triggers Admin notification. |
| Customers | Per-branch customer records, category/segment, rating. |
| Staff Management | Admin creates/manages staff, assigns branch + permissions. |
| Notifications | Staff → Admin (inventory requests, low stock, anomalies). |
| AI — Ops Copilot | Summarizes dashboard, flags risks/anomalies, suggested next actions. |
| AI — Strategy Advisor | Expansion planning, cost-cutting, branding/marketing suggestions. |
| Tax Assistant (CA) | **Prepares and reconciles GST data for the client's CA** (CA in the loop) — location-aware computation, audit trail, savings suggestions. **Not** a certified audit and not a substitute for a CA (D-007). |

## 4. Tech Stack (carried forward from the existing Grovyn Autopilot template)

- **Backend**: Node 20, Express 4, ESM, layered (routes → controllers → services/engines).
- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, Zustand, React Router, Axios, Radix UI, lucide-react.
- **Deployment**: **Docker Compose via Dokploy on self-hosted infra, with a
  long-lived Postgres connection pool** (D-006). This is now a decision, not
  carried-forward residue — the repo currently ships Vercel+Netlify config only,
  which is demo residue to be removed in Phase 7. Per-tenant branding injected at
  runtime via `runtime-config.js` is **greenfield** (Phase 7), not present today.
- **AI**: Hugging Face free-tier Inference API models only (no paid LLM API), and
  only for **non-critical, non-billable** features behind timeout + cache +
  fallback — an **optional narrative garnish**, never a critical path. No O1/O3
  capability may depend on a model. See Risks and D-010.
- **Database**: **PostgreSQL** (D-001). Tenancy = shared schema with mandatory
  `tenant_id`, session-derived guard, fail-closed DAL, **and Postgres Row-Level
  Security enabled from Phase 1** (amended D-001). ORM (Prisma vs Drizzle) is
  resolved by the Phase-1 RLS-pooling spike (D-002). The current template has
  **no persistence** (in-memory synthetic data); real persistence is a hard
  prerequisite before any client onboarding.

## 5. Known Constraints & Risks (flag, don't ignore)

1. **Hugging Face free Inference API**: rate-limited, subject to cold starts /
   model unloading, no uptime SLA. Not production-safe as a sole dependency for
   enterprise delivery. AI features must degrade gracefully (cache last result,
   show "insight temporarily unavailable," never block core dashboard flows on it).
2. **No DB yet**: current repo is demo-only, resets on restart. This blocks any
   real multi-tenant rollout until Database Administrator agent ships schema + migrations.
3. **Multi-tenant data isolation is the #1 security risk** for this product shape —
   every query, upload, and AI prompt must be tenant/branch scoped. Treat this as
   a standing item in every Security Engineer review, not a one-time check.
4. **Uncommitted Vite 5→8 bump — RE-OPENED (2026-07-28, later same day).** The
   Phase 0 audit (D-004) found no bump; it has since appeared in the working tree
   (`frontend/package.json`: `^5.4.10 → ^8.1.5` + lockfile), uncommitted and
   untested. Per the dependency-bump rule it needs a security-engineer review.
   Isolated as its own scoped task (build + dev smoke + `npm audit` +
   `@vitejs/plugin-react` compat + security review) — **not** to be swept into the
   `.claude/` commit. Lesson: the doc drifted from the tree in a single day —
   repo is ground truth.
5. **Broken `npm run verify`** — **fixed** (D-003). Latent trap remains:
   `auth.js` hardcodes the demo password and ignores `AUTH_DEMO_PASSWORD`, while
   the test and `backend/.env.example` invite setting it — setting the env var
   401s login and fails the suite. Closed by the Phase-1 auth rewrite (P1-04/12).
6. **Data retention & PII erasure (O4).** Financial records (sales, inventory
   movements, tax, audit logs) are soft-delete only with a retention-policy field;
   statutory baseline is 72 months from the annual-return due date (CGST §36),
   extended to 1 year after final disposal of any appeal/investigation. Customer
   PII supports genuine hard-delete on request, but India's DPDP right-to-erasure
   is **not absolute** — it yields to legal retention duties (a GST invoice must
   retain recipient name/GSTIN/address). Design collision resolved by splitting
   erasable customer-master PII from frozen invoice-snapshot PII (D-008; design
   before any customer-PII schema).
7. **Backups / DR for the retention obligation (O4).** Self-hosting (D-006) + a
   72-month retention duty means automated Postgres backups, tested restores, and
   an offsite copy are now the team's responsibility, not a managed platform's.
   The compliance claim is only as real as the restore we've tested. **Needs a
   named owner** (Phase 7).

## 6. Definition of Done (per module)

A module is not "done" until:
- [ ] Every task cites the outcome(s) O1–O4 it serves (§1a)
- [ ] Functional + technical + data flow signed off by Project Planner
- [ ] Schema/migration reviewed by Database Administrator
- [ ] Implementation reviewed against OWASP Top 10 by Security Engineer
- [ ] UI reviewed for RBAC-correctness, states (loading/empty/error), and premium
      visual bar by Frontend Developer
- [ ] Any non-trivial decision reviewed by Decision Critic before it is logged
      `Accepted` in `DECISIONS_LOG.md`
- [ ] Entry updated in `TASK_BOARD.md` and any decisions in `DECISIONS_LOG.md`
      by Project Master

## 7. Change Log

| Date | Change | By |
|---|---|---|
| (init) | Brief created from user's project goal + existing Grovyn Autopilot report | Project Master |
| 2026-07-28 | Phase 0 audit completed. Corrections to §4/§5 recorded (see below) — the template does **not** actually ship Docker/Dokploy config, `runtime-config.js` branding, or any Hugging Face/AI integration; the "uncommitted Vite 5→8 bump" (§5.4) did not exist in the working tree or git history **at audit time**. See `AUDIT_PHASE0.md`, `PHASE_PLAN.md`, `SECURITY_REVIEWS/000-baseline-owasp.md`, and DECISIONS_LOG D-001..D-005. | Project Master |
| 2026-07-28 | Phase 0 sign-off. Adopted goal outcomes O1–O4 (§1a) and 7th agent `decision-critic` (mandatory gate). Decisions: D-001 amended (RLS in Phase 1), D-006 deployment (Docker/Dokploy + long-lived pool), D-007 tax scope/positioning, D-008 retention/PII, D-009 plan-tier hooks, D-010 HF policy. Re-prioritized: minimal Admin dashboard forward into Phase 2 (O1 vertical slice); expansion planning decoupled from AI, scheduled ~Phase 3.5 (O3). **Correction to the correction:** the Vite 5→8 bump has re-appeared in the working tree since the audit — §5.4 RE-OPENED. See `CRITIQUES/`. | Project Master |

### Phase 0 corrections to §4/§5 (do not silently trust these as "carried forward")
- §4 "Docker Compose via Dokploy" and "`runtime-config.js` branding" — **not present in repo**; both are greenfield (Phase 7). Current deploy config is Vercel + Netlify only.
- §4/§5 "Hugging Face AI" — **no AI integration exists**; all current "AI"/"autopilot" output is deterministic rule logic on synthetic seed data. Entire AI layer is greenfield (Phase 5).
- §5.4 "Uncommitted Vite 5→8 bump" — was absent at audit time (D-004) but has
  **RE-APPEARED uncommitted** in the working tree since; now a real, isolated,
  security-reviewed task (see §5.4 above, D-004 supersede note).
- §5.5 "Broken `npm run verify`" — **fixed** (DECISIONS_LOG D-003); runtime re-run pending `npm install`.
