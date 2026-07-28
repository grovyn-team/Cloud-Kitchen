# CRITIQUE 002 — §2a: pull a minimal Admin dashboard forward into Phase 2

**Verdict: Endorse with changes — Minor. Two-way door.**

## 1. The decision, restated
Making Phase 2's **definition of done** a user-visible outcome (see revenue
across branches) rather than a component inventory (a Sales module exists).
Reordering the success criterion, not just task order.

## 2. Goal alignment
**O1 (See the business)** — the headline outcome. Scheduling it fourth was the
misalignment the user correctly caught.

## 3. Strongest case for
A thin vertical slice (authenticate → upload sales → see revenue) proves the
whole stack end-to-end early, de-risks integration, and gives something to see
and sell — exactly what "an experience good enough to sell to an enterprise"
demands. A demoable O1 at the end of Phase 2 beats three complete-but-invisible
modules.

## 4. Strongest case against
Risk of rebuilding aggregations when Inventory/Customers land; a revenue-only
dashboard can underwhelm as an enterprise demo; "minimal" tends to grow. Pulling
it forward also drags the metrics/finance **service port** into Phase 2 — real
work, not just UI.

## 5. The cost nobody mentioned
The thin dashboard is implicitly the first real exercise of the
`(tenant_id, branch_id, date)` composite index and of RLS-under-aggregation —
good (early validation) but it means the slice also silently tests the tenancy
foundation.

## 6. Reversibility
**Two-way door.** Reordering near-independent work is cheap; drop tiles if the
thin dashboard proves premature. Don't agonize.

## 7. What would have to be true for this to be wrong
If "real revenue across branches" couldn't be computed without inventory-derived
COGS. It can: revenue is a direct sum of sales rows. Margin/profit tiles are what
need inventory — keep those out of the thin slice.

## 8. Required change
Scope the thin slice to **Sales-derivable** metrics (revenue, orders, AOV,
by-branch, day/week/month rollups). Defer margin/profit/health tiles to when
Inventory+Customers exist and **label them "coming," never fake them**.

*Objection tried:* "you'll rebuild it when inventory lands." *Fails:* revenue
tiles are stable regardless of inventory; only profit tiles depend on it and
those are out of the thin slice.
