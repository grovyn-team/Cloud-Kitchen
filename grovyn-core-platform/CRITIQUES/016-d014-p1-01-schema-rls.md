# CRITIQUE 016 — D-014 / P1-01: first persistence layer (tenant · user · session · audit_log on Drizzle + RLS)

**Verdict: ENDORSE WITH CHANGES (Significant). Critic gate on D-014 SATISFIED — the
decision may move to Accepted. The P1-01 *task* stays In Review (Security) until the
parallel security-engineer pass closes; that gate is not mine to discharge.**

**Door classification.** The *artifacts* under review are sound and no real data has
landed, so accepting them is safe and cheap. But be clear-eyed: the things this task
fixes — the core-entity data model, the RLS predicate shape, and audit_log
immutability — become **one-way doors the moment the first tenant's data lands** (P1-07
onward). That is precisely why the evidence bar here was right to be high, and it clears
it. None of my required changes ask for an edit to the P1-01 artifacts; they are forward
specifications for P1-02 / P1-04 / P1-13 that must be recorded now while they cost a
sentence, exactly as CRITIQUE 015's set_config finding was carried to P1-02.

**Self-review flag.** I run on the same model as the DBA who authored this, and several
of these choices are ones I would have made. The two findings I lead with (§C) are the
ones I pressed *against* the design rather than nodding at — they are where I earned the
review. The four items D-014 asked me to bless, I did not simply bless; see §B.

---

## 1. The decision, restated

D-014 says it is "the first migrations plus verification of two spike items." What is
actually being decided is larger and more permanent than that framing admits: **the
physical shape of the four root entities every later table will FK into, the exact RLS
isolation predicate that will be copy-pasted across the entire schema for the life of the
project, and the enforcement-by-privilege model (which role can DELETE what).** The
verification items (WITH CHECK emission, alter/regenerate diffing) are the *least*
consequential part; they were never really the risk. The data model and the role/grant
model are.

That reframing matters because it changes where scrutiny belongs — not on "did drizzle-kit
emit the right SQL" (it did, confirmed statically in `0000` lines 72–75) but on "what does
this schema make impossible or expensive later." Two things, below.

## 2. Goal alignment

Direct and clean. This is the O4 (Trust it — isolated tenant data, auditable history)
foundation that also unblocks O1/O2 (nothing real persists without it). Every table
carries the non-null indexed `tenant_id` D-001 mandated; RLS is enabled and FORCEd;
audit immutability serves "auditable history" literally. No scope creep — the D-009 plan
hooks and D-008 retention fields are dormant-by-design and correctly justified as
cheap-now / expensive-later reservations, not built-out machinery. I checked for a table,
column, or policy that traces to no outcome and found none.

## 3. Strongest case for

It is disciplined, minimal, and honest about its own boundaries. It reuses the *proven*
spike predicate verbatim rather than re-deriving it; it refuses to build the DAL (P1-03)
or context middleware (P1-02) and says so repeatedly; it does not mark itself Done; and it
went past static inspection to run a real `postgres:16-alpine` container proving a
cross-tenant INSERT is rejected and a no-context query returns zero rows. The GRANT-layer
immutability on `audit_log` is genuinely stronger than D-008 asked for and is the right
instinct. The framing "RLS is a real backstop but the DAL is primary" is correct and
consistently maintained. This is what a careful first migration looks like.

## 4. Strongest case against

The design solved tenant *isolation* beautifully and, in doing so, quietly made two things
that the product actually requires either impossible or unowned for the runtime role — and
neither is written down anywhere as a problem (§C). Separately, the append-only immutable
audit_log (rightly celebrated as a strength) is on a collision course with D-008's
customer-PII erasure guarantee, and that collision is being built in now, one table at a
time, with nobody tracking it. A reviewer who only checks "is isolation enforced" — which
is what everyone is checking — will pass this and never see either.

## 5. The cost nobody mentioned

Three second-order costs, in descending order of importance — the first two are in §C
because they are the substance of the "endorse with changes."

- **audit_log becomes an un-erasable PII sink (Significant, future trigger).** `beforeData`/
  `afterData` are jsonb snapshots of the changed row. For a `user.update` that is name +
  email; today that is D-013-exempt staff PII, so it is fine. But in Phase 3, customer-
  related actions will be audited, and their before/after snapshots will capture *customer*
  PII — which D-008 says must be genuinely erasable. `audit_log` has no soft-delete, no
  retention ceiling, and is immutable to the app by GRANT. So the very immutability praised
  in item #1 will directly contradict D-008's erasure design the moment customer data flows
  through it. This is not a P1-01 defect — there is no customer PII yet — but it is a cost
  this design commits to, and **P1-13 (customer-PII erasure design) must explicitly cover
  audit_log**, most likely by the crypto-shred key approach (encrypt the PII fields in the
  snapshot; shredding the key erases them *without* mutating the immutable row — immutability
  and erasability coexide cleanly). Left untracked, it surfaces as a compliance defect years
  in, in the one table you deliberately made impossible to fix in place.
- **The shared `retention_category` enum couples every table's retention vocabulary to one
  Postgres type (Minor).** Adding a value later (`ALTER TYPE ... ADD VALUE`) has
  transaction-context sharp edges under migration tooling; removing a value is effectively a
  type rewrite. The `'employment_72mo_placeholder'` value bakes the word "placeholder" into
  persisted rows pending D-013's legal resolution — a *rename* (`ALTER TYPE ... RENAME VALUE`)
  is cheap and non-rewriting, so this is survivable, but treat the enum values as opaque keys
  and never try to *remove* one. A retention_policy reference table would have been more
  flexible; the enum choice is defensible (queryable/indexable, jsonb rejected for good
  reason) and I am not challenging it — just naming the lock-in.
- **retain_until with no constraint and no consumer is a dormant column that can silently
  accumulate garbage (see §B.3).**

## 6. Reversibility

- **Schema shape of the four entities + the RLS predicate: one-way door once P1-07 loads real
  tenant data.** Correct to get right now; it is right now. Accepting P1-01 does not itself
  open the door — no data lands in this task.
- **GRANT/immutability model: one-way in spirit** (you cannot retroactively claim an audit
  log was append-only if it ever wasn't) — also correct now.
- **The four D-014-flagged items (§B) and my two §C findings: all two-way and cheap today**,
  because they are forward specs on unbuilt tasks (P1-02/P1-04/P1-13), not committed data or
  schema. This is why the verdict is Endorse-with-changes, not Hold.

## 7. What would have to be true for this to be wrong

1. That login/tenant-resolution never needs the runtime role to read tenant/user *before* a
   tenant context exists. **This is false** (§C.1) — so the change is required, not optional.
2. That customer PII never reaches audit_log's jsonb snapshots. **False by Phase 3** (§5) —
   so P1-13 must cover audit_log.
3. That the container results in D-014 (cross-tenant INSERT rejected, fail-closed on no
   context, audit UPDATE refused at the privilege layer) are real. I verified the WITH CHECK
   clauses exist in the generated SQL statically and that the harness *design* would detect
   these failures (consistent with CRITIQUE 015); I did not re-run the container. Checkable by
   re-executing per the task's reproduction steps, and P1-10 will exercise it for real.
4. That `bootstrap-roles.sql` is actually run, unmodified, against every cluster (§B.2).

---

## B. The four items D-014 asked me to form my own view on

**B.1 — GRANT-layer audit_log immutability: SOUND, with a documentation gap, not a trap.**
Verified in `0001`: `grovyn_app` gets `SELECT, INSERT` on `audit_log` and no UPDATE/DELETE
anywhere; tenant/user/session get `SELECT, INSERT, UPDATE` and no DELETE. This is the right
threat model — it defends against a *compromised or buggy application identity*, which is the
realistic threat. The escape hatch exists and does **not** undermine the guarantee: `audit_log`
is owned by `grovyn_migrator` (it ran the migration), and `grovyn_migrator` is BYPASSRLS +
owner, so a legitimate correction is possible by connecting as migrator/superuser — a role that
`bootstrap-roles.sql` itself forbids from ever serving a request. So "immutable" precisely means
"immutable to the request-facing role, correctable only out-of-band by an operator." That is the
correct guarantee. *Required (Minor):* the deployment/ops runbook (P7-01/P7-02) must document
that audit corrections require the migrator role and are themselves un-audited (a meta-gap — an
operator editing audit_log leaves no audit trail of having done so); name who is allowed to and
under what change-control. Do not add a UPDATE grant to `grovyn_app` to make corrections
"convenient" — that would dissolve the whole guarantee.

**B.2 — bootstrap-roles.sql outside the versioned chain: RIGHT CALL, with a real drift gap that
is phase-appropriate to defer — with conditions.** The justification (CREATE ROLE is cluster-wide,
would fail "role already exists" on a second database sharing the cluster) is correct and standard;
embedding it in the chain would be the wrong call. The concern D-014 raises is real: nothing tracks
whether it has been run or whether the roles have drifted (e.g. someone grants `grovyn_app`
BYPASSRLS and silently dissolves every guarantee here). Two mitigations already exist or are cheap:
(a) `0001`'s grants reference `grovyn_app`, so a *forgotten* bootstrap makes migration `0001` fail
loudly — the "didn't run it" case is self-catching; (b) the *drift* case is not caught by anything.
*Required:* (1) make `bootstrap-roles.sql` idempotent (`DO $$ ... IF NOT EXISTS ... $$` rather than
bare `CREATE ROLE`) so review-apps/CI can re-run it safely — Minor but removes a foot-gun; (2)
**P1-10's isolation suite must assert `grovyn_app.rolbypassrls = false` against the real deployed
cluster** (the spike did exactly this via `pg_roles` — carry it forward as a standing check, not a
one-time spike artifact). With those, deferring the full runbook ownership to P7 is fine.

**B.3 — app-computed retain_until, no DB constraint, no purge job: ACCEPTABLE now, but it must
carry a fail-closed condition or it quietly defeats D-008 later.** Enforcing the value now is
genuinely premature — computing it correctly needs the annual-return-due-date / appeal-disposal
context that does not exist until Phase 2, so a CHECK constraint now would encode a formula you
cannot yet write. Deferring is correct. **But** the D-008 retention design has two teeth: "never
hard-delete" (which IS enforced now, by the withheld DELETE grant — real) and "purge after the
floor" (not built). The danger is the day the purge job is built: a soft-deleted row whose
`retain_until` is NULL (because some future write path forgot to set it, there being no constraint
to force it) must **never** be interpreted as "no floor, safe to purge." *Required (record against
P1-13 / the future purge task):* (1) all soft-delete writes go through a single chokepoint that
always sets `retain_until` (mirror the `checkLimit()` single-chokepoint pattern D-009 uses); (2)
the purge job treats `deleted_at IS NOT NULL AND retain_until IS NULL` as "do not purge, alert,"
never as "purge." Provided that is written down now, the dormant gap is acceptable.

**B.4 — other one-way doors D-014 didn't flag.** The three it lists (shared enum, partial unique
index, `revoked_at` naming) are fine: the partial case-insensitive unique index on
`(tenant_id, lower(email)) WHERE deleted_at IS NULL` is well-reasoned and correct (tenant-scoped, not
SSO; frees a departed employee's email; audit attribution survives because `actor_user_id` is a uuid
FK, not email) — two-way, no concern; `revoked_at` vs `deleted_at` is pure cosmetics, two-way, not
worth a sentence of agonizing. One app-layer note for P1-04: because a deleted user and an active
user can now hold the same email, **login lookup by email must filter `deleted_at IS NULL`** or it is
ambiguous. The enum lock-in is covered in §5. **The one-way doors D-014 missed are not in that list —
they are in §C.**

---

## C. The check nobody else ran — what this schema makes impossible for the runtime role

Both of these are consequences of RLS being applied to `grovyn_app` with a policy that requires a
tenant context to already be set. They are correct *as isolation*; they are unowned *as product
capability*.

**C.1 — There is no pre-context read path, so login and tenant onboarding cannot run as
`grovyn_app` (Significant, unowned).** Authentication is inherently pre-context: to authenticate you
must first find the tenant (from a subdomain/slug) and then the user (by email within that tenant) —
*before* any `app.current_tenant` exists to set. But with these policies, `grovyn_app` with no
context set reads **zero rows** from `tenant` and `user` (fail-closed by construction — the very
property the spike proved). Therefore the entire P1-04 auth lookup, and self-serve tenant onboarding
(the INSERT into `tenant` cannot satisfy `WITH CHECK id = current_tenant` when the tenant does not yet
exist), **cannot be performed by the runtime role.** The only role that can is `grovyn_migrator` —
which `bootstrap-roles.sql` explicitly forbids from ever serving an HTTP request. This is a genuine
architectural gap, not a schema defect: the schema is a correct backstop. But nobody owns the
resolution, and P1-02 ("context middleware") assumes you *already know* the tenant — it does not
answer "how does the request learn its tenant before context exists." The realistic answers (a
narrow SELECT-only `grovyn_auth` role scoped to tenant-resolution + login; or `SECURITY DEFINER`
resolver functions like `resolve_tenant_by_slug()` / `authenticate()`) are real design work that
must land **before P1-04**, arguably as part of P1-02. *Required:* name an owner and record this as a
P1-02/P1-04 prerequisite now. Also — and this is a change to a P1-01 artifact I am specifying, not
making — the `tenant.slug` comment in `schema.js` (lines ~170–174) claims the slug is "used for
tenant lookup/routing **before a tenant context exists**." That capability does **not** exist for
`grovyn_app` under this policy; the comment will mislead P1-04's author into thinking slug lookup
"just works." The DBA should correct that comment to note the pre-context read requires a distinct
role/definer path (Minor doc fix, DBA-owned).

**C.2 — (folded into §5, first bullet) audit_log immutability vs D-008 customer-PII erasure.** The
same immutability that is a strength for O4 becomes a compliance liability once customer PII enters
its jsonb snapshots. Must be covered by P1-13. Stated once; not repeating.

---

## D. Does it match D-001, and is there any premature "isolation is handled" framing? — Clean.

D-001 required: non-null indexed `tenant_id` on every tenant-scoped table (✓ user/session/audit_log
all have it, all indexed), `tenant` correctly not self-scoped (✓, its policy compares `id`), RLS
enabled from Phase 1 (✓ enabled + FORCEd on all four), DAL primary / RLS backstop (✓). I looked
specifically for any place — schema doc, D-014, or the board — that presents RLS as sufficient on its
own or marks isolation "done" before the DAL (P1-03) exists. **There is none.** The module docstring
(schema.js lines 19–23) is explicit that RLS is "a real, load-bearing backstop… but the *primary*
enforcement (the DAL) is a separate, later task," the board row is `In Review (Critic)` not Done and
says so, and D-014's status refuses Accepted pending this review. This is exactly right and I want it
on record that the framing discipline here is correct — it is the thing most likely to have gone
wrong and it didn't.

---

## Verdict

**ENDORSE WITH CHANGES (Significant).** The schema and migrations are sound, correctly scoped, and
honestly framed; the critic gate on **D-014 is satisfied and it may move to Accepted.** The P1-01
*task* remains In Review (Security) until the parallel OWASP pass closes — that DoD gate is not mine.

**Non-optional changes (all forward specs; none alter the P1-01 artifacts except the D.1/C.1 comment
fix, which is the DBA's to make):**
1. **[P1-02/P1-04] Own the pre-context read path (§C.1).** Decide and record how a request resolves
   its tenant and authenticates *before* a tenant context exists, without using the request-forbidden
   migrator role. Name the owner now. Correct the misleading `tenant.slug` comment in `schema.js`.
2. **[P1-13] Bring audit_log into the customer-PII erasure design (§5/§C.2).** Immutable append-only
   store + erasable customer PII only reconcile via crypto-shredding the snapshot fields; make it
   explicit.
3. **[purge task / P1-13] Fail-closed retain_until (§B.3).** Single soft-delete chokepoint always sets
   it; purge treats `deleted_at IS NOT NULL AND retain_until IS NULL` as do-not-purge-and-alert.
4. **[P1-10] Assert `grovyn_app.rolbypassrls = false` against the deployed cluster (§B.2);** make
   `bootstrap-roles.sql` idempotent.
5. **[P7 runbook] Document the audit_log correction escape hatch (§B.1)** — migrator-only, change-
   controlled, itself un-audited.

*Objection I tried and why it fails:* "Block — §C.1 means the schema commits the product to an
auth/onboarding model (privileged pre-context role or definer functions) that nobody has designed, on
a one-way-door schema." It fails because the schema does **not** foreclose any of the viable
resolutions — a narrow auth role or SECURITY DEFINER resolvers all sit *on top of* exactly these
tables and policies, add nothing irreversible, and no tenant data lands in P1-01 to make the door
swing. It is a real unowned gap that must be closed before P1-04, not a defect that makes accepting
P1-01 wrong. Hence Significant-and-required, not Blocking.
