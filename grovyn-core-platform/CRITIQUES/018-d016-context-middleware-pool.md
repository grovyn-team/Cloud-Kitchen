# CRITIQUE 018 — D-016: P1-02 S2/S3 tenant-context middleware + runtime pool

- Date: 2026-07-29
- Reviewer: decision-critic (genuine, registered gate)
- Scope: D-016 (P1-02 sub-tasks S2 + S3). Does the critic gate pass so D-016 may
  move to Accepted, and is S4's security-engineer pass clear to proceed?
- Artifacts read directly (not the prose summary):
  `backend/src/db/pool.js`, `backend/src/middleware/tenantContext.js`,
  `backend/tests/tenantContext.pgtest.mjs`, `backend/.env.example`,
  `backend/node_modules/pg-pool/index.js` (the actual installed library source),
  DECISIONS_LOG D-014/D-015/D-016, TASK_BOARD P1-02 row.

## Verdict: ENDORSE WITH CHANGES (Significant). Gate SATISFIED — D-016 may move to Accepted. S4 security pass is CLEAR to proceed.

No Blocking finding. Two Significant forward-spec findings (neither edits the
S2/S3 artifacts; both land on P1-03/P1-04), three Minor. The single
highest-stakes claim in the whole design — that `client.release(err)` destroys a
poisoned connection instead of recycling it — was verified against the actual
`pg-pool` source, not accepted on the code's or the report's say-so, and it
holds.

---

## 1. The decision, restated

D-016 frames itself as "env-var shape + middleware shape." That undersells one
half and oversells the other.

- The env-var half (choice 3: `DATABASE_APP_URL`, zero fallback) is not really a
  decision under contention — it is the mechanical closure of SECURITY_REVIEWS/002
  IR-03. There is no serious alternative; reusing `DATABASE_URL` was correctly
  rejected. Low-stakes, correct, done.
- The middleware half (choices 1, 2, 4) is the load-bearing decision, and what is
  *actually* being decided is bigger than "how S2 hands a connection to a
  handler." **It is the request-to-transaction contract that every route handler
  in the product — P1-03's DAL, P1-04's auth routes, P1-07's ported services, and
  everything after — will be written against.** The `(req, db) => result` shape,
  the frozen `{ query }` surface, the commit-before-response ordering, and the
  `{ status, body }` return envelope are a public contract the moment the second
  handler exists. That is where the scrutiny belongs, and it is *not* the two-way
  door the entry claims. See §6.

## 2. Goal alignment

Direct to **O4 (Trust it)**, and legitimately infrastructural: it names the
capability it unblocks (every tenant-scoped request path, P1-03 onward). The
transaction-scoped GUC + connection-discard is the runtime half of the tenant
isolation guarantee whose schema half was D-014. No part of either file traces to
no outcome. Clean.

## 3. Strongest case for

The commit-before-response design is not merely defensible, it is *more correct*
than the pattern it rejects. The standard `req.db` + `res.on('finish')` commit
pattern commits after the response is flushed — a COMMIT failure then arrives at a
client already told "200 OK," silently losing data it believes it persisted. The
HOF form makes "commit succeeded" a strict precondition of "response sent" by
construction: verified in code — a COMMIT throw at line 107 is caught, rolls back,
discards the connection, and returns a 500 (never a 200). That is the property you
want on financial data, and it is genuinely enforced, not aspirational.

The structural containment is also real and not decorative: `pool` is a closure
parameter, never re-exported; the handler gets a frozen `{ query }` with no
`.release()`/COMMIT surface and no `res`. A handler *cannot* reach the pool or
manage the transaction by accident. That is the "structurally hard to bypass
context-setting" requirement met literally.

And the defense-in-depth against GUC leak is genuinely two independent
mechanisms, both verified: (a) `set_config(..., true)` is transaction-scoped and
auto-resets on COMMIT/ROLLBACK (so the happy path never leaks — test S2.5
confirms), and (b) any error discards the connection entirely (so even a failed
ROLLBACK on a protocol-broken connection can't return poisoned state to the pool).

## 4. Strongest case against (mandatory)

The contract has a latent ambiguity that will bite once handlers proliferate, and
the design leaves a real hole in the one request path it doesn't serve (login).
Both are in §5/§7. The strongest *pure* case against is narrower: the
commit-before-response ordering does not — and cannot — eliminate the
at-least-once window. If COMMIT succeeds (line 107) and the socket write at line
137 then fails (client disconnected mid-flight), the data is persisted and the
client never receives its 200. For an idempotent GET this is nothing; for a
non-idempotent write (order creation, a tax filing draft, a payment) the client
cannot distinguish "it didn't happen" from "it happened but I didn't hear back,"
and a naive retry double-writes. This is not a defect of D-016 — no
single-transaction design escapes it without idempotency keys — but the entry's
framing ("makes commit-succeeded a precondition of response-sent") can read as if
exactly-once was achieved. It was not. See finding F4.

## 5. The cost nobody mentioned

**F1 (Significant) — the `{ status, body }` response envelope is duck-typed, and
domain data collides with it.** `tenantContext.js:134`:
`if (result && typeof result === 'object' && 'status' in result && 'body' in
result)`. A handler that returns a *data row* which legitimately owns `status` and
`body` columns — a support ticket, a CMS post, a webhook-delivery record, an
HTTP-audit entry — will be silently reinterpreted as an envelope and sent as
`res.status(row.status).json(row.body)`. `res.status('open')` on a string status
is not even a valid HTTP code. This is a correctness footgun (not a cross-tenant
leak — the data is still the right tenant's), but it is exactly the kind of
convention that ossifies the moment P1-03/P1-04 write handlers against it, and
un-picking it later touches every handler. The presence-of-two-property-names test
is the wrong mechanism; the envelope should be an explicit tagged value (a small
`reply(status, body)` helper returning a branded object, or a `Symbol` tag), so
domain data can never accidentally satisfy it. Cheap now, wide later.

**F2 (Significant, "what's not being built") — there is no blessed pre-context
execution path for the D-015 resolvers, and the doctrine as written forbids the
only one that exists.** `pool.js:20-25` states the doctrine: "Nothing should import
`pool` directly to run a request-time query; go through `tenantContext.js`'s
`withTenantContext()`." But login (P1-04) *must* run `resolve_tenant_by_slug` /
`authenticate_lookup` on `grovyn_app` with **no tenant context** — i.e.
explicitly *not* through `withTenantContext`, which would 400 on the missing
`req.tenantId` before any query runs. So P1-04 is handed two bad options: import
the raw `pool` (violating the stated doctrine and losing every structural
guardrail S2 just built) or invent an ad-hoc path. This is the classic "everyone
assumes another task owns it" gap: D-015 built the resolvers, S2/S3 built the
scoped path, and neither built the *sanctioned pre-context path* that ties them
together. Correctly out of scope for S2/S3 — but it must be a **named deliverable
for P1-04**, and it should be as constrained as `withTenantContext` (e.g. a
`runPreContextQuery(pool, fn)` helper that is the *only* other place `pool` is
touched), so the pre-context path is not the one spot where someone reaches for
the raw pool. Flag it now, on this row, or it gets rediscovered as a surprise when
login is wired.

**F3 (Minor) — `pg` config assumptions the pool inherits silently.** `pool.js`
constructs `new pg.Pool({ connectionString })` with everything else defaulting:
`max: 10`, `idleTimeoutMillis: 10000`, no `statement_timeout`, no
`connectionTimeoutMillis`. Sizing is correctly deferred (commented). But the
absence of a `statement_timeout` means a wedged query holds a pooled connection
for up to the OS TCP timeout — under the deliberately-small production pool this is
a self-inflicted availability foot-gun on the single-box (D-006) target. Not a
P1-02 defect; name it for P7 deployment config / P1-03.

**F4 (Minor) — at-least-once residual (see §4).** Forward-spec for P1-04+:
non-idempotent writes need an idempotency-key mechanism; the transaction wrapper
cannot and does not provide exactly-once. The entry already flags the
streaming/custom-header limitation; add this one beside it.

## 6. Reversibility

The entry classifies D-016 as a **two-way door** ("no table/policy/data touched").
That is true in the literal data sense and *misleading* in the sense that matters.

- Env-var shape (choice 3): genuine two-way door, and cheap. Fine.
- The handler contract (choices 1/2/4): a **soft one-way door**. It commits no
  data, but it is the interface every future handler is written against. Once
  P1-03/P1-04/P1-07 have dozens of handlers shaped `(req, db) => result` returning
  bare objects or `{status, body}` envelopes, changing the shape is a
  product-wide refactor, not a library swap at the edge. This is precisely why F1
  (the envelope ambiguity) must be fixed *now*, while the handler count is zero —
  the reversibility window is open today and closes with the first real routes.

Getting this classification right is the point: the user should spend attention on
the contract (F1), not on the env-var choice (settled).

## 7. What would have to be true for this to be wrong

- **`client.release(err)` must genuinely destroy the connection.** VERIFIED TRUE
  against the installed source, not memory: `pg-pool/index.js` `_release` (line
  392) — `if (err || this.ending || !client._queryable || ...) return
  this._remove(...)`; `_remove` (line 181) calls `client.end(...)`, physically
  closing the backend connection. A truthy arg to `release()` therefore destroys
  rather than recycles. If this were false, a poisoned/mid-transaction connection
  would return to the pool and could leak GUC state to the next borrower — the
  worst failure the design has. It is not false.
- **The GUC must be transaction-scoped, not session-scoped.**
  `set_config('app.current_tenant', $1, true)` — the literal `true` is `is_local`,
  equivalent to `SET LOCAL`, reset on COMMIT/ROLLBACK. Verified by test S2.5 (fresh
  checkout post-commit reads empty). True.
- **The bound parameter must actually be inert, not interpolated.** The injection
  test (`runBoundParameterInjectionCheck`) passes `"x'; DROP TABLE tenant; --"` as
  the *value*, confirms it echoes back verbatim, and confirms via the BYPASSRLS
  migrator connection that `tenant` survived. Genuinely proves parameter binding,
  not "should be safe." True.
- **Nothing is wired into the live app.** VERIFIED: grep of `backend/src` shows
  only `tenantContext.js` and `pool.js` reference these symbols; `app.js`/routes
  untouched. True, and the right call — mounting a diagnostic route that trusts a
  client-supplied tenant id would itself violate the architecture rule.
- **Unverified-but-low-stakes:** that the concurrency test exercises cross-tenant
  *reuse* and not just reuse. See F5.

**F5 (Minor) — the concurrency test proves reuse and zero-leaks, but does not
assert cross-tenant reuse on the same connection.** `runS3ConcurrencyCheck` asserts
`pidsUsed.size <= POOL_SIZE` (reuse happened) and `crossTenantLeaks === 0`. Under
`pool=3`, strict A,B,A,B alternation, 24 concurrent requests, and a forced
`pg_sleep(0.05)` overlap, a connection freed by an A-request is handed to the next
queued B-request — cross-tenant reuse is *overwhelmingly forced*. But the test
never captures `pid → tenant` to assert "PID X served both A and B." A hypothetical
(non-real) pg that pinned connections per-tenant would still pass with zero leaks.
The correctness *guarantee* is structural (transaction-scoped GUC + discard-on-
error, both independently verified) and is triangulated by S2.5 + the injection
test, so this is corroboration-strength, not a hole — but the assertion is one line
short of airtight. Sharpen: track `pid → Set<tenant>` and assert at least one pid
served >1 tenant. Not blocking; the safety claim does not rest on this test alone.

## 8. Self-review flag

The DBA/backend-developer runs on my model family, so agreeing with myself is the
easy failure. Where I pressed hardest:

1. **`release(err)` semantics** — I did not trust the code comment or the report.
   I read `pg-pool`'s actual `_release`/`_remove` and confirmed `client.end()` is
   called. This is the one claim that, if wrong, silently defeats the whole
   design; it is correct.
2. **The `{status, body}` envelope** — this is exactly the kind of convenient
   duck-typing my model family writes without questioning, so I attacked it and
   found the domain-data collision (F1).
3. **The pre-context path (F2)** — I checked whether S2/S3 compose with D-015's
   resolvers and found the doctrine in `pool.js` actively contradicts the one path
   login must take. This is the "what's not being built" check earning its keep.

## Objection I tried and why it fails

*Objection tried:* "Block — the handler contract is a soft one-way door (§6) with a
latent correctness bug (F1) baked in at the exact chokepoint every future handler
inherits; freezing it now with the `{status,body}` ambiguity unresolved is the
kind of thing that closes before its own gate."

*Why it fails:* zero handlers exist against it yet, no data lands on it, and F1 is a
one-file fix while the handler count is still zero — the reversibility window is
open *today*. It is a required change (Significant), not a reason to refuse the
work. The isolation guarantees the task actually had to prove — GUC transaction-
scoping, connection discard-on-error, no-fallback pool, bound-parameter inertness —
are all verified sound. That is Endorse-with-changes, not Block.

## S4 clearance

The security-engineer S4 pass is **CLEAR to proceed**. None of F1–F5 undermines the
three things S4 must confirm: IR-03 no-fallback (verified true, code + child-process
probe), genuinely-distinct roles everywhere (verified), and GUC pooling-safety under
real contention (verified structurally + by the oversubscription test). S4 should
*additionally* note F2 (pre-context path) as security-adjacent for P1-04, but it is
a forward spec, not a gate on S2/S3.

## Required changes (all forward specs; none block Accepted or S4)

1. **[P1-03, before handlers proliferate]** Replace the `{status, body}` duck-typed
   envelope with an explicit tagged value (branded helper or `Symbol`). F1. This is
   the reversibility-window-closing item — do it first.
2. **[P1-04]** Own and name the sanctioned pre-context execution path for D-015's
   resolvers (a constrained `runPreContextQuery`-style helper), and reconcile
   `pool.js`'s "always go through withTenantContext" doctrine with login's
   legitimate need to run pre-context. F2.
3. **[P7 deploy config / P1-03]** Set `statement_timeout` (and consider
   `connectionTimeoutMillis`) on the runtime pool before production. F3.
4. **[P1-04+]** Idempotency-key mechanism for non-idempotent writes; document the
   at-least-once residual beside the existing streaming/header caveat. F4.
5. **[test hardening, non-gating]** Assert cross-tenant reuse on the same PID in the
   concurrency test. F5.
