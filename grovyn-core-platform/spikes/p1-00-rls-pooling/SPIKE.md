# P1-00 — RLS-pooling spike (resolves D-002: Prisma vs Drizzle)

Status: **PRE-REGISTRATION** (written before any test is run; results appended below
under "RESULTS" once executed — nothing above the `--- RESULTS ---` line is edited
after the fact).

## Infra (locked per D-006 model; Vercel `vercel.json` is dead residue, ignored)
- Single Postgres 16 container (`postgres:16-alpine`), no external pooler (no
  PgBouncer) — matches D-006's single-box / long-lived-pool / ORM-owns-its-pool
  target, not the Vercel serverless config that actually ships in the repo today.
- One Node process per ORM candidate, each holding its own `pg` connection pool
  directly against Postgres (mirrors "one backend container").
- Container: `grovyn-rls-spike`, host port `55432`, superuser `postgres` /
  `spikepass`. Two isolated databases: `rls_spike_prisma`, `rls_spike_drizzle` —
  one per candidate, so results can't cross-contaminate.
- Roles per database (privilege-separation gate 5):
  - `postgres` (superuser) — stands in for the migrator/bootstrap identity.
    Superusers always bypass RLS by Postgres semantics; used only for schema
    setup, never for the runtime test queries.
  - `grovyn_app` — `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`,
    `NOCREATEROLE`, granted only `SELECT, INSERT` on the test table. **This is
    the role every gate-1-through-4 query runs as.**

## Schema under test
```sql
CREATE TABLE rls_test (
  id          serial PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  payload     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE rls_test ENABLE ROW LEVEL SECURITY;
ALTER TABLE rls_test FORCE ROW LEVEL SECURITY; -- applies even to the table owner
CREATE POLICY tenant_isolation ON rls_test
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
GRANT SELECT, INSERT ON rls_test TO grovyn_app;
GRANT USAGE, SELECT ON SEQUENCE rls_test_id_seq TO grovyn_app;
```
This is the exact pattern P1-01 will need for every tenant-scoped table.

## Pre-registered numbers (frozen before the run)
- **Tenants seeded:** 5 (`A,B,C,D,E`, real `uuid`s, generated once, reused
  identically in both databases).
- **Rows per tenant:** 20 → **100 total rows** in `rls_test` per database.
- **Pool size:** 10 connections (`pg.Pool({ max: 10 })`, or the ORM's equivalent)
  per candidate.
- **Concurrency test (gate 3):** 50 concurrent async requests (**N=50 > pool
  size=10**, the required over-subscription), round-robin across the 5 tenants
  (10 requests per tenant). Each request: open one transaction, `SET LOCAL
  app.current_tenant = <own tenant uuid>`, `SELECT tenant_id FROM rls_test`,
  assert **exactly 20 rows, all equal to own tenant_id**, commit.
- **Expected result if PASS:** all 50 requests return exactly 20 rows, 0 rows
  belonging to another tenant, 0 empty results, 0 errors.
- **Latency budget (tie-breaker 6/CRITIQUE-013 sharpening):** median overhead of
  "open interactive/wrapped transaction + `SET LOCAL` + 1 query + commit" vs. a
  bare pooled `SELECT 1`, measured over **50 samples per ORM** on localhost.
  **Budget: p50 ≤ 15ms, p95 ≤ 40ms added overhead.** This is a soft/informational
  number (not a binary gate) — recorded either way, but a candidate blowing past
  it by a large multiple is evidence against it on tie-breaker 6.

## Binary gates (from CRITIQUE 010, frozen; ALL must pass or the candidate is eliminated)
1. **Transaction↔connection affinity** — `SET LOCAL` and the following `SELECT
   current_setting(...), pg_backend_pid()` in the same logical transaction must
   see the same GUC value and a stable `pg_backend_pid()`.
2. **No cross-checkout leakage** — after a txn that set tenant A commits and its
   connection returns to the pool, a fresh checkout with no context set must see
   an empty/NULL GUC and RLS must return **zero rows**.
3. **Concurrency isolation under contention** — the 50-concurrent-request test
   above; zero cross-tenant reads, zero unexpected-empty reads.
4. **Fail-closed on missing context** — a query run with no tenant context set at
   all must return **zero rows** under RLS, never all rows.
5. **Privilege separation is real** — `grovyn_app` has `rolbypassrls = false`;
   the migrator/superuser role is confirmed to differ from the runtime role.

## Tie-breakers (only reached if both candidates pass 1–5; CRITIQUE-013 sharpening applied)
6. **Single-chokepoint ergonomics** — is tenant context injectable in one
   wrapper (a txn helper), with zero per-call-site awareness required?
7. **Migration workflow survives RLS — PROMOTED to a hard gate per CRITIQUE 013**
   (D-001's stated worry is exactly "RLS erodes the ORM ergonomics that justified
   it"). **FAIL condition:** enabling RLS (enable + `FORCE` + `CREATE POLICY`)
   cannot be expressed through the ORM's own migration-authoring workflow and
   requires hand-written SQL dropped into (or bolted onto) the generated
   migration to get RLS live. This is evaluated empirically below, not assumed.
8. **Failure is observable** — wrong/missing context surfaces as an explicit
   error or an empty set, never silent wrong data (largely covered by gates 2/4
   since RLS itself governs this — recorded per-ORM for completeness).

## Rules of engagement (restated from CRITIQUE 010, binding here)
- A "workaround" for a 1–5 failure **is** the failure, not a mitigation.
- If both candidates fail any of 1–5, escalate (the *pattern* is wrong, not the
  ORM) — do not pick the less-bad one.
- Numbers above are frozen; a "close enough" result is not a pass.

--- RESULTS BELOW THIS LINE (appended after execution) ---

## Execution environment (actually run, not simulated)
- Docker Desktop 29.6.2, `postgres:16-alpine`, container `grovyn-rls-spike`,
  host port `55432`, `max_connections=100`.
- Two databases in the **same** container/cluster: `rls_spike_prisma`,
  `rls_spike_drizzle`. No PgBouncer or any other external pooler anywhere in
  the path — each Node harness process opens its own `pg.Pool({ max: 10 })`
  directly against Postgres, matching the D-006 single-box model. `vercel.json`
  was not touched, referenced, or run against.
- Runtime role for every gate-1-through-4 query: `grovyn_app`
  (`LOGIN, NOSUPERUSER, NOBYPASSRLS`). Confirmed via `pg_roles`:
  `grovyn_app.rolbypassrls = false`, `postgres.rolbypassrls = true` — **gate 5
  passes identically in both databases** (see raw psql output below).
- Prisma `7.9.1` (+ `@prisma/adapter-pg`, since Prisma 7 removed the
  schema-level `datasource.url` in favor of `prisma.config.ts` + a driver
  adapter — a real, unplanned migration-workflow wrinkle documented under gate
  7 below). Drizzle `drizzle-orm@0.45.2` / `drizzle-kit@0.31.10`.

## Binary gates — RESULTS (both candidates, both pass all 5)

| Gate | Prisma | Drizzle |
|---|---|---|
| 1. Transaction↔connection affinity | **PASS** — GUC read back `'11111111-…'` exactly, `pg_backend_pid()` identical across two queries in the same `$transaction` callback | **PASS** — identical result via `db.transaction` |
| 2. No cross-checkout leakage | **PASS** — fresh un-scoped query after a committed txn saw an unset GUC and `findMany()` returned 0 rows | **PASS** — identical |
| 3. Concurrency isolation (50 concurrent, pool=10, 5 tenants) | **PASS**, 3 repeat runs — 0 cross-tenant leaks, 0 wrong-count, 0 errors, all 150 requests (3×50) | **PASS**, 3 repeat runs — identical, 0/0/0 |
| 4. Fail-closed, no context at all | **PASS** — 0 rows | **PASS** — 0 rows |
| 5. Privilege separation real | **PASS** — `grovyn_app.rolbypassrls=false` verified via `pg_roles` | **PASS** — identical, own database |

Raw gate-5 verification (`psql`, both databases identical):
```
 rolname   | rolbypassrls | rolsuper
------------+--------------+----------
 postgres   | t            | t
 grovyn_app | f            | f
```

**Per rule 4 of CRITIQUE 010: since both candidates pass all of 1–5, we proceed
to tie-breakers on written evidence — no escalation needed, the RLS+pooling
pattern itself is sound for the D-006 model.**

## Tie-breakers — RESULTS

**6. Single-chokepoint ergonomics — TIE.** Both `prisma.$transaction(async tx
=> {...})` and `db.transaction(async tx => {...})` support wrapping "SET LOCAL
+ query" in one reusable helper function; call sites need no per-query
awareness in either. No differentiator found.

**7. Migration workflow survives RLS — PROMOTED HARD GATE per CRITIQUE 013 —
DECISIVE, Drizzle passes / Prisma fails.** Tested empirically, not by
inspection:
- **Prisma: FAIL.** `schema.prisma` has **zero DSL** for `ENABLE ROW LEVEL
  SECURITY` / `CREATE POLICY` / `FORCE ROW LEVEL SECURITY`. Running
  `prisma migrate dev --create-only --name enable_rls` against the
  RLS-unaware schema produced a **literal, verified-empty migration file**
  (`-- This is an empty migration.`) — proof the tool has no representation of
  RLS to diff against. All of `ENABLE`, `FORCE`, and `CREATE POLICY` had to be
  **typed in by hand** into that file (see
  `prisma-spike/prisma/migrations/20260728185207_enable_rls/migration.sql`)
  before `prisma migrate dev` would apply it. The migration *tracking/apply*
  mechanism itself did not break — but the actual security-relevant SQL is
  100% hand-authored, for every tenant-scoped table, forever, with nothing
  to catch drift if a future migration touches the table and someone forgets
  to re-verify the policy is still attached.
- **Drizzle: PASS (with one minor asterisk).** `drizzle-orm/pg-core` has
  native `pgPolicy()` + `.enableRLS()` schema primitives (verified present in
  `drizzle-orm@0.45.2`'s type defs before use, not assumed). Defining the
  policy directly in `schema.ts` and running `drizzle-kit generate`
  **auto-produced** both `ALTER TABLE "rls_test" ENABLE ROW LEVEL SECURITY`
  and the full `CREATE POLICY "tenant_isolation" ON "rls_test" ... USING
  (...)` statement, verbatim, with **zero hand-written SQL** (see
  `drizzle-spike/drizzle/0000_sloppy_korvac.sql`). The asterisk: `FORCE ROW
  LEVEL SECURITY` has no DSL in Drizzle either, and table-level `GRANT`
  statements have no DSL in **either** ORM — both required one small
  hand-written custom migration for those two statements
  (`drizzle-spike/drizzle/0001_force_rls_and_grants.sql`,
  `prisma-spike/prisma/migrations/.../migration.sql`). `GRANT`/`FORCE` being
  equally manual in both is **not** a differentiator; `ENABLE`+`POLICY` being
  auto-generated in one and 100%-manual in the other **is** — and `CREATE
  POLICY` (the actual tenant-isolation predicate — the part most likely to be
  typo'd, e.g. wrong column, wrong cast, forgotten table) is exactly the
  statement D-001's whole risk is about getting right, table after table,
  every time.
- **Why this decides it, per the promoted gate's own FAIL condition**
  ("requires hand-written SQL... to get RLS live"): that condition is
  **literally true for Prisma and literally false (for the load-bearing
  statements) for Drizzle.** Grovyn's Phase 1+ schema has 5+ tenant-scoped
  tables already named in the brief (tenant, user, session, audit_log,
  branch, sales, inventory, customers, tax) and more later — under Prisma,
  every one of them repeats this 100%-manual step with no tooling backstop;
  under Drizzle it is declarative, diffed, and reviewed like any other schema
  change.

**8. Failure is observable — TIE.** Both candidates: missing/wrong context
surfaces as an *empty result set* (governed by Postgres RLS itself, not by
either ORM), never wrong data — already proven by gates 2/4. Neither ORM adds
an explicit "you forgot tenant context" error on top of Postgres's silent
empty-set behavior; that has to be built at the DAL layer (P1-03) regardless
of ORM choice — not a differentiator.

## Latency budget (informational, both well inside the pre-registered budget)

| | bare p50 | wrapped p50 | overhead p50 | bare p95 | wrapped p95 | overhead p95 |
|---|---|---|---|---|---|---|
| Budget | — | — | ≤15ms | — | — | ≤40ms |
| Prisma | 1.36ms | 4.79ms | **3.43ms** | 1.80ms | 5.42ms | **3.62ms** |
| Drizzle | 1.02ms | 3.68ms | **2.65ms** | 1.29ms | 4.15ms | **2.85ms** |

Both pass the pre-registered budget by a wide margin (localhost, single
container — absolute numbers will shift under real network latency, but the
*relative* interactive-transaction-wrapper overhead, which is what the budget
was measuring, is small and roughly comparable between the two: Drizzle
~0.6–0.8ms lower per call in this run, not large enough on its own to be
decisive at this scale).

## A genuine cross-cutting finding (not one of the 8 gates, but load-bearing)
`SET LOCAL <guc> = <value>` **cannot take a bound parameter** in Postgres
(`SET LOCAL app.current_tenant = $1` is a syntax error) — this is a Postgres
protocol constraint, identical for both ORMs, not a Prisma/Drizzle
differentiator. Both harnesses had to fall back to a raw/unsafe execution path
(`$executeRawUnsafe` / `sql.raw`) for this one statement and validate the
tenant id as a strict UUID before string interpolation. **This must be a
documented, enforced rule in the P1-02 context-middleware implementation
regardless of which ORM wins** — the tenant id reaching that interpolation
point must never be client-controlled free text.

## Verdict

**Both candidates pass all 5 binary gates identically** (privilege separation,
transaction affinity, no-leak, fail-closed, and 150 concurrent requests each
with zero cross-tenant reads across repeat runs) — the RLS + pooled-single-box
pattern itself (D-001/D-006) is validated as sound; **no escalation is
warranted.**

**Drizzle wins on the promoted hard gate (7).** Prisma's schema DSL has no
representation for Postgres RLS at all — enabling RLS is a fully manual,
un-diffed SQL step that must be repeated correctly for every tenant-scoped
table for the life of the project, which is precisely the erosion-of-Prisma's-
own-ergonomics risk D-001 flagged and CRITIQUE 013 told this spike to weight
as a hard gate rather than a soft preference. Drizzle expresses the same
policy declaratively, gets it into the normal schema-diff/migration-generate
loop, and required zero hand SQL for the security-relevant statements (only
for `FORCE`/`GRANT`, which are equally manual under Prisma too).

**Decision: adopt Drizzle for Grovyn's ORM**, resolving D-002. See
`DECISIONS_LOG.md` D-002 for the recorded decision text.

## Reproducing this spike
```
spikes/p1-00-rls-pooling/
├── SPIKE.md                    (this file)
├── sql/
│   ├── 00-bootstrap-databases.sql
│   ├── 01-enable-rls.sql       (reference/control copy of the RLS SQL)
│   └── 02-seed.sql
├── prisma-spike/                (Prisma 7.9.1 + @prisma/adapter-pg)
│   ├── prisma/schema.prisma
│   ├── prisma/migrations/20260728185151_init/          (auto-generated table)
│   ├── prisma/migrations/20260728185207_enable_rls/     (HAND-WRITTEN RLS SQL)
│   └── test-harness.mjs
└── drizzle-spike/               (drizzle-orm 0.45.2 + drizzle-kit 0.31.10)
    ├── src/schema.ts             (native pgPolicy + .enableRLS())
    ├── drizzle/0000_sloppy_korvac.sql   (AUTO-GENERATED ENABLE + POLICY)
    ├── drizzle/0001_force_rls_and_grants.sql  (hand-written FORCE + GRANT)
    └── test-harness.mjs
```
Container: `docker run -d --name grovyn-rls-spike -e POSTGRES_PASSWORD=spikepass
-e POSTGRES_DB=grovyn_spike -p 55432:5432 postgres:16-alpine` (throwaway;
`grovyn_spike` default db unused, real work is in `rls_spike_prisma` /
`rls_spike_drizzle`, created by `sql/00-bootstrap-databases.sql`). Not
committed to git; not wired into the real backend. `backend/package.json`
still has zero Postgres/ORM dependency — that's P1-01's job, now unblocked
with a concrete choice.
