# How These 7 Agents Actually Coordinate — Setup Guide

> The seventh agent, **decision-critic**, is a review-only advisor with no
> delivery incentive. It pressure-tests decisions before they're logged
> `Accepted`, runs a drift review at every phase boundary, and may critique
> upward (the brief, the user's own instructions). It writes **only** to
> `CRITIQUES/NNN-<slug>.md` and to verdict lines in `DECISIONS_LOG.md` — never to
> code, schema, UI, or another agent's files. Its Blocking verdicts go to the user
> verbatim. All work anchors to the four goal outcomes **O1 See / O2 Run / O3 Plan
> / O4 Trust** (`PROJECT_BRIEF.md` §1a).

## Read this first: how Claude Code subagents really work

Claude Code subagents (the `.claude/agents/*.md` files here) are **not** six
AIs independently chatting with each other in the background. Each one is an
isolated, on-demand worker: it has its own system prompt and its own tool
access, it gets invoked with a specific task, it does that task in its own
context window, and it returns a result to whoever called it. They don't
share memory or talk to each other directly.

So "coordination" has to be engineered, not assumed. This setup gets you real
coordination through two mechanisms:

1. **A coordinator** (`project-master`) that you (or the main Claude Code
   session) route requests through. It decides which specialist agent handles
   a task and in what order.
2. **Shared files on disk** — `PROJECT_BRIEF.md`, `TASK_BOARD.md`,
   `DECISIONS_LOG.md` (and, as the project grows, `API_CONTRACT.md`,
   `ARCHITECTURE.md`) — that every agent is instructed to read before working
   and write to when it makes a decision. This is how a decision
   database-administrator makes actually reaches backend-developer: not
   through a live conversation, but through a file both are told to consult.

This is a well-established pattern for this kind of multi-agent build (often
called a "PM → Architect → Implementer → QA" pipeline) — it trades true
autonomy for something more valuable at this project size: reproducibility
and a paper trail you (and, later, an enterprise client's engineers) can audit.

## Prerequisites

1. **Claude Code installed** (`npm install -g @anthropic-ai/claude-code`, or
   see `https://docs.claude.com/en/docs/claude-code/overview`) and working in
   your Grovyn repo.
2. **This folder's contents placed correctly**:
   - `.claude/agents/*.md` → copy into your project root's `.claude/agents/`
     folder (project-scoped, recommended so they ship with the repo and any
     teammate/enterprise engineer gets the same agents automatically).
     Alternatively, put them in `~/.claude/agents/` to make them available
     across all your projects — use this only if you'll reuse these exact
     roles on other repos too.
   - `PROJECT_BRIEF.md`, `TASK_BOARD.md`, `DECISIONS_LOG.md` → project root.
3. **A root `CLAUDE.md`** (included in this folder) so the main session always
   has the brief in context and knows to route through `project-master`.
4. **API contract / architecture docs** — not included yet, because they
   don't exist until `project-planner` and `database-administrator` produce
   them. Once they do, save them as `API_CONTRACT.md` and `ARCHITECTURE.md`
   at project root and reference them in `CLAUDE.md` too.
5. **Hugging Face account + API token** for the AI features, stored as an
   environment variable (e.g. `HF_API_TOKEN`) — never committed. Confirm with
   `security-engineer` before this goes into any deployment config.

## Recommended day-to-day workflow

1. Open Claude Code in the repo, in your normal session (not a subagent).
2. Say what you want in plain terms — e.g. *"Let's start the Inventory
   module."* Claude Code will match this against `project-master`'s
   description and route to it (or explicitly say: *"Use the project-master
   agent to..."* if you want to force it).
3. `project-master` reads the shared files, decides the sequence (typically
   `project-planner` → `database-administrator` → `backend-developer` +
   `frontend-developer` in parallel once contracts exist → `security-engineer`
   review → `decision-critic` before any decision is logged `Accepted`), and
   either delegates directly or tells you what to run next.
4. Each specialist agent updates `TASK_BOARD.md` / `DECISIONS_LOG.md` when it
   finishes its slice.
5. Periodically ask `project-master` for a status report — it reads
   `TASK_BOARD.md` and gives you the plain-language module-by-module summary
   you'd give an enterprise stakeholder.

## Gate discipline (don't skip these even under time pressure)

- No backend/frontend implementation starts on a module until
  `project-planner` has produced a flow **and** `database-administrator` has
  produced the schema/contract for anything data-related.
- No `TASK_BOARD.md` row touching auth, tenant data, PII, financial/tax data,
  file upload, or a dependency bump gets marked `Done` without a passing
  `security-engineer` review.
- `project-master` owns enforcing this — if you're ever tempted to skip a
  gate to move faster, ask `project-master` to make the tradeoff explicit
  rather than skipping it silently.

## Model/tool notes

- `project-planner`, `security-engineer`, and `project-master` are set to a
  stronger reasoning model (`opus`) since their job is judgment and
  reconciliation, not high-volume code output.
- `frontend-developer` and `backend-developer` are set to `sonnet` for fast,
  high-volume implementation work.
- `security-engineer` intentionally has **no Write/Edit tools** — it reviews
  and recommends; it doesn't patch code itself, so nothing gets "fixed" without
  a second set of eyes (the implementing agent) applying and re-testing it.
- `decision-critic` (opus) **does** have Write — but scoped to `CRITIQUES/` and
  `DECISIONS_LOG.md` verdict lines only; it never touches code, schema, or UI.
  Standing checkpoints it runs without being asked: (1) before any decision moves
  to `Accepted`, (2) every phase boundary (full drift review), (3) whenever the
  user expresses unease about direction. Because it runs on the same model as the
  implementers, it flags self-review whenever the decision under review came from
  reasoning it would itself have produced.
- You can change these `model:` values in each file's frontmatter any time;
  they're a starting recommendation, not a hard requirement.

## Scaling this up

As modules ship, add these files at project root and reference them from
`CLAUDE.md` so every agent picks them up automatically:
- `API_CONTRACT.md` — living OpenAPI-style summary of endpoints, owned jointly
  by `project-planner` and `backend-developer`.
- `ARCHITECTURE.md` — system diagram + module boundaries, owned by
  `project-planner`.
- `SCHEMA.md` or actual migration files — owned by `database-administrator`.
- `SECURITY_REVIEWS/` — one file per review, owned by `security-engineer`, so
  findings history survives past the single-line `TASK_BOARD.md` note.
