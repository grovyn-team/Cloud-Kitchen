# CRITIQUE 015 — Independent re-review of the executed P1-00 RLS-pooling spike (D-002 → Drizzle)

**Verdict: ENDORSE DRIZZLE (D-002 resolution) — with one Significant, non-optional
correction to the forward-propagated cross-cutting finding before P1-02.**
Not Blocking. The gate on D-002 / P1-00 is satisfied; P1-01 is unblocked to author
migrations on Drizzle. The correction below lands in P1-02, not P1-01.

**Self-review flag (my own rule, applied to myself).** The criteria this spike was
built to satisfy — promoting gate 7 to a hard gate, pre-registering a latency budget —
were specified by a prior genuine run of *me* (CRITIQUE 013). Judging whether a spike
satisfied my own specification is the single easiest rubber-stamp available to this
agent. I therefore treated "gate 7 is decisive" (my prior idea) as the claim most in
need of attack, and I did not stop at concurrence: the set_config finding below is a
real gap my own prior framing missed, which is the evidence I actually pressed rather
than nodded.

**Scope of what I verified.** I verified the *harness code*, the *generated/hand-written
migration artifacts*, the *SQL bootstrap/seed*, the *runtime role*, and the *pre-
registration structure* directly against the repo. I did **not** re-execute the Docker
container run — I cannot independently reproduce the reported pass counts here. My
endorsement of the "0/0/0" results rests on the harness being genuinely *capable of
detecting* the failures it reports zero of (it is — see below), not on re-running it.

---

## 1. Did the harness test what it claims? — YES, it is not a toy.

- **Runtime role is correct.** Both harnesses connect as `grovyn_app`
  (`prisma-spike/test-harness.mjs:9`, `drizzle-spike/test-harness.mjs:10`), the
  `NOSUPERUSER NOBYPASSRLS` role created in `sql/00-bootstrap-databases.sql:7`. If
  the tests had run as a superuser/BYPASSRLS role, RLS would be silently bypassed and
  every gate would falsely pass. They don't. This is the trap that matters most and
  the spike avoided it.
- **Gate 1 (affinity) genuinely proves it.** It reads the GUC back *and* asserts
  `pg_backend_pid()` is identical across two separate queries inside the same
  transaction callback (`gate1`, both harnesses). Two queries landing on the same
  backend PID with the `SET LOCAL` value visible is the actual proof that the ORM's
  transaction wrapper pins one pooled connection for the callback's lifetime.
- **Gate 3 (concurrency) is a real contention test, not decorative.** N=50 concurrent
  transactions against `pg.Pool({ max: 10 })` — genuine 5× oversubscription — round-
  robin across 5 tenants, each asserting `rows.length === 20` **and** every returned
  row's `tenantId === own tenant`. This is the load-bearing test: if the transaction
  wrapper ever let a `SET LOCAL` land on connection X and the `SELECT` run on
  connection Y, the wrong-connection query would see an unset GUC and RLS would return
  0 rows → `wrongCount` fires → gate fails. Cross-tenant bleed would trip
  `crossTenantLeaks`. `Promise.allSettled` + `errors === 0` means no rejection is
  silently swallowed. The pass condition is the conjunction of all three at zero. This
  genuinely proves connection affinity under contention and no cross-tenant leakage.
- **Honest about what it is not.** 100 rows on localhost is a *correctness* proof, not
  a scale/throughput proof, and SPIKE.md says so (line 202-207). That is the right
  claim to make; I am not docking it for not being a load test it never claimed to be.

**One genuine weakness (Minor, not disqualifying):** Gate 2 ("no cross-checkout
leakage") is weaker than it reads. `SET LOCAL` is *transaction-scoped by construction* —
commit discards it — so leakage is structurally prevented regardless of ORM, and a
single fresh post-commit query is not guaranteed to reuse the exact connection the
prior txn used. Gate 2 is therefore closer to a sanity check than a stress test. It
does not overturn anything because gate 3 exercises real connection reuse under
oversubscription and covers the same property harder. Worth knowing the coverage
actually comes from gate 3, not gate 2.

## 2. Were the PASS/FAIL criteria genuinely pre-registered and binary? — YES, with one provenance caveat.

- The gates (1–5 binary, 6–8 tie-breakers, gate 7 promoted to hard) and the frozen
  numbers (5 tenants × 20 rows, pool 10, N=50, latency p50 ≤ 15ms / p95 ≤ 40ms) sit
  **above** the `--- RESULTS BELOW THIS LINE ---` marker (SPIKE.md line 94). The gates
  are genuinely binary (counts at zero; no "close enough"), and rule-of-engagement
  language ("a workaround for a 1–5 failure **is** the failure") is real anti-
  rationalization scaffolding.
- Critically, the criteria do not merely *claim* to pre-date the run — they trace to
  **independently-existing prior files** (CRITIQUE 010 specified the binary gates;
  CRITIQUE 013 promoted gate 7 and demanded the latency budget). The pre-registration
  is corroborated by artifacts written before the spike, not just by section ordering.
- **Caveat (provenance, Minor):** the spike is untracked/uncommitted (task instruction:
  do not commit), so there is no git timestamp proving RESULTS were appended *after*
  PRE-REGISTRATION rather than authored in one sitting. I cannot close that gap without
  a commit history. It does not change the verdict because the criteria's provenance is
  externally anchored to 010/013, but if this pattern recurs, commit the pre-
  registration before running so the freeze is cryptographically real, not asserted.

## 3. Is "Drizzle wins on gate 7" decisive, or should something else have mattered more? — Gate 7 is the right decider.

Verified against artifacts, not prose:
- **Prisma genuinely has no RLS representation.** `schema.prisma` carries zero RLS DSL
  (verified — it is a plain model), and the enable-RLS migration
  (`.../20260728185207_enable_rls/migration.sql`) is 100% hand-typed `ENABLE` + `FORCE`
  + `CREATE POLICY` + `GRANT`. The empty-migration claim is consistent with Prisma
  having nothing to diff.
- **Drizzle genuinely auto-generates the load-bearing statements.** `src/schema.ts`
  expresses the policy via `pgPolicy(...)` + `.enableRLS()`, and
  `drizzle/0000_sloppy_korvac.sql` contains the auto-generated `ENABLE ROW LEVEL
  SECURITY` and the full `CREATE POLICY ... USING (...)` verbatim. `FORCE` + `GRANT`
  are hand-written in `0001_...sql` — but those are hand-written in **both** and are
  correctly excluded as a non-differentiator.
- The differentiator therefore reduces to exactly the one statement D-001 worried about:
  `CREATE POLICY` (the tenant-isolation predicate — wrong column/cast/table is the
  realistic error, repeated per tenant-scoped table for the life of the project),
  declarative-and-diffed in one ORM and un-diffed hand SQL in the other. That is the
  correct thing to have weighted, and it is not latency: both are far inside the pre-
  registered budget (Drizzle marginally faster, explicitly called non-decisive). I
  looked for a result that should have outranked gate 7 and did not find one.

**One overclaim to trim (Minor).** SPIKE.md says Drizzle "gets it into the normal
schema-diff loop … reviewed like any other schema change" and implies ongoing **drift
detection** if a later migration touches the table. Only *initial generation* was
tested — not an alter-then-regenerate cycle. Drizzle's RLS diffing is new (0.45.x) and
is the exact surface most likely to have rough edges. The decision stands on generation
alone; do not carry the stronger "drift is caught forever" claim into P1-01 as a proven
property. It is plausible, not verified here.

## 4. The cross-cutting SET LOCAL finding — TRUE, but its stated conclusion is WRONG, and that error propagates to P1-02. (Significant.)

**Confirmed true:** both harnesses fall back to a raw path for `SET LOCAL`
(`$executeRawUnsafe` at `prisma .../test-harness.mjs:34`; `sql.raw` at
`drizzle .../test-harness.mjs:37`) with `UUID_RE` validation before string
interpolation. `SET LOCAL app.current_tenant = $1` is indeed a syntax error — Postgres
does not bind parameters in a `SET` value slot. So far the spike is right, and if this
path shipped as-is it *would* be a live injection surface that P1-02 must own.

**But the spike's conclusion — that a raw/unsafe interpolation path is "unavoidable for
this one statement regardless of ORM" (SPIKE.md line 210-218; comments in both
harnesses) — is false.** Postgres exposes `set_config(setting_name, new_value,
is_local)` as an ordinary function. `SELECT set_config('app.current_tenant', $1, true)`
is fully parameter-bindable, and `is_local => true` makes it transaction-scoped exactly
like `SET LOCAL`. It works identically in both ORMs (`tx.$queryRaw` / `tx.execute(sql\`
select set_config('app.current_tenant', ${tenantId}, true)\`)`) and **eliminates the
string-interpolation surface entirely** rather than mitigating it with a regex.

Why this matters and is not pedantry: the board and SPIKE.md are propagating the wrong
hard requirement forward. The P1-02 inheritance should not be *"validate the tenant id
as a UUID before interpolating it into raw SQL"* (which keeps an unnecessary injection
path and makes a hand-rolled regex the primary control). It should be *"set tenant
context via `set_config(..., $1, true)` with a **bound parameter**; UUID/format
validation is defense-in-depth, not the primary control."* Baking an interpolation path
into the real per-request tenant-context middleware — the single most security-sensitive
chokepoint in the whole tenancy model — when a parameterized path exists is a self-
inflicted risk. The spike correctly *flagged forward* a real surface; it flagged the
wrong remedy.

This does **not** disturb the ORM decision (set_config is ORM-neutral) and does **not**
block P1-01 (the policy's `USING (current_setting('app.current_tenant', true)...)` read
side is unaffected by how the value is written). It is a required correction to what
P1-02 inherits, and a correction to SPIKE.md's "unavoidable" sentence.

---

## The check nobody else ran

- The spike answered "which ORM" well but **left the actually-dangerous line of the
  real middleware (how tenant context is *set* per request) specified wrong.** P1-02 is
  where a cross-tenant breach would actually originate, and the artifact feeding it
  currently says "interpolate with validation" instead of "parameterize." That is the
  finding worth more than the ORM pick, which was never really in doubt on the security
  axis (both passed 1–5 identically).

## Reversibility

- **ORM choice (D-002): effectively a one-way door for practical purposes** once P1-01
  migrations, schema files, and the DAL wrapper are authored against Drizzle's
  `pgPolicy`/`.enableRLS` primitives — migrating ORMs after that is a rewrite, not a
  swap. This is why doing the spike before the first migration was correct, and why the
  evidence bar was appropriately high. The evidence clears it.
- **The set_config correction: two-way and cheap right now** — it is a P1-02
  implementation detail not yet written. It becomes expensive only if the interpolation
  pattern ships into the middleware and then into call sites. Fix it in the P1-02 spec
  now, while it costs a sentence.

## What would have to be true for the endorsement to be wrong

1. That the reported 0/0/0 results are real (I verified the harness *can* detect the
   failures; I did not re-run the container). Checkable by re-executing per SPIKE.md's
   reproduction steps.
2. That Drizzle's `pgPolicy` diffing holds up across *subsequent* migrations, not just
   first generation (untested — see §3 overclaim). Checkable with an alter-then-
   `drizzle-kit generate` cycle; P1-01 will exercise this in practice.
3. That no near-term requirement wants a policy shape Drizzle's DSL cannot express
   (e.g. `WITH CHECK` distinct from `USING`, or per-role `TO`). The spike tested one
   `FOR ALL TO public USING (...)` policy. P1-01's real tables (INSERT paths on
   `sales`/`inventory`) will need `WITH CHECK` — confirm Drizzle's `pgPolicy` emits it,
   or that gap becomes hand SQL and narrows gate 7's margin. Not blocking; verify in
   P1-01.

## Verdict

**ENDORSE DRIZZLE (D-002) — Endorse-with-changes.** The decision is well-evidenced and
the gate is discharged; P1-01 may proceed on Drizzle. Non-optional before P1-02:

1. **Correct the tenant-context mechanism.** P1-02 sets context via
   `set_config('app.current_tenant', $1, true)` with a **bound parameter**. UUID/format
   validation is defense-in-depth, not the primary control. Amend SPIKE.md's
   "unavoidable raw/unsafe path" statement to reflect that a parameterized path exists.
2. **Do not carry the "drift caught forever" claim** into P1-01 as proven; it was not
   tested. Verify `WITH CHECK` / per-role policy emission when P1-01's real tables need
   them.

*Objection I tried and why it fails:* "This should be Blocking — a wrong control on the
tenancy chokepoint is a one-way security door." It fails because P1-02 is unbuilt, the
correction is a one-sentence spec change with no data or schema committed to it yet, and
the ORM decision it is attached to is itself sound and unaffected. Blocking is reserved
for one-way doors with live scheduling walking through them (cf. the D-008/P1-13 finding
in CRITIQUE 013, which genuinely was one). This is a Significant required change, logged
and carried to the P1-02 owner — not a block on P1-01.
