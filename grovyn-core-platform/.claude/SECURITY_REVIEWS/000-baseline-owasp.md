# Security Baseline — Grovyn Autopilot template (pre-Phase-1)

> Baseline OWASP Top 10 review of the **inherited** code, so we know what we're
> building on before we build. This is a review of the demo template, not of new
> work. Findings block nothing yet (no tenant data exists), but SEC-01..SEC-04
> **must be closed before any real tenant onboards**. Severity: Critical / High /
> Medium / Low.

## Verdict
**Not production-safe as-is.** The template is fine as a demo; it must not be
pointed at real data or a public prod URL until SEC-01..SEC-04 are fixed. The
single most important structural gap — multi-tenant isolation — does not exist
to review; it must be built (see D-001).

## Findings

### SEC-01 — Forgeable session tokens via default secret — CRITICAL (A02 Cryptographic / A07 Auth)
- Location: `backend/src/config/index.js:31`, `backend/src/middleware/authMiddleware.js:25,32-41`.
- `sessionSecret` defaults to the public literal `'demo-secret-change-in-production'`.
  Session tokens are `base64url(payload).HMAC-SHA256(payload, secret)`. Anyone
  who reads this repo can compute a valid signature for
  `{userId, role:"ADMIN", storeIds:[...]}` if `SESSION_SECRET` is unset in the
  deployment. Result: full admin impersonation, any store.
- Fix: **Fail server boot if `SESSION_SECRET` is unset/weak in production.**
  Never ship a usable default. Rotate secret capability. (Owner: backend-developer.)

### SEC-02 — Authentication is a shared password + self-asserted role — CRITICAL (A01 Access Control / A07)
- Location: `backend/src/routes/auth.js:18,25-69`.
- There are no user records. `login` accepts *any* `email`, the single hardcoded
  password `grovyn@123`, and a client-supplied `role`. Sending `role:"ADMIN"`
  grants a token scoped to **all** stores. Identity and authorization are both
  attacker-controlled.
- Fix: Real per-tenant users, hashed passwords (argon2id/bcrypt), role/permission
  derived server-side from the user record — never from the request body.
  (D-005.)

### SEC-03 — No tenant isolation (structural) — HIGH/CRITICAL-by-design (A01 / A04 Insecure Design)
- Location: entire `services/*`, `routes/*`; no `tenant_id` exists.
- Every query is global. This is acceptable for a single-tenant demo but is the
  #1 risk for the target product. It cannot be "reviewed in" after the fact —
  the tenant boundary must be designed into the schema, DAL, middleware, cache
  keys, file imports, and AI prompts from Phase 1. (D-001.)

### SEC-04 — Tokens never expire; no revocation on staff removal — HIGH (A07)
- Location: `authMiddleware.js:32-68` (no `exp`, no `iat`, no revocation list).
- A leaked/exported token is valid forever. When an Admin removes a staff member
  (a §2 requirement), their existing tokens keep working.
- Fix: short-lived access tokens + refresh/rotation, and a revocation path tied
  to the user lifecycle.

### SEC-05 — No brute-force / rate limiting on login — MEDIUM (A07)
- Location: `routes/auth.js`, no throttling middleware.
- With a shared password today it's moot, but the real login needs per-IP /
  per-account rate limiting and lockout.

### SEC-06 — Demo seed path not gated from production — MEDIUM (A05 Misconfiguration)
- Location: `bootstrap.js`, `seed/*`. `runBootstrap()` always runs the synthetic
  seed. In the target, seed/demo mode must sit behind an explicit env flag and be
  unreachable in production so it can never mint or overwrite real tenant data.
  (Keep the demo path per DBA guidance — gate it, don't delete it.)

### SEC-07 — CORS + verbose logging — LOW/INFO (A05)
- Location: `config/index.js:11-15` (dev `origin:'*'`), `app.js:12-18`
  (`credentials:true` with allowlist), `server.js`/`bootstrap.js` console logs.
- Dev `*` is fine for dev; ensure prod always uses the explicit allowlist and
  that `credentials:true` is never paired with `origin:true` in prod. Avoid
  logging counts/secrets in a way that leaks tenant info later.

## Not-yet-applicable (will apply as features land)
- **A03 Injection** — no DB or file parsing yet; becomes critical once the ORM
  and Excel/CSV import land (SQL injection via raw queries, CSV formula
  injection, oversized-file DoS).
- **A10 SSRF** — no outbound calls yet; becomes relevant with the Hugging Face
  integration (validate/allowlist the HF endpoint; no user-controlled URLs).
- **A08 Integrity** — audit-log tamper-evidence review applies once the
  append-only inventory/tax logs exist.

## Standing recommendations
- Add `npm audit` (backend + frontend) as a CI gate.
- Add security tests for tenant isolation (a Staff of tenant A must get 403/404,
  never data, for tenant B / another branch) as soon as tenancy lands.
