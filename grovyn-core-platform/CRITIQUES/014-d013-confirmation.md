# CRITIQUE 014 — Confirmation review of D-013 (does it discharge the CRITIQUE 013 Blocking item?)

**Verdict: DISCHARGED-WITH-CONDITIONS.** The Blocking *scheduling* defect from
CRITIQUE 013 (P1-13 gated after P1-01; user/staff PII silently out of scope) is
genuinely closed — I cannot in good conscience re-block it. But the *legal
rationale* D-013 uses to get there is factually wrong on the statute, and the
scope claim overclaims. Two non-optional corrections below. Neither re-opens the
one-way door; both must be made now, not deferred to "legal before GA."

**Severity: Significant** (the two conditions). The Blocking item itself: closed.

**Self-review disclosure (my own rule, applied to myself):** D-013 resolves *my
own* prior Blocking finding, and I run on the same model as the agent that
drafted it. Agreeing with a resolution to my own finding — feeling the relief of
"they fixed it" — is the single easiest failure available to me here. I therefore
treated "the gap is closed" as the hypothesis to attack, and went and verified the
one load-bearing claim (the DPDP citation) against primary/secondary sources
rather than my own memory. The correction below is what that scepticism found.

---

## 1. The decision, restated

D-013 is stated as "user/staff PII is out of DPDP erasure/crypto-shred scope on an
employment-necessity basis." What is *actually* being decided is narrower and
more defensible than the stated version: **the `user` table at P1-01 does not need
a per-subject crypto-shred column at its first migration** — soft-delete +
retention (same treatment as sales/inventory/audit) is sufficient, so P1-01 no
longer walks through an irreversible door ahead of the P1-13 design gate.

That narrower decision is correct. The broader framing ("out of erasure scope,"
"§17(2)(a) exempts employment data") is the part that doesn't hold — and the gap
between the two is this critique's main finding.

## 2. Goal alignment

Directly serves **O4 (Trust it)** — DPDP-erasure vs statutory-retention is a
compliance-survives-scrutiny question. The decision correctly keeps the erasure
*machinery* (crypto-shred design, P1-13) pointed at the data that actually needs
it (customer/diner PII, Phase 3) and off the data that doesn't (staff login
identities). No misalignment.

## 3. Strongest case for (as its advocate)

- A tenant admin/staff account is an *employee/operator* identity, not a *customer
  the tenant serves*. DPDP's erasure machinery is built around the consumer
  relationship; employee data is treated differently across every major privacy
  regime, and DPDP is no exception.
- Per-subject crypto-shred is only *required* when you must erase one subject from
  long-lived backups **before those backups naturally expire**. For staff, the
  labour-law retention floor (PF/ESI/Payment of Wages — commonly 3–8 years) runs
  concurrent with or beyond the D-006 backup horizon, so backup-expiry already
  satisfies any eventual erasure duty. No first-migration crypto column is needed.
- Deferring the exact post-termination boundary to a lawyer is honest: the
  engineering decision (no crypto column at P1-01) does not depend on the precise
  number of years.
- It unblocks P1-00/P1-01 now without forcing a premature Phase-3 design.

This case is real and it is why the scheduling item is genuinely discharged. Note
that **it does not once rely on §17(2)(a)** — the engineering justification stands
entirely on §7 legitimate-use + labour-retention-vs-backup-horizon arithmetic.

## 4. Strongest case against (mandatory — not skipped)

**The stated legal basis is the wrong provision, and confidently so.** D-013 says
§17(2)(a) "exempts personal data processing necessary for employment purposes."
Verified against primary and secondary sources:

- The **employment** provision is **Section 7** ("Certain Legitimate Uses"). It
  removes the *consent* requirement for processing employee data. It does **not**
  exempt the fiduciary from the erasure obligation (§12 right to erasure; §8(7)
  duty to erase when purpose is served).
- **Section 17(2)(a)** is the Central Government's power to exempt **an
  instrumentality of the State** from the whole Act on sovereignty / security /
  public-order grounds. A cloud-kitchen SaaS tenant is not an instrumentality of
  the State. The citation is not merely imprecise — it is a category error, and
  its paraphrase ("exempts employment processing") describes something the
  provision does not say.

Consequence of the error, if left standing: staff are still Data Principals with
§12 erasure rights. Those rights are *subordinated* to legal-retention duties and
*satisfiable by backup-expiry* — but they are **not eliminated**. D-013's "out of
erasure scope" framing implies staff have no erasure right at all. A future
maintainer who reads that literally could skip the soft-delete / de-link path for
the staff master record, or refuse a legitimate post-floor erasure request — a
latent Phase-3 compliance gap seeded by a Phase-1 framing.

This project has a documented track record of exactly this failure mode: the
"provide a valid audit" overclaim (D-007) was a confidently-wrong compliance claim
that reached the brief unchallenged. A wrong statutory anchor in DECISIONS_LOG
propagates into schema comments, TOS, and the eventual legal review — which then
starts from a false premise. Correct citations are cheap now and expensive to
unwind after they've been copied.

## 5. The cost nobody mentioned

- **Over-retention as a placeholder is itself a mild DPDP tension.** Consequence #2
  defaults terminated-staff records to the GST 72-month floor "conservatively."
  GST 72 months is an unrelated anchor (it governs financial records, not labour
  data). DPDP §8(7) says erase when the purpose is served — retaining staff PII for
  6 years "because GST" is over-retention of personal data, which is the *opposite*
  of the risk being hedged against. It is flagged as pending-legal and framed as
  conservative, so it is Minor — but "over-retention is the smaller risk" is not
  self-evidently true for PII under a data-minimisation regime, and shouldn't be
  asserted as if it were. Let the labour-law floor set the number, not GST.
- **The exclusion quietly commits the team to backup-expiry as the staff-erasure
  mechanism forever.** That is a legitimate choice (D-008 lists it as an
  alternative to crypto-shred), but it should be *named as a choice*, not arrived
  at by implication. If a jurisdiction or enterprise contract ever demands
  per-subject staff erasability faster than the backup horizon, the P1-01 plaintext
  data cannot be retrofitted for it (011's non-retrofit finding applies to staff
  data too). See reversibility.

## 6. Reversibility

- **The P1-01 decision (no crypto column for staff): effectively two-way / bounded
  one-way.** If per-subject staff crypto-shred is ever needed, it can be added for
  *future* staff data; the *already-written* plaintext staff PII cannot be
  retrofitted — but it rolls off the backup horizon within D-006's window, so the
  exposure is bounded and self-healing. This is why the Blocking door is genuinely
  discharged: what remains is not an irreversible door, it is an accepted,
  bounded, self-healing design choice.
- **The legal-basis framing: cheap two-way door — fix it now.** Correcting the
  citation and the scope wording costs a paragraph edit and re-opens nothing.
  There is no reason to carry the wrong statute forward.

## 7. What would have to be true for this to be wrong

Assumptions the discharge rests on, and their status:

1. *Staff PII at P1-01 needs no per-subject crypto-shred.* — **Holds**, because
   labour-retention floors run concurrent with / beyond the backup horizon, so
   backup-expiry satisfies erasure. Checkable once the backup-retention window
   (D-006 / P7-02) and the labour floor are both fixed; if backups outlive the
   floor by a wide margin, a residual erasure window opens (see risk below).
2. *§17(2)(a) supports the exclusion.* — **False, verified.** The support comes
   from §7 + §12(3)/§8(7), not §17(2)(a). This assumption is load-bearing in the
   *stated* rationale but not in the *actual* engineering decision.
3. *Staff rarely exercise post-termination erasure inside the residual window.* —
   **Unverified, and correctly a lawyer/operational question.** This is the part
   the "directional, pending real legal confirmation" hedge legitimately covers.

**On the hedge's adequacy (the task's question 1):** the hedge is *adequate* for
the genuine open question — how long the legitimate-use/retention basis survives
after termination, and the exact labour floor. It is *inadequate* as cover for the
§17(2)(a) citation, which is not a judgement-call boundary but a checkable factual
error (I checked it without a lawyer). Deferring a known-checkable error behind a
hedge meant for a genuine unknown is the hedge being too load-bearing. Fix the
citation now; defer only the boundary.

**On the task's question 2 (some other obligation requiring per-subject staff
erasability):** Yes, one residual scenario exists — terminated staffer, labour
floor expires at, say, year 3, but backups retain to year 6 → a ~3-year window in
which an erasure request cannot be honoured in backups without crypto-shred. This
is real, but it is (a) the *same* residual the customer-PII design already accepts
when it lists backup-expiry as an alternative to crypto-shred, (b) bounded and
self-healing at the backup horizon, and (c) not a first-migration one-way door. So
it is a **future risk with a trigger**, not a re-block: *revisit if a jurisdiction
or enterprise contract requires per-subject staff erasability faster than the
backup-retention window.*

## 8. Verdict

**DISCHARGED-WITH-CONDITIONS.** The CRITIQUE 013 Blocking scheduling item is
genuinely closed: P1-01 no longer walks through an irreversible crypto-shred door
ahead of its own P1-13 design gate, because staff PII needs no per-subject crypto
column at first migration and the choice is bounded/self-healing. The board notes
(P1-01 and P1-13) are accurate and consistent with D-013 — P1-13 is correctly
re-scoped to customer PII only, keeps the schema-pattern dependency on P1-01, and
no longer falsely gates it. Task question 3: the note is accurate; nothing is
missed there.

**Objection I tried and why it fails:** I tried to re-block on the residual staff
erasure window (year-3-to-year-6 backup gap). It fails as a *Blocking* item
because it is not a first-migration one-way door — it is the same accepted
backup-expiry trade-off the customer design already tolerates, it is bounded, and
it self-heals at the backup horizon. It is logged as a future risk with a trigger
instead.

**Two non-optional conditions (Significant), both cheap and due now:**

1. **Correct the statutory citation.** The basis is **DPDP §7** (legitimate use —
   employment; removes the *consent* requirement) plus **§12(3)/§8(7)** (retention
   permitted where necessary for legal compliance). It is **not §17(2)(a)**, which
   is the State-instrumentality sovereignty exemption and is inapplicable to a
   private SaaS tenant's staff data. Do not carry §17(2)(a) into schema comments,
   TOS, or the legal brief.
2. **Reframe the scope claim.** Change "user/staff PII is out of DPDP erasure
   scope" to: *staff retain §12 erasure rights, subordinated to legal-retention
   duties and satisfied by soft-delete + backup-expiry rather than per-subject
   crypto-shred, because labour-retention floors run concurrent with / beyond the
   backup horizon — hence no per-subject crypto column is required at P1-01.* This
   is the real, sound justification; the statutory-exemption claim is not
   load-bearing for the P1-01 decision and must not be treated as if it were.

**One Minor note:** let the labour-law floor (not GST 72 months) set the
terminated-staff retention default once legal confirms; defaulting to GST 72
months is over-retention of PII, which is a (small) DPDP tension, not a
conservative safe harbour.

*This critique is preserved so the reasoning survives the session. The `user` PII
decision remains legally directional pending real counsel on the post-termination
boundary — that hedge is legitimate and unchanged; only the citation and the scope
wording are errors to fix now.*
