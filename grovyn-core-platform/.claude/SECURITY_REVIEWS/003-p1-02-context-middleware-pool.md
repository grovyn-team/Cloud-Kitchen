# Security Review 003 — P1-02 S2/S3 tenant-context middleware + runtime connection pool (independent DoD gate)

> **Independent** OWASP-Top-10 security-engineer pass on P1-02 (D-016), the final
> Definition-of-Done gate before P1-02 can move to Done. Every claim below was
> re-derived from the actual files and the actual installed `pg-pool` source —
> not inherited from CRITIQUE 017/018, SECURITY_REVIEWS/002, or the implementer's
> report. Clean restart (a prior attempt hit a session limit before persisting).
>
> Artifacts reviewed line-by-line:
> `backend/src/db/pool.js`, `backend/src/middleware/tenantContext.js`,
> `backend/tests/tenantContext.pgtest.mjs`, `backend/.env.example`,
> `backend/drizzle/0002_pre_context_auth_resolvers.sql`,
> `backend/node_modules/pg-pool/index.js` (installed library source),
> DECISIONS_LOG D-015/D-016, CRITIQUES 017/018, SECURITY_REVIEWS/002.

## Gate verdict: CLEAR WITH FOLLOW-UPS — P1-02 may move to Done.

No Critical, no High. The three things this pass had to confirm are all
independently verified true:
1. **IR-03 no-fallback** — `pool.js` reads only `DATABASE_APP_URL` and throws at
   import with zero fallback to `DATABASE_URL`/`DATABASE_MIGRATOR_URL`. Verified
   in code + by the child-process probe in the test suite.
2. **A03 bound-parameter `set_config`** — the `pg` call at `tenantContext.js:100`
   is a genuine extended-query bound parameter, not interpolation.
3. **A01 pooling safety** — no code path runs a query with no tenant context set
   through the middleware, and no GUC can survive a connection back into the pool.
   The load-bearing `client.release(err)` -> connection-destroyed claim was
   re-verified against the installed `pg-pool` source.

Nothing is wired into the live app (grep of `backend/src` confirms only
`pool.js`/`tenantContext.js` reference these symbols; app.js/routes untouched),
so every follow-up below lands on an unreachable surface today — none blocks
this gate, but SR3-01 must be closed before P1-03 mounts the first real route.

## Independent verification of the highest-consequence claim

**client.release(err) destroys the connection — VERIFIED against installed source.**
Read `backend/node_modules/pg-pool/index.js` directly, not the critique's memory of it:
- `client.release` is `_releaseOnce(client, idleListener)` (assigned at
  `_acquireClient`, line 342), which throws on double-release and otherwise calls
  `_release(client, idleListener, err)`.
- `_release` (line 384): `if (err || this.ending || !client._queryable || ...) return this._remove(...)`.
  A truthy `err` short-circuits to `_remove` before the connection can be pushed
  back onto `_idle`.
- `_remove` (line 172) calls `client.end(...)`, physically closing the backend connection.

So `release(handlerError)` (truthy) genuinely destroys the pooled connection
rather than recycling a possibly-poisoned session to the next borrower. On the
happy path, `release()` (no arg) falls through to `this._idle.push(...)` and
recycles — correct. (This installed copy has `_release` at line 384 / `_remove` at
line 172, not the 392/181 CRITIQUE 018 cited — a patch-version line drift; the
branch logic is identical in effect. I confirmed the installed file, which ships.)
Claim holds. CONCUR.

## OWASP-lens findings

### A03 Injection — CLEAN. No new findings.
- `tenantContext.js:100` calls `client.query` with the SQL string
  `SELECT set_config('app.current_tenant', $1, true)` and the values array
  `[tenantId]`. The template literal contains NO interpolation — `$1` is a literal
  protocol placeholder and `tenantId` is passed as a bound value over the
  extended-query protocol, not concatenated. The GUC key is a hardcoded literal;
  `is_local = true` (literal third arg) is transaction-scoped.
- `db.query` forwards `(text, params)` straight to `client.query` — handlers
  inherit real parameterization (their obligation to use it; nothing here
  interpolates on their behalf).
- No `format()`, `EXECUTE`, string concatenation, or dynamic identifier anywhere.
  The suite's injection check passes a `DROP TABLE tenant` payload as the value,
  confirms verbatim echo, and confirms `tenant` survives via the BYPASSRLS migrator
  connection — a genuine differential proof. CONCUR with CRITIQUE 018 section 7.

### A01 Broken Access Control / tenant isolation — SOUND. No new blocking findings.
Independently traced every branch of `withTenantContext`:
- No query runs before context is set. BEGIN -> set_config(...,true) -> handler,
  in that order, all inside one transaction. set_config is the first statement
  after BEGIN; the handler (and every db.query) only runs after the GUC is
  established in the same transaction. Fail-closed on missing/invalid tenantId
  (400 before any pool.connect()).
- No GUC survives into the pool. Two independent mechanisms, both verified:
  (a) is_local=true is transaction-scoped and auto-resets on COMMIT/ROLLBACK (test
  S2.5 confirms a fresh checkout reads empty); (b) any error path destroys the
  connection via release(err). There is NO session-level SET anywhere in the
  middleware, so nothing persists a GUC across checkouts by construction.
- Error-path ordering is correct. Any throw sets handlerError, skips COMMIT,
  attempts ROLLBACK (best-effort, logged if it fails), then unconditionally
  release(handlerError) and next(). No path commits after an error; no path
  releases without an error arg after a failed transaction. release() is called
  exactly once per path (happy: line 129; error: line 122) — no double-release
  against pg-pool's throwOnDoubleRelease.
- Commit-before-response genuinely makes commit-succeeded a precondition of 200:
  a COMMIT throw (line 107) is caught, rolls back, discards, and yields 500 — never
  a 200 on unpersisted data. Verified in code. CONCUR with CRITIQUE 018 section 3.
- Raw `pool` is exported, so a module could import it and run a context-less
  pool.query. From the isolation lens this is the SAFE direction: with no tenant
  context, RLS is fail-closed (zero rows / rejected writes), so it leaks nothing.
  The doctrine comment forbidding it is convention, not structural — but violating
  it fails closed, not open. Flip side of CRITIQUE 018 F2 (login NEEDS a
  pre-context path); reinforces it — see SR3-03.

### SR3-01 — Missing statement_timeout + connectionTimeoutMillis is a cross-tenant availability coupling, not merely "sizing" — MEDIUM (A05 Security Misconfiguration / availability).
CRITIQUE 018 F3 rated this Minor; from the security lens it is Medium.
- Location: `backend/src/db/pool.js:48-50` — `new pg.Pool({ connectionString })`
  with everything else defaulted: max=10, idleTimeoutMillis=10000, and NO
  statement_timeout, NO connectionTimeoutMillis, NO query_timeout.
- Why higher than Minor: with no statement_timeout, a wedged/slow query (lock
  contention, a pathological future query) holds its pooled connection until OS TCP
  timeout. With max connections so held and NO connectionTimeoutMillis,
  pool.connect() for every OTHER request queues indefinitely (confirmed in pg-pool
  connect() lines 206-209: with no connectionTimeoutMillis, a pending item is pushed
  to _pendingQueue with no timer). On the single-box D-006 target, ONE tenant's
  wedged queries can deny service to ALL tenants — a multi-tenant availability blast
  radius, which is a security property for this product, not a perf nicety.
- Not a P1-02 defect and does NOT block this gate: no route is wired. But timeouts
  are a safety control distinct from sizing and must be set before P1-03 mounts the
  first route (the P1-04 login path in particular needs a connectionTimeoutMillis so
  pool exhaustion returns an error instead of hanging login). Owner: DBA / backend
  at P1-03; deploy config at P7.

### SR3-02 — db.query is an unrestricted SQL surface; a buggy handler can leave non-tenant session state on a recycled connection — LOW (A01 defense-in-depth / A04). New; not in 017/018/002.
- The frozen `{ query }` handle correctly removes release()/COMMIT/res from the
  handler (CRITIQUE 018 section 3, confirmed). But db.query still runs arbitrary SQL.
  On the happy path, release() (no arg) recycles the connection WITHOUT a server-side
  reset — and COMMIT resets only SET LOCAL / is_local settings, not session-level
  state. So a handler running a session-level set_config(...,false), a bare SET, SET
  ROLE, a prepared statement, a temp table, or an unreleased advisory lock leaves
  that state on the connection for the next tenant's checkout.
- Tenant isolation SPECIFICALLY is not breached, and that is the load-bearing
  mitigation: every request re-runs set_config('app.current_tenant',$1,true) at
  BEGIN, and an is_local setting overrides any lingering session-level value for the
  duration of the new transaction. Escalation is closed too: grovyn_app is NOBYPASSRLS
  and non-owner, so SET row_security=off errors rather than bypasses, and SET ROLE
  only reaches roles it is a member of. The residual is non-tenant session leakage
  (search_path, timezone, temp objects, locks) — low today, but sharper alongside
  SR3-03: a context-less raw pool.query (which P1-04's pre-context path must avoid) on
  a connection carrying a leaked session-level app.current_tenant would read the
  leaked tenant's rows. Hardening rec (defense-in-depth, not blocking): DISCARD ALL
  (or RESET ALL / a fixed reset) on release, so a recycled connection is state-clean
  regardless of handler behavior. Owner: consider at P1-03 with the DAL, or P7.

### SR3-03 — CONCUR with CRITIQUE 018 F2 as security-adjacent: no sanctioned pre-context path exists, and the raw-pool escape hatch it forces interacts with SR3-02.
- F2 (Significant, forward-spec for P1-04) already owns this: login must run D-015's
  resolve_tenant_by_slug / authenticate_lookup on grovyn_app with NO tenant context,
  which withTenantContext would 400 before running, pushing P1-04 toward importing the
  raw pool. From the security lens I concur it is security-adjacent, not merely
  ergonomic: the sanctioned pre-context path should be a constrained helper (a
  runPreContextQuery(pool, fn) that is the only other place pool is touched), because
  a raw pool.query interacts badly with SR3-02 (leaked session GUC) and loses every
  structural guardrail S2 built. Does not block this gate (P1-04 unbuilt).

### SR3-04 — CONCUR with CRITIQUE 018 F1 (status/body duck-typing): confirmed essentially NO security dimension. My independent read.
- Concern: could `'status' in result && 'body' in result` (tenantContext.js:134)
  be leveraged for cross-tenant leak, over-disclosure, or an attacker-forced status?
  Independent analysis: no.
  - No cross-tenant leak / no over-disclosure. Whatever the handler returns was
    already fetched under the caller's tenant context (RLS-constrained). The
    duck-typing only changes WHICH field is serialized: res.json(result.body) sends a
    SUBSET (body) of an object already scoped to the right tenant — strictly less
    disclosure, never more, never another tenant's.
  - Status is not attacker-controlled in an exploitable way. Handlers are
    server-authored, not attacker SQL. The only attacker influence is a row value in a
    column named status/body (e.g. a support ticket). That yields res.status('open') —
    a non-integer newer Express rejects with a RangeError thrown at line 135, OUTSIDE
    the try/catch, in an async handler Express 4 will not catch -> unhandledRejection /
    hung request (connection already released at line 129, so no connection/txn leak).
    That is an availability/correctness footgun, not confidentiality or integrity.
- Verdict: CONCUR with CRITIQUE 018 — F1 is a correctness footgun with at most a thin
  availability edge, no confidentiality/integrity dimension. The fix (explicit
  tagged/branded envelope or a reply(status, body) helper, at P1-03 before handlers
  proliferate) is the same either way. Info-level from the security lens.

### A09 Security Logging Failures — CLEAN. No leak from these files.
- Server-side logs only, no sensitive data: tenantContext.js:120 logs a pg error for
  a FIXED ROLLBACK statement — no tenant_id, no user query text, no connection string.
  pool.js:58 logs an idle-client error object — a connection-level pg error, not
  tenant data.
- Client-facing: the middleware never builds a detailed error body. It emits a generic
  400 (line 78), and on any handler/txn error delegates to next(err) — it does NOT
  serialize the pg error to the client itself. Leak-safety therefore depends on the
  downstream Express error handler being non-verbose. The test app's handler is correct
  (generic InternalServerError, no stack; suite S2.4 asserts no stack leak). Standing
  dependency (not a P1-02 defect): the real error handler P1-03/P1-04 mount must not
  echo err.message/stack — a pg error from a failed set_config/BEGIN reaching a verbose
  handler could leak internal SQL/state. Consistent with the repo's generic-error-shape
  rule; carry it.

### A05 secrets in .env.example / test defaults — CLEAN, already tracked.
- .env.example adds DATABASE_APP_URL as a commented placeholder with accurate
  no-fallback / grovyn_app documentation. No real secret. The test file's default
  connection strings (grovyn_app:CHANGE_ME_APP@...) are throwaway-container defaults,
  env-overridable — not committed real credentials. bootstrap-roles.sql's CHANGE_ME_*
  remains SECURITY_REVIEWS/002 IR-02 (Medium, close before a reachable cluster) —
  unchanged by this task.

## D-015 (0002) quick independent glance (adjacent auth surface)
Not this gate's primary artifact (CRITIQUE 017 owns it), but re-read for the security
lens since the middleware will eventually sit beside it: both resolver functions are
LANGUAGE sql, SECURITY DEFINER, STABLE, SET search_path='', fully schema-qualified
(public.tenant, public."user", public.user_role), typed params substituted as values —
NO injection surface, and the search_path hijack is closed (empty path + qualification;
pg_catalog is always implicitly first, pg_temp is not searched for functions). EXECUTE
REVOKEd from PUBLIC, GRANTed to grovyn_app only. I concur with CRITIQUE 017's two
forward specs and note their security relevance so S4 discharges its scheduling duty:
- [P1-04] constant-time not-found path (dummy argon2id verify + uniform error) to close
  the user-enumeration timing oracle authenticate_lookup creates.
- [P1-10] assert the definer hinge live (SECURITY DEFINER, owned by a BYPASSRLS role,
  EXECUTE to grovyn_app only) to catch owner drift.
Neither blocks P1-02.

## Follow-ups (none blocks this gate; ordered by when they must close)
1. SR3-01 [MEDIUM — before P1-03 mounts routes] Set statement_timeout +
   connectionTimeoutMillis (and consider query_timeout) on the runtime pool. One
   tenant's wedged query must not hang the whole box. Raises CRITIQUE 018 F3 from Minor
   to Medium on the availability-blast-radius axis.
2. SR3-04 / CRITIQUE 018 F1 [P1-03, reversibility window open now] Replace the
   status/body duck-typed envelope with an explicit tagged value before real handlers
   exist. Security dimension is thin (availability only); do it for correctness, now.
3. SR3-03 / CRITIQUE 018 F2 [P1-04] Own and constrain the sanctioned pre-context
   execution path (runPreContextQuery-style helper), reconciling pool.js's "always go
   through withTenantContext" doctrine with login's legitimate pre-context need.
4. SR3-02 [LOW — P1-03/P7 hardening] Consider DISCARD ALL (or a fixed reset) on
   connection release as defense-in-depth against non-tenant session-state leakage
   across pooled checkouts. Tenant isolation is already protected by the per-request
   transactional re-set of the GUC; this is belt-and-braces.
5. Standing: downstream error handler for P1-03/P1-04 must stay generic (no
   err.message/stack to client) — carry from A09 note.
6. Carried from CRITIQUE 017: [P1-04] constant-time auth not-found path; [P1-10] assert
   the definer hinge live. Both scheduled, neither gates P1-02.

## Sign-off
Independent security-engineer DoD pass on P1-02 (S2/S3, D-016). CLEAR WITH FOLLOW-UPS —
P1-02 may move to Done. No Critical, no High. The isolation guarantees the task had to
prove — IR-03 no-fallback pool, bound-parameter set_config inertness, transaction-scoped
GUC with connection-discard-on-error (release(err) verified against installed pg-pool
source), fail-closed on missing context, nothing wired into the live app — are all
independently verified sound. One Medium follow-up (SR3-01) must close before the first
route ships; the rest are Low/Info forward specs. CONCUR with CRITIQUE 018's
security-relevance framing of F1 (no meaningful security dimension) and F2
(security-adjacent for P1-04).
