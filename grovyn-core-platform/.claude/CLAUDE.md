# Grovyn — Claude Code Project Instructions

This repo uses a **7-agent workflow** (project-master, project-planner,
database-administrator, backend-developer, frontend-developer, security-engineer,
and **decision-critic**). See `ORCHESTRATION_GUIDE.md` for full details. Quick
rules for the main session:

- **Goal outcomes are the anchor.** Everything we build serves one of four
  outcomes — **O1 See the business**, **O2 Run the business**, **O3 Plan ahead**,
  **O4 Trust it** (full text in `PROJECT_BRIEF.md` §1a). Every task cites the
  outcome(s) it serves; infrastructure names the user-visible capability it
  unblocks. Work that traces to nothing is scope creep — surface it, don't build
  it.
- **Repo is ground truth over prose.** When code and any document disagree —
  including `PROJECT_BRIEF.md` — verify against the code and correct the
  document. A Phase 0 audit found the brief describing a Docker deploy, runtime
  branding, and a Hugging Face integration that did not exist. Assume prose
  drifts; check.
- Treat `PROJECT_BRIEF.md` as the working source of truth for goals, roles, and
  constraints (subject to the ground-truth rule above). Re-read it if it's been a
  while since it was loaded.
- For any new request, prefer routing through the `project-master` subagent
  unless the user explicitly names a different agent.
- **Critic gate.** No `DECISIONS_LOG.md` entry moves to `Accepted` without a
  `decision-critic` review. The critic runs a drift review at every phase
  boundary whether or not asked. Its **Blocking verdicts go to the user
  verbatim** — `project-master` does not filter, soften, or summarize them, even
  when they contradict a plan already sequenced or a decision already made. The
  critic may critique upward, including `PROJECT_BRIEF.md` and the user's own
  instructions.
- Never mark work in `TASK_BOARD.md` as `Done` if it skips a required gate:
  planning → schema/contract → implementation → security review → critic on any
  decision (see `PROJECT_BRIEF.md` §6, Definition of Done).
- Log any non-trivial decision (schema, tenancy model, library choice, auth
  strategy) to `DECISIONS_LOG.md` — don't let decisions live only in chat
  history where the next session can't see them.
- **AI is optional garnish, never a critical path.** This project's AI features
  use the Hugging Face free Inference API only (no paid LLM APIs), and only for
  **non-critical, non-billable** features, behind strict timeout + cache +
  fallback. **No O1 or O3 capability may be unavailable because a model is** —
  expansion planning is a deterministic rules engine, not an AI feature.
