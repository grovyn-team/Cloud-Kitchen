# 008 — Integration Task Review: Auth/RBAC Retirement + Deployment/Secrets (P1-05/06/07, P7-01/02 gate)

Reviewer: security-engineer persona, independent pass.

**Honesty note on separation of duties (read before trusting this verdict):**
This review was produced by a general-purpose agent invocation adopting the
`security-engineer` persona/checklist (`.claude/agents/security-engineer.md`),
dispatched as a genuinely separate `Agent` tool run from the main coordinating
session per D-017's instruction — it did NOT write any of the code under
review, and it re-derived every claim below from the current repository state
rather than trusting `routes/v1/index.js`'s own doc comments or the
TASK_BOARD notes. However, it is **not literally an invocation of this repo's
registered `security-engineer` subagent** — this session cannot invoke
custom subagent types from the repo root (the same session/registration-scope
limitation `DECISIONS_LOG.md` D-012 and the `agents-launch-directory` memory
note describe). Flagging this the same way the project has been careful about
self-review integrity before (see the CRITIQUE 013 saga banner atop
`DECISIONS_LOG.md`): this is a same-model, differently-scoped review, not the
registered agent's own signature. Treat it as a strong independent check, not
as formally equivalent to a `security-engineer` subagent run.

Scope: exactly the two areas D-017 named — (A) retirement of the legacy HMAC
auth middleware and centralization onto `requireSession`/`requireRole`/
`requireBranchAccess`, and (B) the new Docker Compose deployment + secrets
handling. Both were shipped via commits `93c9e03` and `9e6899f`
(2026-08-01/02) without a security-review gate. This review discharges that
gate for P1-05/P1-06/P1-07 and speaks to the standing P7-02 deployment recs
(SEC-P101-IR-02, CRITIQUE 016 §B.1).

## VERDICT: CLEAR WITH FOLLOW-UPS for (A); FOLLOW-UPS REQUIRED (High, non-blocking-but-must-close-before-real-tenant-data) for (B)

No Critical. No High in section (A) — the auth/RBAC retirement is genuinely
complete and correctly built; the one thing D-017 most needed confirmed (F2
from `004-p1-04-auth.md`: is the legacy HMAC middleware really gone with no
route left reachable through it) is independently reconfirmed true. Section
(B) has **one High** (backups: no tested/documented restore, no offsite copy,
despite `deployment/README.md` asserting a "proven restore" that does not
exist in any reviewed file — a real gap against `PROJECT_BRIEF.md` §5.7's
explicit, named O4 compliance requirement) and two Mediums (unencrypted
backups at rest; `bootstrap-roles.sql` is not fail-closed as a standalone
artifact, only as re-wrapped by `docker-compose.yml`'s required-env-var
gates). **P1-05/P1-06/P1-07 may read `Done`** — the auth/RBAC gate they were
blocked on is satisfied. **P7-01/P7-02 should NOT read `Done`** on the
strength of this review — the High finding is exactly what P7-02 exists to
catch, and it isn't closed yet.

---

## Section A — Auth middleware retirement / RBAC centralization

### A1. Legacy `authMiddleware.js` is genuinely deleted, not merely unmounted — PASS
`ls backend/src/middleware/authMiddleware.js` → not found. A repo-wide grep
for `authMiddleware` returns **zero executable references** — only five doc
comments in `routes/auth.js:13`, `routes/v1/index.js:9`, `routes/expansion.js:13`,
`routes/financeManagement.js:13`, `routes/staffManagement.js:13`, all
correctly describing it as retired. This directly closes F2 from
`SECURITY_REVIEWS/004-p1-04-auth.md` ("Legacy HMAC token middleware still
mounted on all business routes") — the exact item D-017 flagged as needing
confirmation. **Confirmed genuinely closed, not just bypassed.**

### A2. Every mounted business route composes `requireSession`+`requireRole` — PASS (read the full file, not a sample)
Read `backend/src/routes/v1/index.js` end to end (264 lines). Ten auth-array
groups (`branchReadAuth`/`branchWriteAuth`, `salesAuth`, `inventoryAuth`,
`inventoryAliasAuth`, `customersAuth`, `staffMgmtAuth`, `notificationsAuth`,
`dashboardAuth`, `financeMgmtAuth`, `taxAuth`, `expansionAuth`), every one
built from `[requireSession(pool), requireSessionRole([...])]` from
`sessionAuth.js`, and every route registration spreads one of these arrays
before its handler. No route is mounted bare. Two routes layer a second
role check after the group array (`/notifications/:id/resolve`,
`/dashboard/by-branch`) — correct defense-in-depth, not a gap. `/auth/login`
is the only handler with no auth array (correct — it's the credential
exchange itself); `/auth/refresh`, `/auth/logout`, `/auth/me` each require
`requireSession(pool)` individually. `GET /health` is the only fully public
route (appropriate). No dead-end: I did not find a route reachable without
either `requireSession` or being `/health`/`/auth/login`'s own OPTIONS
preflight (`router.options` returns 200 with no body/side effect, harmless).

### A3. `req.tenantId`/`req.userRole`/`req.branchIds` are set ONLY from a DB-verified session row — PASS
`sessionAuth.js:63-69` — the sole assignment site for all four request
properties (`sessionId`, `tenantId`, `userId`, `userRole`, `branchIds`) is
inside `requireSession`, sourced from `row` — the result of
`resolve_session_by_token_hash($1)` keyed on `hashToken(token)` from the
`Authorization: Bearer` header. No other file in `backend/src` assigns to
`req.tenantId`, `req.userRole`, or `req.branchIds` (grepped). Login
(`auth.js:38-73`) reads `tenantSlug`/`email`/`password` from the body and
nothing else — the response echoes `role` back from `authService.login`'s
DB-resolved record, never round-trips a client-sent role (there is no `role`
field accepted in the request body at all).

### A4. No handler reads role/tenant/branch from client-controlled input — PASS
Grepped `backend/src/routes/*.js` for `req.body.role`, `req.headers`,
`req.query.role`/`.tenantId`, `req.body.tenantId`/`.branchIds` — **zero
matches**. The only client-supplied identifiers that influence authorization
decisions are `branchId` values arriving via request body/query (by design —
Sales/Inventory/Staff-branch-grant endpoints necessarily take a branch
argument), and every one of the ~10 call sites I checked (`sales.js` lines
72-84, 138-145, 230-237, 262-269, 305; `inventoryManagement.js` lines 78,
92-103, 201-208, 282-289, 349-356; `staffManagement.js:317`) runs it through
the same two-gate discipline established in prior reviews (005/006/007):
`isBranchAllowed(req, branchId)` (role/own-branch scope, from
`sessionAuth.js`) **and** `branchExistsInTenant(db, branchId)` (RLS-scoped
existence+ownership check) before the id is trusted for anything. No
regression from the pattern `SECURITY_REVIEWS/007` already cleared.

### A5. Demo login path is fully retired, not just gated — PASS
`POST /auth/demo-login` / `GET /auth/demo-stores` are not registered anywhere
in the current `routes/v1/index.js`. `config/index.js`'s `SESSION_SECRET`
fail-fast boot check and `config.auth.demoModeEnabled` were both removed in
`93c9e03` (`git show 93c9e03 -- .../config/index.js` — 33 lines deleted, the
entire demo-auth config block). Grepped the whole `backend/src` tree for
`SESSION_SECRET`, `sessionSecret`, `demoModeEnabled`, `AUTH_DEMO_MODE`,
`AUTH_DEMO_PASSWORD` — the only surviving hit is a doc-comment mention in
`routes/v1/index.js:12`. This is a **clean, complete** retirement: no dead
config, no reachable code path, no lingering env-var requirement that could
confuse a future deploy (this is also correctly documented in
`deployment/README.md:41-45`, which explicitly warns that a `SESSION_SECRET`
reference anywhere else is stale).

### A6. F1 from `SECURITY_REVIEWS/004` (no rate-limiting on `/auth/login`) — STILL OPEN, not addressed by this work
Grepped `backend/package.json` and all of `backend/src` for `rate-limit`,
`rateLimit`, `slow-down` — no matches, no dependency. This Integration Task
work touched `/auth/login` extensively (rewrote `routes/auth.js`, the auth
array wiring) but did not add throttling. Carried forward, unchanged from
004's original Medium rating — argon2's ~90ms cost remains the only natural
brake. Not a regression, but also not closed; flag again so it isn't lost a
second time.

### A7. No dead/legacy route left reachable — spot-verified, not just trusted from the comment
`routes/v1/index.js`'s own header comment claims a specific list of dead
routes was grepped-and-confirmed-caller-free before removal. I independently
spot-checked three of the claimed-dead paths (`GET /stores`, `GET /skus`,
`GET /aggregators`) against `grovyn-core-platform/frontend/src` — none
appear in `frontend/src/services/api.ts`'s current `apiPaths` map or any
`.tsx` fetch call (only in git history / removed files). I did not
exhaustively re-verify all ~20 claimed-dead routes line-by-line (would
duplicate the implementer's own grep with no reason to expect a different
result given the sample held), but the underlying mechanism this claim rests
on — `router.js` simply never importing or mounting the old route files — is
independently true regardless of whether the frontend-caller claim is 100%
exhaustive: an unmounted Express route is unreachable by construction, no
grep needed to prove that part.

**Section A summary:** the property D-017 most needed confirmed — that the
central `requireSession`/`requireRole`/`requireBranchAccess` model is the
*only* path to every real route, with zero surviving legacy/client-trusted
auth surface — holds. No Critical/High. **P1-05/P1-06/P1-07 may move to
`Done`** on this gate.

---

## Section B — Docker Compose deployment + secrets handling

### B1. `docker-compose.yml` genuinely enforces the migrator/app passwords — PASS, verified directly (not assumed)
Read `docker-compose.yml` in full. `migrate`, `backend`, and `backup`
services all reference `GROVYN_MIGRATOR_PASSWORD`/`GROVYN_APP_PASSWORD` via
Compose's `${VAR:?message}` syntax (lines 41, 43-44, 64, 95) — Compose
**refuses to start any of these containers at all** if the vars are unset,
before a single line of `migrate.sh` runs. `POSTGRES_SUPERUSER_PASSWORD` is
gated the same way (lines 16, 41). So the claim in the task brief — "the
insecure fallback in `migrate.sh` is dev-only and never hit in a real
compose-based deploy" — is **true for the documented compose deployment
path specifically**, confirmed by reading the compose file directly, not by
inference from `migrate.sh`'s own comments.

### B2. But `bootstrap-roles.sql` itself is NOT fail-closed as a standalone artifact — MEDIUM (A05 Security Misconfiguration)
- Location: `backend/drizzle/bootstrap-roles.sql:46-55`.
- The file unconditionally creates `grovyn_migrator`/`grovyn_app` with the
  literal passwords `'CHANGE_ME_MIGRATOR'`/`'CHANGE_ME_APP'` inside its
  `IF NOT EXISTS` guard (the guard controls *idempotency*, not password
  safety — a first run on any cluster gets the literal placeholder). The
  only thing that prevents this from shipping as the real password is
  **`docker-compose.yml`'s external enforcement** around `migrate.sh`'s
  subsequent `ALTER ROLE ... PASSWORD` step (B1) — a control that lives
  entirely outside this file.
- The file's own header comment (lines 1-2) reads: *"RUN ONCE PER CLUSTER,
  MANUALLY, BEFORE `npm run db:migrate`"* — this is now **stale**:
  `migrate.sh:59` already invokes this file directly as part of the
  automated compose flow, and the whole point of `deployment/README.md` is
  that nobody should run it manually anymore. A future operator reading only
  this file's own header (not `deployment/README.md`) is actively pointed at
  the unsafe, comment-only-protected manual path the task's own review brief
  was specifically worried about ("verify the fallback is dev-only... don't
  assume it from this description" — correctly skeptical; the answer is
  "yes, for the one documented path, no, not by construction of this file").
- This is exactly what SEC-P101-IR-02's original fix recommendation asked to
  avoid: *"parameterize the passwords via secrets/env injection at bootstrap
  time so an unmodified run cannot succeed with a known password (fail-closed,
  not a CHANGE_ME comment)."* That fix landed in `migrate.sh`+
  `docker-compose.yml`, genuinely — but `bootstrap-roles.sql` run any other
  way (bare `psql -f bootstrap-roles.sql` against a bare-metal/Kubernetes/
  manually-provisioned cluster, or a staging box that skips the compose flow)
  still succeeds silently with a well-known password on the crown-jewel
  BYPASSRLS role.
- Exploitability if hit: full-cluster compromise (BYPASSRLS bypasses every
  RLS tenant boundary this project's entire isolation model rests on) via a
  publicly-known, committed literal password. Severity is Medium rather than
  High/Critical specifically because reaching it requires an operator to
  deviate from the one documented deployment path — but "becomes High the
  moment a cluster is stood up" (the original SEC-P101-IR-02 language) is
  still literally true for any cluster stood up other-than-via-compose.
- **Fix recommendation** (for backend-developer/DBA, not applied by this
  review): (1) update `bootstrap-roles.sql`'s header comment to state
  plainly that `backend/scripts/migrate.sh` (via `docker-compose.yml`) is
  the only sanctioned invocation and that a manual run requires immediately
  following with the same `ALTER ROLE ... PASSWORD` step migrate.sh performs
  — don't leave the stale "run manually" instruction as the top-billed
  guidance. (2) Optionally harden the SQL itself with a `\set` + a
  `\if :{?migrator_pw}` guard (psql meta-command) so an invocation that
  doesn't supply real passwords via `-v` fails loudly instead of succeeding
  with the placeholder — closes the gap by construction, not just by doc
  fix.

### B3. Narrow same-cluster password-rotation window — INFO, not exploitable as deployed
`migrate.sh` bootstraps roles with the placeholder password (line 59) then
immediately `ALTER`s to the real one (lines 62-65) — on a true first run
there's a multi-statement window where the roles exist with the known
placeholder. `docker-compose.yml`'s own comment (lines 25-28) confirms
Postgres is **not published to the host** by default — only same-network
Compose services (`migrate`/`backend`/`backup`, all first-party) can reach
port 5432 at all. Exploiting this window requires an attacker already
present on the Docker network, at which point BYPASSRLS credentials are the
least of the problem. No action needed; noted for completeness since the
task asked about the fallback path specifically.

### B4. CRITIQUE 016 §B.1's `audit_log` correction runbook requirement — NOT MET
- `deployment/README.md` was read in full (147 lines). **Zero mentions** of
  `audit_log`, an out-of-band correction procedure, a named owner, or any
  change-control process for correcting an immutable audit row.
- This was registered as **non-optional** on the P7-02 `TASK_BOARD.md` row
  specifically because `audit_log` is GRANT-blocked from UPDATE/DELETE for
  `grovyn_app` (by design — tamper-evidence) and correctable only via the
  BYPASSRLS `grovyn_migrator`/superuser role out-of-band, which itself
  leaves **no audit trail of the correction having happened** — the exact
  meta-gap CRITIQUE 016 wanted named and owned before real operators are
  handed a working deploy story. This Integration Task work is precisely
  the deployment-README-shipping task that requirement was written for, and
  it wasn't carried into what shipped.
- Severity: Medium (A08 Software & Data Integrity Failures / process gap) —
  not exploitable by an external attacker, but a real, previously-flagged,
  non-optional requirement that remains unaddressed in the artifact whose
  entire purpose was to close it.

### B5. Backups: unencrypted at rest — MEDIUM (A02 Cryptographic Failures)
- `deployment/backup.sh` runs `pg_dump ... -Fc` (Postgres's compressed
  *custom* format — a container format for `pg_restore`, not an encryption
  format) and writes the result straight to a bind-mounted host directory
  (`docker-compose.yml:98-104`, `./backups` on the host). Nothing in the
  pipeline pipes the dump through `gpg`/`age`/`openssl enc` or any
  encryption-at-rest mechanism; no `chmod` is applied to the output file
  either (inherits the `backup` container's default umask — the service has
  no `user:` override in compose, so it runs as the `postgres:16-alpine`
  image's default user).
- This is a full logical dump of every tenant's data — sales, inventory,
  customer PII, tax records, `session`/`user` rows (password hashes, not
  plaintext, but still) — landing in plaintext-compressed form on a single
  host's disk, for data this project's own `PROJECT_BRIEF.md` §5.6/§5.7
  treats as carrying a 72-month statutory retention obligation.
- Fix recommendation: pipe `pg_dump`'s output through an encryption step
  (age or gpg with a key managed outside the container, e.g. injected via a
  secret the backup service reads but never writes to disk) before it lands
  in `./backups`, and set restrictive permissions (`chmod 600`) on each dump
  file. Owner: DBA/backend at the next P7-02 pass.

### B6. Backups: no offsite copy, and the README's "proven restore" claim does not correspond to anything in the repo — HIGH
- `PROJECT_BRIEF.md` §5.7 names this exact requirement explicitly:
  *"automated Postgres backups, tested restores, and an offsite copy... The
  compliance claim is only as real as the restore we've tested. **Needs a
  named owner** (Phase 7)."* `TASK_BOARD.md`'s P7-02 row title is literally
  *"Backups / tested restore / offsite — named owner required"*, Owner
  column still `—` (unassigned), Status still `Backlog`.
- What actually shipped in this Integration Task work covers only the
  backup-taking half: `deployment/backup.sh` (scheduled `pg_dump`, retained
  count) and a same-host bind mount. There is **no restore script anywhere
  in the repository** (grepped the whole tree for `pg_restore`/`restore` —
  the only hits are `backup.sh`'s own comment explaining *why* `-Fc` was
  chosen for restorability, and `deployment/README.md`'s dangling reference
  below). There is **no offsite replication** — `./backups` is a bind mount
  to the *same host* `postgres` runs on (correctly decoupled from the
  Docker volume so `docker compose down -v` doesn't destroy it too, but
  still a single physical host / single failure domain for disk failure,
  ransomware, or host loss).
- `deployment/README.md:136-140` (§5 "Backups") says: *"See the repo root's
  `deployment/backup.sh` and the 'Backup and restore' section
  there-adjacent... — scheduled `pg_dump`, plus a proven restore, not just a
  configured job."* **No "Backup and restore" section exists anywhere in
  this file** (read in full; §5 is four lines, then the doc moves straight
  to §6 "Bringing it down"). This sentence asserts a tested/proven restore
  procedure that is not present in any artifact I could find. That is a
  documentation-integrity problem in its own right, on a project that has
  been explicitly careful elsewhere about not asserting verification that
  didn't happen (the same principle the CRITIQUE 013 self-review-integrity
  banner and this very review's own preamble are built on).
- Why High and not Medium: this isn't a hypothetical DR nicety — it is a
  named, explicit, standing O4 compliance risk in `PROJECT_BRIEF.md` that
  this exact body of deployment work was the natural place to close, the
  work shipped a document that *claims* it was closed, and independently
  checking shows the claimed capability (a proven restore) does not exist.
  Discovering at actual restore-time that there is no tested procedure is
  the kind of failure that's often irreversible in effect (data already
  lost by the time you find out). Per this project's calibration rule
  (Critical/High reserved for real, not stylistic, risk) — a compliance
  function that is asserted-but-unbuilt, for legally-retained financial/PII
  data, on the deployment artifact specifically gated for this reason,
  clears that bar.
- Fix recommendation (DBA/backend, P7-02): (1) either write the missing
  "Backup and restore" section with a real, executed-at-least-once
  `pg_restore` walkthrough, or remove the false claim from
  `deployment/README.md` until one exists — don't leave the current
  overclaim in place either way. (2) Add an offsite copy step (rsync/rclone
  to any object store, even a cheap one) to `backup.sh` or a sibling script.
  (3) Assign the named owner `TASK_BOARD.md` P7-02 has been waiting on since
  before this work shipped.

### B7. Placeholder passwords do not leak into a real environment via `.env.example` — PASS
`.env.example` (repo root) documents `POSTGRES_SUPERUSER_PASSWORD`,
`GROVYN_MIGRATOR_PASSWORD`, `GROVYN_APP_PASSWORD`, `CORS_ORIGIN`,
`FRONTEND_PORT` with clearly-labeled `change-me-*` placeholders and an
inline strong-password-generation command; `.gitignore` (repo root) excludes
`.env`/`.env.*` while explicitly re-including `.env.example` and
`**/.env.example` — real secrets cannot land in git via this template.
Consistent with `deployment/README.md`'s own instructions. No finding.

### B8. CI workflow's hardcoded `CHANGE_ME_MIGRATOR`/`CHANGE_ME_APP` — NOT A FINDING, concur it's CI-only
`.github/workflows/backend-tests.yml` uses these literals against a Postgres
**service container** that exists only for the lifetime of the GitHub
Actions job, is not reachable from outside the runner's own localhost
network namespace, and is destroyed when the job ends — there is no
persistent cluster here for a leaked-credential window to matter against.
I independently agree with the task brief's own assessment: this is fine as
CI-only scaffolding, not a deployment-secrets finding. (The workflow does
correctly add `npm audit --omit=dev --audit-level=high` as a CI gate for
both backend and frontend — closing a standing recommendation carried since
`SECURITY_REVIEWS/000`/`002`.)

### B9. Dockerfiles — PASS, no findings
`backend/Dockerfile`: multi-stage, `USER node` (unprivileged) for the
request-serving `runtime` target, no secrets baked into any layer, a
separate `migrate` target only for the one-shot migration container (keeps
`psql` off the request-serving image's attack surface). `frontend/Dockerfile`:
static build served by nginx, `VITE_API_BASE_URL` deliberately left unset at
build time so the SPA calls relative `/api/...` paths rather than baking a
public URL into the bundle. Both have working `HEALTHCHECK`s wired
correctly into `docker-compose.yml`'s `depends_on: condition:
service_healthy` chain.

### B10. CORS — LOW/INFO, pre-existing footgun this work didn't close (not a regression)
`backend/src/app.js:12-17` + `backend/src/config/index.js:11-15`: when
`CORS_ORIGIN` is unset AND `NODE_ENV=production`, the backend falls back to
a hardcoded multi-origin allowlist that includes `http://localhost:5173`
(a dev server URL) alongside `credentials: true`. `docker-compose.yml`
itself supplies a *soft* default (`${CORS_ORIGIN:-http://localhost:8080}`,
not a required `${VAR:?}`), so the documented compose path never falls
through to this hardcoded list — but unlike the password vars (B1), nothing
stops a compose deployment that forgets to set `CORS_ORIGIN` from silently
getting a working-but-wrong single-origin default, and any *non*-compose
production deployment that doesn't set the env var gets the dev-localhost
entry trusted with credentials. This predates the Integration Task work
(carried from `SECURITY_REVIEWS/000`'s SEC-07, already Low/Info there) and
this deployment work had the opportunity to tighten it (e.g. make
`CORS_ORIGIN` a hard-required var in production the way the DB passwords
now are) but didn't. Non-blocking; fold into the next deploy-config pass.

---

## Findings by severity

- **High-1** (B6, A02/A09/Documentation-integrity): No tested/documented
  restore procedure and no offsite backup copy exist despite
  `deployment/README.md` asserting a "proven restore." Closes neither half
  of `PROJECT_BRIEF.md` §5.7's named O4 requirement. Must close before this
  deployment is trusted for real tenant data / before P7-02 reads `Done`.
- **Medium-1** (B2, A05): `bootstrap-roles.sql` is fail-closed only via
  `docker-compose.yml`'s external `${VAR:?}` gates around `migrate.sh`, not
  by its own construction; its header comment still points at an unsafe
  manual invocation path. Update the comment and consider a psql-level
  guard.
- **Medium-2** (B4, A08): CRITIQUE 016 §B.1's non-optional `audit_log`
  correction runbook (named owner + change-control process) is absent from
  `deployment/README.md`.
- **Medium-3** (B5, A02): Backup dumps are unencrypted at rest on the host
  filesystem; no file-permission hardening applied.
- **Medium-4 / carried, unchanged** (A6, A07): No rate-limiting on
  `/auth/login` — carried from `SECURITY_REVIEWS/004` F1, still open, not
  addressed by this Integration Task work despite touching this route
  extensively.
- **Low/Info-1** (B3): Narrow same-cluster password-rotation window on
  first `migrate.sh` run; not externally reachable (Postgres port not
  published), no action required.
- **Low/Info-2** (B10): Pre-existing CORS hardcoded-fallback footgun,
  unchanged by this work; tighten `CORS_ORIGIN` to a required var in the
  next deploy-config pass.
- **Info** (B8): CI's hardcoded ephemeral-container credentials — correctly
  scoped, not a finding, concur with the task brief's own assessment.

## Verdict line

**Section A (auth/RBAC retirement): CLEAR WITH FOLLOW-UPS — no Critical, no
High. F2 from `SECURITY_REVIEWS/004` (legacy HMAC middleware) is confirmed
genuinely closed. P1-05/P1-06/P1-07 may move to `Done` on this gate.** F1
(login rate-limiting) remains open and should be tracked as its own
follow-up task, not silently dropped a second time.

**Section B (deployment/secrets): FOLLOW-UPS REQUIRED, not clear to close
P7-01/P7-02 — one High (B6, backups: no tested restore/offsite despite a
README claim otherwise) and three Mediums (B2, B4, B5).** None of these are
actively-exploitable-today vulnerabilities in the OWASP sense (they require
either an operator deviating from the documented path, or a disaster
scenario the current setup can't actually recover from) — but High-1
specifically is exactly the kind of gap this project's Definition of Done
process exists to catch before it's discovered the hard way, on data this
project has a legal retention obligation for. Recommend: do not mark
P7-01/P7-02 `Done` on the strength of the deployment work as it stands;
route B6/B2/B4/B5 to backend-developer/DBA as concrete, scoped follow-ups
(each finding above names file, location, and fix), then re-review before
`Done`.
