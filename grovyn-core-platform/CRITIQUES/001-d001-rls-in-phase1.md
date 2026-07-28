# CRITIQUE 001 — D-001 amended: Postgres RLS enabled in Phase 1

**Verdict: Endorse with changes — Significant. One-way door.**

> Provenance note: written during Phase 0 sign-off while the `decision-critic`
> agent was not yet registered (its file had no frontmatter). Authored by the
> main opus session. The original "defer RLS" recommendation came from the
> database-administrator agent (also opus) — this is same-model review and, by
> siding *against* the prior recommendation, at least isn't lazy self-agreement.
> Flagged per the agent's own rule.

## 1. The decision, restated
Not "should we use RLS" but **where the tenant trust boundary lives and *when*
the DB-enforced backstop is written into the schema.** The user has overridden
the DBA's "later hardening phase" and pulled RLS into the first migrations.

## 2. Goal alignment
**O4 (Trust it)**, most directly — multi-tenant data isolation is the product's
#1 risk (PROJECT_BRIEF §5.3).

## 3. Strongest case for
RLS is the only enforcement that survives developer forgetfulness across dozens
of endpoints and months of work. SEC-01..04 exist precisely because isolation
was left to discipline rather than structure. Retrofitting RLS onto a live schema
holding real financial data under a 72-month retention regime is the expensive,
risky direction — you must prove no existing row violates the policy and thread
context through every connection. Writing it into the first migration is cheap.

## 4. Strongest case against
RLS adds load to the auth critical path — the real Phase-1 foundation. It forces
a per-request `SET LOCAL app.current_tenant` inside a transaction that, with a
pool (especially PgBouncer transaction mode), is easy to get subtly wrong:
context leaking across pooled connections (worse than app-layer) or silently
empty result sets. **Prisma's RLS story is the sharp edge** — raw `SET LOCAL` on
the same connection as the query — exactly the "design around pooling for the
life of the project" cost the brief warned of, and an argument *for Drizzle*.
Two enforcement layers (DAL + RLS) can disagree and produce hard-to-debug
behavior. And there is **zero tenant data in Phase 1**, so the only real argument
is retrofit cost, not present risk.

## 5. The cost nobody mentioned
RLS forces the ORM + pooling decision **now**, and taxes **every** future
migration, seed, and background job (remember the BYPASSRLS role or set the
context) and **every** integration test (set context or get empty results) —
permanently.

## 6. Reversibility
**One-way door** (correctly classified). Early is the conservative choice; adding
RLS later onto live data is the expensive direction, removing it is cheap.

## 7. What would have to be true for this to be wrong
If Prisma is chosen and its RLS plumbing erodes the very query ergonomics that
justified Prisma, then Drizzle would have been better. **Checkable now** via the
P1-00 spike.

## 8. Required changes (non-optional)
1. Run the **P1-00 RLS-pooling spike** and lock D-002 *before* the first
   migration (prototype `SET LOCAL` in a pooled transaction in both Prisma and
   Drizzle).
2. Make the **BYPASSRLS role + context middleware** first-class Phase-1
   deliverables, not afterthoughts.
3. Keep the **app-layer DAL as primary** enforcement, RLS as backstop — one
   mechanism owns the errors, the other is defense-in-depth.

*Objection tried:* "no tenant data yet, so defer." *Why it fails:* the cost
avoided is a retrofit onto live regulated data you cannot safely do later; a
one-way door's whole point is future-proofing, so near-zero present risk is
irrelevant. **The user is right to override the deferral.**
