# CRITIQUE 008 — Phase 0 sign-off drift review (the check nobody else runs)

**Overall: the plan is sound; no true stop-blocks. The one Blocking item is the
trivial critic-gate registration fix.**

This is the standing phase-boundary drift review: does the board still ladder to
O1–O4, what has grown, what has been dropped, what is stale.

## Findings, ranked

1. **The critic gate was vapor — Blocking (trivial fix).** The
   `decision-critic` agent file had no YAML frontmatter, so Claude Code never
   registered it — the mandatory gate the entire sign-off is built on did not
   exist. Fixed under D-012 (renamed to `decision-critic.md` + frontmatter);
   registers on next relaunch. *This was the single most important catch.*

2. **O3's real dependency is data, not AI — Significant.** Decoupling expansion
   from Hugging Face does **not** make O3 early; it's gated on Phase 2/3
   operational data (margin, revenue, repeat rate). Handled by scheduling it at
   ~Phase 3.5. Nobody should later treat "deterministic" as "shippable on an empty
   tenant" — on empty tenants the engine emits default-fallback fiction. See
   CRITIQUE 003.

3. **D-004 is stale; the Vite 5→8 bump exists uncommitted — Significant.** The
   audit declared the bump non-existent; it has since appeared in the working
   tree, untested. Per the dependency-bump rule it needs a security review;
   isolated as P0-07, kept out of the `.claude/` commit. Deeper lesson: the doc
   drifted from the tree within a single day — repo is ground truth over prose.

4. **Backups/DR for 72-month retention has no owner — Significant.** Self-hosting
   (D-006) + a 6-year retention duty (D-008) is a compliance claim you cannot make
   until a restore is tested. Added as P7-02, which still needs a **named human
   owner**.

5. **`.env.example` promises `AUTH_DEMO_PASSWORD` behavior the code ignores —
   Minor.** `auth.js` hardcodes the demo password; the test and `.env.example`
   invite setting the env var, which would 401 login and break `verify`. A
   docs↔code honesty gap (O4 in miniature). Closed by P1-04/P1-12.

6. **No outcome owns "premium experience" — Minor (critique upward).** The goal
   demands an "experience good enough to sell to an enterprise," but O1–O4 are all
   functional. The DoD mentions a "premium visual bar" with no phase-to-phase
   owner. Recommend either a tracked quality bar in the DoD or explicit acceptance
   that frontend-developer owns it every phase. Respectfully flagged to the
   principal.

7. **Auth-first ordering holds up — endorsed.** SEC-01..04 are the foundation
   every later module inherits. Objection tried: "port a read service first for a
   visible win." It fails — every ported service would inherit the forgeable-token
   boundary. Auth genuinely goes first.
