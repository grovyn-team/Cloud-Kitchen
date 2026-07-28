# PHASE 0 — Codebase Audit (Grovyn Autopilot → Grovyn)

> Produced by the Phase 0 audit. File/module-level honest assessment of the
> existing `grovyn-core-platform/` template against the target architecture in
> `PROJECT_BRIEF.md`. Verdicts: **Keep** (usable ~as-is), **Refactor** (good
> bones, must change for tenancy/persistence), **Rewrite**, **Remove/Gate**.

## 0. TL;DR

The template is a **well-structured, single-tenant, in-memory demo** with a
clean layered backend (routes → controllers → services/engines) and a decent
React/Tailwind frontend. The *architecture shape* (layering, RBAC middleware
seams, versioned `/api/v1`, typed frontend API client) is worth keeping. The
*substance* is not production: no database, no tenants, no real users, no real
AI, and several auth defaults that are unsafe if shipped.

Biggest gap vs. the brief: **the platform is single-tenant to its foundations.**
There is no `tenant` concept anywhere — not in data, auth tokens, routes, or
frontend state. Multi-tenancy is not a feature to add on top; it is a boundary
that has to be threaded through every layer. That is Phase 1.

## 1. Discrepancies between `PROJECT_BRIEF.md` and the actual code

These matter because the brief says "carried forward from the existing
template" for things that **do not exist in the repo**:

| Brief claim | Reality in repo | Impact |
|---|---|---|
| §4 "Deployment: Docker Compose via Dokploy" | No `Dockerfile`, no `docker-compose.yml`, no Dokploy config anywhere. Only `vercel.json` (backend) + `netlify.toml` (frontend). | Deployment story has to be **built**, not carried forward. Current deploy target is Vercel+Netlify, not Dokploy. |
| §4 "per-tenant branding injected at runtime via `runtime-config.js`" | No `runtime-config.js` exists. Branding is hardcoded in the frontend. | The multi-tenant branding mechanism is greenfield. |
| §4/§5 "AI: Hugging Face free-tier" | **Zero** HF/AI integration. All "AI" (`insightEngine`, `actionEngine`, `executiveBriefService`, `autopilotService`, intelligence routes) is deterministic rule logic over synthetic seed data. | Every AI module in §3 is greenfield. There is no HF client, key handling, timeout, or fallback to inherit. |
| §5 / kickoff "Uncommitted Vite 5→8 bump + dirty lockfiles" | `frontend/package.json` is `vite ^5.4.10` in the working tree **and in every commit in history**. Working tree is clean except `backend/.gitignore` and untracked `.claude/`. | **There is nothing to evaluate, commit, or revert.** T-004 is a no-op. See DECISIONS_LOG D-004. |
| kickoff "demo password pattern `AUTH_DEMO_PASSWORD`, default `grovyn@123`" | Password is a **hardcoded literal** `const DEMO_PASSWORD = 'grovyn@123'` in `auth.js`. It is **not** read from any env var. | The env-flag pattern the kickoff assumes doesn't exist yet; it has to be built (and gated out of prod). |

None of these are blockers, but they change the Phase 1 scope: deployment,
branding, and the entire AI layer are **new build**, not refactor.

## 2. Backend audit (`backend/src`)

### Keep (good seams, minor changes)
- `app.js` / `server.js` / `bootstrap.js` — clean separation of app wiring vs.
  boot vs. listen. Keep the shape; `bootstrap` will change from "run seed" to
  "connect DB + optional seed".
- `routes/v1/index.js` — central route table with explicit `adminOnly` /
  `adminOrStaff` middleware arrays. This is the right place to enforce tenancy;
  the seam is already there.
- `middleware/authMiddleware.js` — the `requireAuth` / `requireRole` /
  `requireStoreAccess` structure is a good skeleton. **Must be extended** with a
  tenant guard and re-derived roles (see Refactor).
- `config/index.js` — central env config. Keep the pattern; fix the insecure
  defaults (§4 Security).

### Refactor (good logic, wrong data foundation)
- **All of `services/*` and `engines/*`** (~30 files: `financeService`,
  `profitEngine`, `inventoryService`, `storeHealthService`,
  `executiveBriefService`, `metricsEngine`, etc.). The *business math* (margins,
  profitability, store-health signals, commission) is reusable and reasonably
  factored, but every service today reads from in-memory arrays initialized by
  `initX(seedData)`. Each needs to become tenant/branch-scoped and DB-backed.
  Recommend porting incrementally, module by module, not a big-bang rewrite —
  the computation logic is the valuable part.
- `routes/v1/stores.js`, `routes/inventory.js`, `routes/staff.js`, etc. — the
  handlers do STAFF filtering **in the handler** (`if role==='STAFF' filter by
  storeIds`). This works but is fragile: it's opt-in per handler and easy to
  forget on the next endpoint. Refactor to enforce scoping at the data-access
  layer so a missed filter fails closed, not open.
- `routes/auth.js` — keep the shape, but login must be re-backed by real user
  records (per tenant), real password hashing (bcrypt/argon2), and a tenant in
  the token. Currently it mints a token for *any* email + shared password +
  self-asserted role.
- `models/index.js` — JSDoc typedefs only ("No ORM; plain structures"). Becomes
  the ORM schema / migrations, owned by database-administrator.

### Rewrite / Build-new
- **Persistence layer** — none exists. New: ORM, migrations, connection mgmt,
  transactions. (DECISIONS_LOG D-001/D-002.)
- **Tenant model** — new across the board.
- **AI service (`aiService`)** — new; wraps Hugging Face with timeout/retry/
  fallback/cache. Nothing to inherit.
- **File import (Excel/CSV)** for sales/inventory — not present; new.
- **Audit-log tables** (append-only inventory edits, staff actions, tax) — new.
- **Notifications** (staff→admin) — not present; new.

### Remove / Gate
- `seed/generator.js`, `seed/index.js`, `seed/seededRandom.js`,
  `data/expansionLocations.js` — the synthetic data factory. **Do not delete** —
  per database-administrator guidance, keep behind an explicit demo/seed env
  flag so the demo path survives. But it must be **impossible to reach in
  production** and must never mint real tenant data.

### Notable backend bugs found
- `server.js` **port-fallback footgun**: if the requested `PORT` is in use, the
  server silently falls back to `3001`. Under the `verify` harness (which starts
  the server on a test port and polls that exact port for health), a busy port
  makes the server bind elsewhere and the test hang. Latent CI flakiness.
- `authMiddleware` tokens have **no expiry** (no `exp`), so a leaked token is
  valid forever. (Also a security finding — see baseline review.)

## 3. Frontend audit (`frontend/src`)

### Keep
- `services/api.ts` — clean Axios factory with token injection + 401 → logout
  interceptor, typed `apiPaths`. Good pattern; extend `apiPaths` per module.
- `auth/AuthContext.tsx` — solid session context (localStorage persistence,
  stateless-token detection, memoized api). Keep; extend session shape with
  `tenantId` + richer role/permission model.
- `components/ui/*` (button/card/tabs), `components/*` (MetricCard, InsightCard,
  Sparkline, StatusBadge), Tailwind config — reusable design primitives.

### Refactor
- `auth/RequireRole.tsx` + `app/router.tsx` — the RBAC gating is a **fixed
  two-role** (`ADMIN`/`STAFF`) model. `PROJECT_BRIEF.md` §2 requires
  Admin-defined staff roles with **per-branch permissions**. `RequireRole` needs
  to become permission/capability-aware, not role-string-equality-aware. Route
  table stays, gating logic changes.
- `AuthContext` `storeIds` → needs to become tenant + branch + permission set.
- All pages (`Dashboard`, `Finance`, `Stores`, `Operations`, `Alerts`,
  `ScaleSimulator`, `RepeatEngine`) render synthetic single-tenant data. Keep
  the visual components; rewire to tenant-scoped API responses.

### Note
- `.env.example` references Vercel/Netlify only; no multi-tenant/branding config.

## 4. Security posture inherited (summary — full detail in `SECURITY_REVIEWS/000-baseline-owasp.md`)

Ranked, worst first:
1. **CRITICAL — Forgeable auth tokens.** `sessionSecret` defaults to the public
   literal `'demo-secret-change-in-production'`. Tokens are HMAC-signed with
   this. If `SESSION_SECRET` is unset in any deploy, **anyone can forge an ADMIN
   token** for any store set. (OWASP A02/A07.)
2. **CRITICAL — Auth is a shared password + self-asserted role.** No user
   records exist. `login` accepts any email + `grovyn@123` + a client-chosen
   `role: "ADMIN"`, and grants all stores. (OWASP A01/A07.)
3. **HIGH — No tenant isolation exists to inherit.** Every query is global.
   This is the top standing risk for the target product and must be built, not
   reviewed-in later. (OWASP A01.)
4. **HIGH — Tokens never expire.** No `exp`, no rotation, no revocation on
   staff removal. (OWASP A07.)
5. **MEDIUM — No brute-force protection / rate limiting** on login. (A07.)
6. **MEDIUM — Demo seed path not gated** from production. (A05.)
7. **LOW/INFO — CORS `*` in dev**, verbose bootstrap logging, `credentials:true`
   with an origin allowlist that includes localhost.

## 5. What I'd reuse vs. rebuild — one-line verdict

- **Reuse the skeleton:** layering, route table, auth-middleware seams, Axios
  client, UI component library, and most business-math services (ported).
- **Rebuild the foundation:** persistence, tenancy, real users/roles/permissions,
  AI service, file import, audit logs, notifications, deployment, branding.
- **Do not build the new platform as workarounds on demo-shaped code.** The
  in-memory seed layer and the two-role RBAC are the two things most likely to
  tempt a shortcut; both must be replaced at the foundation, not wrapped.
