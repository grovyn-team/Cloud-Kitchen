> **PROVENANCE CORRECTION (added 2026-07-28 by project-master).** This file was
> presented (in the session that wrote it and in file 012) as output of the
> *registered* `decision-critic`. That is **FALSE**: no `decision-critic` subagent
> was ever invoked. It was written by the unregistered main session role-playing the
> critic persona. Treat its pass/fail criteria as **a useful draft to be reviewed**,
> **NOT** as an independent critic verdict and **NOT** as a satisfied gate. Original
> text preserved below unaltered for the audit trail.

# CRITIQUE 010 — D-002 / P1-00: pre-committed pass/fail criteria for the ORM spike

**Verdict: framing only (as requested) — no Prisma-vs-Drizzle pick. Two-way door
NOW, hardens fast once migrations accrue. NOT Blocking.**

> The user did **not** ask for an ORM verdict. The ask: define what the P1-00 spike
> must PROVE, as pre-committed criteria that can actually **fail** a candidate — so
> the result cannot be rationalized after the fact. That is what this file is.
> Infra is locked (build to it): Postgres container + one backend container, the
> ORM's own pool talks directly to Postgres, **no PgBouncer**, pool in the tens vs
> Postgres default max 100.

## How to use these criteria (the anti-rationalization rule)
1. Criteria **1–5 are binary PASS/FAIL and are frozen before the spike runs.**
   Record them verbatim in the spike doc *first*.
2. A candidate that **fails any of 1–5 is eliminated** — regardless of how good its
   developer experience is. **A "workaround" for a 1–5 failure IS the finding that
   it failed**, not a mitigation.
3. Only if **both** candidates pass 1–5 do the tie-breakers (6–8) apply, decided on
   **written evidence**, not preference.
4. If **both** candidates fail any of 1–5, the **approach** is wrong, not the ORM —
   **escalate** (rethink the RLS/pooling pattern); do not pick the less-bad one and
   proceed.
5. **Pre-register the numbers** — pool size, concurrent request count, tenant count,
   and the exact expected row counts — before running. A "close enough" result may
   not be reinterpreted as a pass.

## The binary gates (must ALL pass)

**1. Transaction↔connection affinity.** Inside one ORM transaction:
`SET LOCAL app.current_tenant = A`, then `SELECT current_setting('app.current_tenant'), pg_backend_pid()`.
The GUC must read `A` and the pid must be stable within the txn.
**FAIL** if the ORM can route the `SET` and the query to different physical
connections. (This is the single most decisive test — it is the whole reason RLS +
a pool is a "sharp edge.")

**2. No cross-checkout leakage.** After a txn that set tenant A commits/rolls back
and its connection returns to the pool, a **fresh checkout that sets no context**
must see an **empty/NULL** GUC and RLS must return **zero rows** (fail-closed) — not
A's rows. **FAIL** if a new checkout inherits A's context. (The session-pool
analogue of the PgBouncer leak; must be proven, not assumed away because there's no
PgBouncer.)

**3. Concurrency isolation under contention.** Run N concurrent requests with
**N > pool size** (e.g. 50 concurrent, pool of 10), each setting a different tenant
and reading only its own rows. **FAIL** if **any** request reads another tenant's
row, or reads empty when its own data exists. A single-threaded pass means nothing;
this is the gate that matters.

**4. Fail-closed on missing context.** A query issued with **no** tenant context
(simulating a code path that bypassed the DAL) must return **zero rows** under RLS —
never all rows. **FAIL** if missing context yields an unrestricted read. (This
proves RLS is a real backstop — the entire justification for D-001.)

**5. Privilege separation is real.** The migration/seed role has `BYPASSRLS`; the
**application runtime role does NOT** (and is not a superuser). **FAIL** if the app
runtime connects as a role that bypasses RLS — the single most common way teams
silently void RLS while believing it is on.

## Tie-breakers (only if both pass 1–5; decide on evidence)

**6. Single-chokepoint ergonomics.** Context must be injectable in **one** place (a
txn wrapper / middleware) so ordinary query code needs no per-query awareness.
**FAIL bar:** if correct scoping requires each call site to remember to set context,
the candidate reproduces exactly the per-handler-filter fragility the DAL refactor
exists to kill (audit §2, SEC-03). "A dev writing a new endpoint does nothing
special and is scoped by default" is the pass condition.

**7. Migration workflow survives RLS.** The ORM's migrate/introspect/generate loop
must work against an RLS-enabled schema **without hand-written per-migration SQL
juggling**. **FAIL** if enabling RLS forces schema changes to become manual SQL.
(This is where Prisma has historically been sharp; a legitimate discriminator.)

**8. Failure is observable.** Wrong/missing context should surface as an explicit
error or empty set, not silent wrong data. Soft gate — record it; prefer the
candidate whose failure mode is loud.

## Separate flagged concern — the no-pooler decision (NOT reopening D-002)
**Endorsed with a trigger.** For one backend container + a pool in the tens against
Postgres max 100, an external pooler (PgBouncer) adds an RLS hazard (transaction
pooling breaks session GUCs) and ops cost for **no** benefit. No-pooler is not just
acceptable — it **actively de-risks RLS** (it is why gates 1–2 are tractable).
**Revisit trigger:** when `app_instances × pool_size` approaches ~60% of Postgres
`max_connections`, or if serverless/edge is ever reintroduced. Until then, correct.

## Reversibility
ORM choice is a **two-way door at spike time** but **hardens quickly** once
migrations and query code accrue against it — which is exactly why the spike must
run **before the first migration** (P1-00 → P1-01 ordering on the board is right).
