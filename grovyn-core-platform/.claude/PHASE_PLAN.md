# PHASE PLAN — Grovyn build (dependency-ordered)

> Produced by project-planner (Phase 0). Modules in dependency order. Phase 1
> (foundations) is detailed; later phases are summarized and will be expanded
> when we reach them. Every phase ends at the `PROJECT_BRIEF.md` §6 Definition of
> Done. Nothing here starts until the user accepts D-001/D-002 (tenancy + ORM).

## Dependency spine (why this order)

```
Phase 0  Audit + stabilization            (this phase — no feature code)
Phase 1  Persistence + Tenancy + AuthZ    (blocks literally everything below)
Phase 2  Core domain: Sales + Inventory   (the operational heart; feeds dashboards)
Phase 3  Customers + Staff Management      (needs tenancy + roles from P1)
Phase 4  Dashboard + Notifications         (aggregates P2/P3 data)
Phase 5  AI — Ops Copilot + Strategy       (reads everything; HF-gated, degradable)
Phase 6  Tax Assistant (CA)                (needs Sales + Finance; compliance-grade)
Phase 7  Deployment + per-tenant branding  (Docker/Dokploy + runtime-config)
```

Rationale: you cannot scope a query by tenant/branch until tenancy exists (P1);
you cannot summarize a dashboard (P4) or feed an AI prompt (P5) until there is
real Sales/Inventory data (P2). AI is deliberately late because it must degrade
gracefully and is the least reliable dependency (HF free tier).

---

## PHASE 1 — Foundations (DETAILED)

Goal: turn the single-tenant in-memory demo into a persistent, multi-tenant,
properly-authenticated platform with real roles/permissions — **without**
shipping any new business feature yet. When P1 is done, an Admin of Tenant A can
log in, see only Tenant A, manage branches and staff roles, and a Staff user is
hard-scoped to their branch — all enforced server-side and backed by a database.

### 1.1 Functional flow (per role)

**Admin (tenant owner)**
1. Logs in with real credentials (email + password) → resolves to exactly one
   tenant. Sees only that tenant's data.
2. Creates/edits **branches** (stores) for the tenant.
3. Creates **staff roles** (custom, not just "STAFF") with a permission set, and
   creates staff users assigned to a branch + role. (§2: permissions vary per
   branch.)
4. Empty states: brand-new tenant sees "No branches yet — create your first
   branch" and "No staff yet", not a blank screen.
5. Failure/edge: cannot see or address another tenant's IDs (403/404); cannot
   escalate own tenant boundary.

**Staff (branch-scoped)**
1. Logs in → resolves to one tenant + one branch + a permission set.
2. Sees only their branch. Any attempt to reach another branch/tenant → denied
   server-side (not just hidden in UI).
3. Sees only capabilities their permission set grants.

### 1.2 Data flow

- New entities: `tenant`, `branch`, `user`, `role`, `permission` (or a
  role→permission mapping), `user_branch_assignment`, `audit_log`
  (append-only), plus a `session`/refresh-token store if not pure-JWT.
- Every existing tenant-scoped concept (store/brand/sku/customer/order/inventory/
  staff) gains `tenant_id` (+ `branch_id` where relevant), non-nullable, indexed.
- Auth token carries `userId` + `tenantId` + resolved role/permissions +
  branch scope. `tenantId`/`branchId` come **only** from the session, never the
  request body.
- Seed/demo data is written under a dedicated demo tenant, behind an env flag,
  and is unreachable in production.

### 1.3 Technical flow

1. **DB + ORM stand-up** (database-administrator): choose engine/ORM per
   D-001/D-002, write initial migrations for the foundation tables, add a
   scoped-client wrapper that requires `tenant_id` on every query (fail closed).
2. **Auth rewrite** (backend-developer, security-gated): real users + password
   hashing; tenant-scoped tokens with expiry/rotation; mandatory
   `SESSION_SECRET` (boot fails if unset in prod); demo password gated to
   demo-mode only. Closes SEC-01, SEC-02, SEC-04, D-005.
3. **Tenant + RBAC middleware** (backend-developer): `resolveTenant` (from
   session), extend `requireRole`→`requirePermission`, `requireBranchAccess`
   replacing the ad-hoc per-handler STAFF filtering. Applied centrally in
   `routes/v1/index.js`.
4. **Port existing read services to DB, tenant-scoped** — incremental; only the
   services needed to prove the foundation (stores/branches, users) in P1; the
   rest port as their module's phase arrives.
5. **Frontend**: extend `AuthContext` session shape (tenant + permissions);
   convert `RequireRole` → permission/capability gate; branch/staff management
   screens; empty/loading/error states throughout.
6. **Security review** of everything in 2–3 before any `Done`.

Needs DBA input: all of 1.1's entities (schema). Needs Security review: 2, 3,
and the demo-gate in 1.

### 1.4 Phase 1 Definition of Done
- [ ] Tenancy + ORM accepted (D-001/D-002) and migrations shipped.
- [ ] Real auth (hashed pw, tenant token, expiry, mandatory secret) — security-passed.
- [ ] Tenant + permission + branch middleware enforced centrally, fail-closed.
- [ ] A documented cross-tenant/cross-branch isolation test passes (A of tenant
      A cannot reach tenant B; staff cannot reach another branch).
- [ ] Demo/seed mode gated behind env flag, unreachable in prod.
- [ ] Frontend RBAC re-derived from real permission model; all views have
      empty/loading/error states.
- [ ] `verify` (or its successor) green against the DB-backed backend.
- [ ] TASK_BOARD + DECISIONS_LOG current.

---

## Later phases (SUMMARY — expand on arrival)

- **Phase 2 — Sales + Inventory.** Manual entry + Excel/CSV import (validate
  before commit, row-level errors, tenant/branch-scoped, transactional
  sales→inventory adjustment). Append-only inventory audit log; low-stock event
  → notification hook. Security: file-upload injection/DoS, transaction
  integrity.
- **Phase 3 — Customers + Staff Management.** Per-branch customers
  (category/rating). Admin-defined staff roles + per-branch permissions (builds
  on P1 role model). Staff removal revokes tokens (closes SEC-04 lifecycle).
- **Phase 4 — Dashboard + Notifications.** Admin cross-branch executive view;
  Staff branch view. Staff→Admin notifications (inventory requests, low stock,
  anomalies). Reuses ported metrics/finance services.
- **Phase 5 — AI (Ops Copilot + Strategy Advisor).** New `aiService` wrapping
  Hugging Face free-tier: timeout, retry-with-backoff, cached last-good result,
  "insight temporarily unavailable" fallback. Never blocks a core response.
  Never crosses tenant data in one prompt; minimal data per insight. Security:
  prompt injection from uploaded data, SSRF on the HF endpoint, key handling.
- **Phase 6 — Tax Assistant (CA).** Location-aware tax computation, append-only
  tamper-evident tax records, savings suggestions. Compliance-grade; product
  decisions needed (jurisdictions at launch, retention).
- **Phase 7 — Deployment + branding.** Build the Docker Compose / Dokploy story
  that the brief assumes but the repo lacks; implement `runtime-config.js`
  per-tenant branding injection. (Currently Vercel+Netlify only.)

## Open questions for the user (product calls, not technical)
1. **Tax jurisdictions at launch** (Phase 6) — which regions/tax regimes must be
   supported for the first enterprise client? (India GST only? Others?)
2. **Data retention** — how much sales/inventory/audit history do we retain, and
   what happens to a branch's data when a branch is deleted (soft-delete +
   retain for audit, or hard delete)?
3. **Deployment target** — the brief says Dokploy/Docker Compose but the repo
   ships Vercel+Netlify config. Which is the real production target? This changes
   Phase 1 infra choices (e.g. a long-lived Postgres connection pool is fine on
   Dokploy but awkward on Vercel serverless).
4. **Pricing/plan model** — does tenancy need plan tiers/limits in the schema now
   (branch caps, seat caps), or is that out of launch scope?
