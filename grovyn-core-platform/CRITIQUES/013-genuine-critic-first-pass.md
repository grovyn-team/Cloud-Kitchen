# CRITIQUE 013 — First genuine `decision-critic` review of D-001, D-002, D-006..D-012

**This is the first review in this repo authored by an actually-registered
`decision-critic` subagent invocation.** Every prior file (001–012) was written by
the main session role-playing this persona; 009–012 additionally made a *false*
in-text claim to be the registered critic. Those files are preserved unaltered as
the historical (flawed) record. This file supersedes their *provenance*, concurs
with most of their *substance* (verified below), and diverges in three places that
matter.

**Same-model caveat (my own rule, applied to myself):** I run on opus, the same
model as the agents whose work and prior "critiques" I am reviewing, and the
original D-001 "defer RLS" line came from an opus DBA. Agreeing with a prior opus
analysis is the easiest failure available to me. I therefore treated concurrence as
the null hypothesis to be attacked, verified every load-bearing code/infra claim
against the repo directly, and report my genuine divergences up front rather than
burying them under agreement.

---

## TOP FINDING — BLOCKING (relay to user verbatim)

**D-008 scheduling defect: the crypto-shredding one-way door is gated *after* the
migration that walks through it, and user/staff PII is silently out of the design's
stated scope.**

- Self-review 011 established (correctly, and I concur) that **crypto-shredding
  cannot be retrofitted**: PII columns must be encrypted per-subject from the *first
  migration that persists them*, or the option is permanently lost for all data
  written before the switch.
- D-008 scopes its design to **"customer PII."** It is **silent on user/staff PII**
  (admin and staff records carry email + name — personal data under India's DPDP).
- The design that decides the crypto-shredding fork is **P1-13**, and on the board
  **P1-13 `Depends On: P1-01`** — i.e. the erasure-architecture design is scheduled
  to happen *after* P1-01 creates the `user` table. If user/staff PII is in
  erasure scope and crypto-shredding is the chosen mechanism, **P1-01 will write
  plaintext user PII before P1-13 decides to encrypt it** — the irreversible door
  closes before its own design gate.
- Customer PII specifically lands in Phase 3, so for *customers* the P1-13 gate is
  early enough. The hole is entirely about **user/staff PII in P1-01**.

**Required before P1-01 runs (not P1-13):**
1. Decide explicitly whether user/staff PII is in the erasure / crypto-shredding
   scope, or is retained on a separate lawful basis (employment/contract) and
   excluded. Either answer is defensible; the *absence of the decision* is the
   defect.
2. If user PII is in scope, the crypto-shredding-vs-backup-expiry fork must be
   resolved **before P1-01**, and the board dependency (P1-13 after P1-01) is
   backwards for the encryption-architecture question — invert it or split the
   fork out of P1-13 into a P1-00-adjacent decision.

This is Blocking not because anything is broken — nothing is built yet — but because
it is a one-way door with a live scheduling order that walks through it wrong, and
P1-01 is the next foundational task in the plan. It is cheap to fix now and
impossible to fix after P1-01 ships plaintext user PII under a crypto-shred policy.

---

## Per-decision verdicts

### D-001 — RLS in Phase 1 — ENDORSE (Significant, one-way door)
**Concur with the verdict of 001/009; diverge from 009's central premise.**

The override (RLS in the first migrations) is right, and the reason is
self-sufficient: retrofitting RLS onto live, regulated, 72-month-retained financial
data is the expensive/irreversible direction; writing it now, against zero data
(verified: no `prisma/`, `drizzle/`, or `migrations/` dir, backend deps are only
`cors`+`express`), is near-free. That argument stands on its own and does not need
the pooling story.

**Divergence (Significant):** 009 supersedes 001 largely by asserting the
PgBouncer/pooling risk is "largely retired" because "the infra is now locked:
single container, ORM owns its pool, no external pooler." **That infra is not
locked — it is not even built.** The only deployment configuration in the repo is
Vercel serverless (`backend/vercel.json` → `@vercel/node`, `DEPLOY.md`,
`config/index.js` comment "required on serverless, e.g. Vercel"). The single-box
model is D-006 — a decision on paper, scheduled at **Phase 7 (P7-01), with no owner,
after RLS lands in Phase 1.** So the pooling risk is not *retired*; it is
*conditionally mitigated if and only if D-006 is actually built as specified and
serverless is never reintroduced.* 009 treated a future decision as a present fact —
exactly the prose-drift failure this project's ground-truth rule exists to catch.
010 handles the same point correctly, as an endorsement *with an explicit revisit
trigger*. Prefer 010's framing over 009's.

**Required changes (001's three stand; I keep them):**
1. Run the P1-00 RLS-pooling spike and lock D-002 before the first migration.
2. BYPASSRLS role + context middleware as first-class P1 deliverables.
3. DAL primary, RLS backstop.
Plus 009's addition (which I do endorse): P1-10 tests each layer alone, both
directions. Plus mine: **the spike must target the D-006 deployment model, and the
live `vercel.json`/`DEPLOY.md` must be treated as dead residue, not a deployment
option** — because the current serverless config is precisely the transaction-pooler
architecture that breaks `SET LOCAL`. Do not persist a real DB against the Vercel
config in the interim.

*Objection tried:* "no data yet, defer RLS." *Why it fails:* unchanged from 001 — a
one-way door's value is future-proofing; near-zero present risk is not the metric.

### D-002 — ORM via P1-00 spike — ENDORSE THE SPIKE + 010's criteria (Minor, two-way now / hardens fast)
Don't lock Prisma by inertia; the spike is cheap and decisive before the first
migration. **010's pre-committed PASS/FAIL criteria are genuinely good** — binary,
pre-registered, anti-rationalization, with the transaction↔connection-affinity gate
(gate 1) correctly identified as the decisive one. Concur.

**One sharpening (Minor):** 010 files "migration workflow survives RLS" as
tie-breaker gate 7. Given D-001's *entire* stated worry is "RLS+Prisma erodes the
ergonomics that justified Prisma," a candidate that forces hand-written SQL for
every RLS migration is arguably a **correctness/maintainability failure, not a
preference** — promote gate 7 to a hard binary gate, or at minimum pre-register a
concrete threshold that can fail it. Also pre-register a **latency budget for the
interactive-transaction wrapper** (Prisma interactive transactions carry real
per-call overhead); record it as evidence even if soft. Status stays **Hold** — this
is genuinely unresolved until the spike runs; that is correct, not drift.

### D-006 — Deployment (single-box, long-lived pool) — ENDORSE WITH CHANGES (Significant)
Right for Prisma+RLS; concur with 004's required changes (delete Vercel/Netlify
residue in the same change; P7-02 backup/DR with a **named owner**). Concur with
012's sharpening that 004 conflated **availability** (uptime SPOF) with
**durability** (tested restore) — P7-02 as written covers durability only; accept
single-box availability *explicitly, with a trigger* (revisit HA when the first
paying tenant carries an uptime expectation).

**My addition (Significant drift):** D-006 is scheduled dead-last (Phase 7) yet
pieces of it are **load-bearing in Phase 1 and Phase 3**: the single-box/long-lived-
pool/no-external-pooler commitment is a *Phase 1 input* to the RLS spike (D-001), and
the backup/DR mechanism (P7-02) is a *prerequisite* of D-008's PII-erasure design.
The deployment *artifacts* can wait; the *architectural commitments* cannot, and
they currently have no owner and sit behind six phases. Name P7-02's owner now, and
record that the D-006 *architecture* (not its shipping) is a Phase-1 assumption.

### D-007 — Tax scope + CA-in-the-loop repositioning — ENDORSE (Significant / Minor)
Concur fully with 005. The brief's "provide a valid audit" was a genuine
professional-liability overclaim; CA-in-the-loop prep/reconciliation is the correct,
honest framing. Non-optional and unchanged: the disclaimer must reach **UI copy,
report headers ("Prepared for CA review — not a certified filing"), and TOS** — a
caveat that never reaches the user-facing artifact is decorative. Constrain the
jurisdiction seam to an interface, not a plugin framework. Nothing to add.

### D-008 — Retention / soft-delete + PII erasure — ENDORSE DIRECTION, design-before-build (Significant, one-way door) + see TOP FINDING
The master-PII (erasable) vs frozen invoice-snapshot-PII (retained) split is the
correct resolution of the DPDP-erasure vs CGST-§36 collision. Concur with 006 and
with 011's two additions — **crypto-shredding cannot be retrofitted (Addition 1) is
the single sharpest correct finding in the entire 001–012 set**, and
live-DB-as-system-of-record vs backups-as-bounded-DR (Addition 2) must be written
down or a future maintainer breaks one obligation while "optimizing" the other.
Direction is sound. **But see the TOP FINDING: the design gate (P1-13) is scheduled
after P1-01, and user/staff PII is out of the stated scope — resolve before P1-01.**

### D-009 — Plan/tier schema hooks — ENDORSE (Minor, two-way for columns)
Concur with 007. Three nullable columns + one `checkLimit()` chokepoint is a
correctly-priced option; the chokepoint discipline is the value. Required and
unchanged: **write each field's semantics down now** (is a seat a user? per branch?
does `branch_limit` count tombstoned branches?). Standing note: this traces to no
O1–O4 outcome — it is business-model plumbing, legitimate only because it is
near-free now and expensive to retrofit onto live paying tenants. If it ever grows
into an actual enforcement/billing engine pre-need, that is scope creep to block.

### D-010 — HF / AI policy — ENDORSE (Minor, two-way policy)
Concur. Policy is correct and — more importantly — **enforced structurally by
scheduling**, not by good intentions: AI is Phase 5, expansion planning is the
deterministic Phase-3.5 engine, and no O1/O3 capability depends on a model. Verified
the engine is real and deterministic (`expansionPlanner.js`: hardcoded `1900000`,
`0.6`, `0.25`, `en-IN`, default `450000`, `repeatRate ?? 0`). The $5–20/tenant/mo and
$400+/mo figures are **directional and unsourced** — they must not reach a client as
numbers before the firm costing (already flagged pending). Fine.

### D-011 — Adopt O1–O4 as the planning anchor — ENDORSE (governance, low-stakes, high-value)
Concur. This is the anchor the whole board now hangs on and it is working (every row
cites an outcome; unmapped work like D-009 is surfaced rather than smuggled).
**Critique upward, unchanged from 008/012:** the goal's "experience good enough to
sell to an enterprise" bar is owned by **no** outcome — O1–O4 are all functional.
Either adopt an O5 with *objective, falsifiable* acceptance criteria (per 012:
loading/empty/error on every screen, no faked data in a demo, design tokens,
breakpoints, baseline a11y) or explicitly assign the premium bar to
frontend-developer as a per-phase DoD line. An outcome you cannot fail is not an
outcome — do not adopt O5 unmeasured.

### D-012 — Register `decision-critic` (frontmatter fix) — ENDORSE (governance)
Concur. This was the keystone defect — a mandatory gate that did not exist because
the agent file lacked YAML frontmatter. **This very invocation is the evidence it is
now fixed.** Note the chicken-and-egg the notice already implies: this is the one
decision that could not have had a real critic review until it was itself
implemented. It is correct, and it now applies to every prior entry — which is what
this file discharges.

---

## Drift check (the check nobody else runs)

- **O4's keystone is scheduled last with no owner.** The "compliance survives
  scrutiny" outcome depends on a *tested restore* and a *backup-erasure mechanism*
  (P7-02, D-008). P7-02 is Phase 7, unowned. The compliance claim is only as real as
  the restore we have tested — today that is zero. Not a new build item, but the O4
  claim should not be made aloud (to a client, in TOS) until P7-02 has an owner and a
  green restore. Significant.
- **The premium-experience bar has no owner** (D-011 note above). Minor→Significant.
- **P0-07 (Vite `^5.4.10→^8.1.5`) remains an open forced-major from
  `npm audit fix --force`** (per 012's provenance work). Concur with revert-by-default
  as a two-way door; it is security-engineer's CVE call, not the critic's. Not
  Blocking. Keep it out of the `.claude/` commit.
- **No decision traces to nothing that shouldn't** except D-009 (surfaced, accepted)
  and the premium bar (unowned). The board otherwise ladders cleanly to O1–O4.

## Where I diverged from the fake self-reviews (summary)
1. **009's "PgBouncer risk retired" premise — rejected.** The single-box infra it
   relies on is unbuilt Phase-7 intent; the repo ships only Vercel serverless. Verdict
   unchanged (Endorse the override) but on the retrofit argument, not the pooling one.
2. **D-008 scheduling / user-PII scope — new BLOCKING finding** neither 006 nor 011
   made: P1-13 is gated after P1-01, and user/staff PII is out of the stated scope.
3. **010 gate 7 — promote from tie-breaker toward a hard gate**, since RLS-forcing-
   manual-SQL is the exact failure mode D-001 worried about.
Everything else: concur, with the code and infra claims independently verified.
