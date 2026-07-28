# CRITIQUE 003 — §2b: decouple expansion planning from AI

**Verdict: Endorse with changes — Significant.**

## 1. The decision, restated
Two bundled decisions: (i) expansion planning is deterministic and goal-critical,
not AI (verified true in code — `expansionPlanner.js`, `simulatorEngine.js` have
no HF calls); (ii) therefore schedule it earlier, on its own merit. The real open
question is (ii): *when* can it actually deliver O3.

## 2. Goal alignment
**O3 (Plan ahead)** — named directly in the one-line goal. Correct to treat as
goal-critical and to stop making it hostage to Hugging Face.

## 3. Strongest case for
The engine exists and is deterministic; rules-first + AI-as-garnish is the right
architecture and sells (it works offline). Making O3 depend on the least-reliable
dependency was a genuine misalignment.

## 4. Strongest case against — the catch
The engine's inputs are **net margin (needs Inventory), revenue (needs Sales),
and repeat rate (needs Customers)**. Fed an empty tenant it returns confident
**default fallbacks** (`margin 12%`, `repeat 0`, `revenue 45000` in the code) —
plausible fiction, an **O4 (Trust) violation dressed as an O3 feature**.
Decoupling from AI does **not** decouple from real data. The engine also hardcodes
India-specific costs (₹19L/store setup, 60% COGS, 25% commission, en-IN) — fine
for a GST-India launch but unstated tenant config masquerading as universal
constants.

## 5. The cost nobody mentioned
Scheduled too early it ships a feature that emits plausible-but-data-starved
projections — the most dangerous kind of wrong for a tool whose whole O3 pitch is
"decide using your own real data."

## 6. Reversibility
Scheduling = **two-way door.** The hardcoded-constants → tenant-config refactor is
closer to **one-way** (it's the projection input model).

## 7. What would have to be true for this to be wrong
That the engine produces trustworthy output on tenants without captured
operational data. It doesn't — it falls back to defaults.

## 8. Required changes
1. Schedule the deterministic engine **after Customers (~Phase 3.5)** so margin,
   revenue, and repeat-rate inputs are all real data (user's chosen answer).
2. Keep AI a Phase-5 narrative garnish that degrades to nothing.
3. Add a task to **lift the hardcoded India constants into tenant-configurable
   inputs** before O3 is "done," else projections are fiction.

*Objection tried:* "deterministic + exists, ship it early standalone." *Fails:*
deterministic ≠ trustworthy; on defaults it emits fiction, violating O4.
