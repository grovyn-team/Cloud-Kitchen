# CRITIQUE 007 — D-009: Plan/pricing tier schema hooks

**Verdict: Endorse — Minor. Two-way (columns) / sticky (chokepoint).**

## 1. The decision, restated
Reserve the **shape** of monetization now (`plan`, `branch_limit`, `seat_limit` +
one `checkLimit()` chokepoint that returns `true`), defer the behavior. A cheap
option purchase.

## 2. Goal alignment
None of O1–O4 directly — it's business-model plumbing. But the legitimate kind:
near-zero cost now, expensive to retrofit onto live tenants (backfill +
grandfather paying customers).

## 3. Strongest case for
Three nullable columns + one chokepoint through which **all** creation paths route
is genuinely cheap. The chokepoint discipline is the valuable part — it's also
where per-plan feature flags and abuse limits will live.

## 4. Strongest case against
An always-true function is untested code paths — the first real enable exercises
every "limit exceeded" branch for the first time, maybe years later. Reserved
columns rot (what is a "seat"?). YAGNI applies to building an unused mechanism.

## 5. The cost nobody mentioned
The chokepoint becomes **security-relevant** the moment it's real (resource
creation = a DoS/abuse surface + a billing-integrity surface) — so it inherits a
review it won't get now because it "does nothing."

## 6. Reversibility
**Two-way** for the columns (nullable, ignorable). The chokepoint routing
discipline is the sticky part — but that's *good* stickiness.

## 7. What would have to be true for this to be wrong
That plan tiers never ship, making the reserved columns pure dead weight. Even
then the cost is three nullable columns.

## 8. Required change
Write the intended **semantics of each limit field** into the schema comment /
DECISIONS_LOG **now** — is a "seat" a user? per branch? does `branch_limit` count
tombstoned branches? — so the dormant columns aren't archaeology when enabled.

*Objection tried:* "YAGNI, don't build an unused mechanism." *Fails narrowly:* the
retrofit cost (backfill + grandfather live paying tenants) genuinely exceeds the
near-zero cost of three nullable columns + one pass-through — the specific case
where the option is worth its premium.
