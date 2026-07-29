# Security Review 001 — P1-01: first persistence layer (tenant · user · session · audit_log on Drizzle + RLS)

> OWASP-Top-10 review of **new work** — the P1-01 schema and migrations that
> introduce the first real tables, RLS policies, and the runtime/migrator role
> split. Scope of artifacts reviewed:
> - `backend/src/db/schema.js`
> - `backend/drizzle/0000_conscious_namor.sql` (auto-generated tables + `ENABLE
>   ROW LEVEL SECURITY` + `CREATE POLICY ... WITH CHECK`)
> - `backend/drizzle/0001_force_rls_and_grants.sql` (hand-written `FORCE` +
>   `GRANT`)
> - `backend/drizzle/bootstrap-roles.sql` (cluster-wide role creation)
>
> This is the DoD security gate for P1-01. It runs **independently of and after**
> the decision-critic pass (`CRITIQUES/016-d014-p1-01-schema-rls.md`) — it does
> not inherit or rubber-stamp the critic's findings; where they overlap (notably
> the GRANT-layer audit_log immutability) they were re-verified here from a pure
> privilege/OWASP lens against the migration SQL directly.
>
> **Provenance note (transparency):** no separate `security-engineer` subagent
> could be spawned in this session (no delegation tool was available to the
> coordinating role), so this OWASP pass was conducted directly against the
> artifacts following the security-engineer methodology and the structure of
> `000-baseline-owasp.md`. It reflects the same review discipline; a strict
> separation-of-duties workflow may still want an independent security-engineer to
> countersign before P1-01 is flipped to Done. Nothing below is taken on trust —
> every finding cites the line/grant it rests on.

## Verdict

**CLEARS the P1-01 security gate. No Critical or High findings.** The schema,
RLS policies, and privilege model are security-sound for this phase. The
tenant-isolation predicate carries **no injection surface within P1-01's own
artifacts** (it is a static catalog object; the only dynamic value is a session
GUC, `::uuid`-cast, and the request-time `set_config` that populates it is P1-02's
job and is already mandated bound-parameter by CRITIQUE 015). The GRANT-layer
audit_log immutability is independently verified **sound**. Findings SEC-P101-01..04
are Medium/Low/Informational and all **forward-looking** — none blocks P1-01 from
reaching Done. Three of them are already tracked on the board via CRITIQUE 016's
follow-ups; this review confirms them from the security side and adds the
bootstrap-password and audit-tamper-evidence angles.

## What was checked, and what it rests on

### A03 Injection — RLS policy predicates: NO INJECTION SURFACE IN P1-01. Verified.
- The isolation predicate is identical across all four policies (`0000` lines
  72-75), e.g. for `user`:
  `("user"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)`
  in both `USING` and `WITH CHECK`.
- This is a **static, compiled policy stored in the catalog** — there is no string
  interpolation, no `format()`, no `EXECUTE`, no dynamic SQL anywhere in
  `schema.js` or the generated migration. The only runtime-variable input is the
  `app.current_tenant` GUC read via `current_setting(..., true)`.
- Two independent defenses make the GUC path safe even against a malformed value:
  (1) `NULLIF(..., '')` maps an unset/empty context to `NULL`, which Postgres
  evaluates as false for both `USING` and `WITH CHECK` → **fail-closed by
  construction** (no context ⇒ zero rows, verified live in D-014); (2) the
  `::uuid` cast rejects any non-UUID text with a hard error rather than silently
  widening the predicate. An attacker who could somehow inject arbitrary text into
  the GUC still cannot craft a value that matches another tenant's rows without
  already knowing that tenant's UUID and being able to set the context to it —
  which is exactly the P1-02 chokepoint, not a P1-01 concern.
- **The real injection surface is the `set_config` call that sets the GUC
  per-request — that lives in P1-02, and is already mandated to use a bound
  parameter (`set_config('app.current_tenant', $1, true)`), not string
  interpolation (CRITIQUE 015, tracked on the P1-02 row).** This review confirms
  P1-01 itself introduces no such surface, and flags that P1-02's implementation
  must not regress it. No A03 finding against P1-01.

### A01 / A04 Broken Access Control & Insecure Design — SOUND, fail-closed default.
- RLS is `ENABLE`d (`0000`) **and** `FORCE`d (`0001` lines 20-23) on all four
  tables — so isolation applies even to the table owner, closing the "ownership
  becomes a silent bypass path" hole if ownership ever changes.
- `tenant` is correctly not self-`tenant_id`-scoped; its policy compares its own
  `id` to the context (`0000` line 74), so a scoped connection sees only its own
  account row and cannot enumerate other tenants' name/slug/plan.
- The secure default is the *absence* of access: no context ⇒ no rows, cross-tenant
  INSERT rejected by `WITH CHECK` (both verified live in D-014). This is the
  correct fail-closed posture for A04.
- The pre-context read gap (login/onboarding cannot run as `grovyn_app`) that
  CRITIQUE 016 §C.1 raised is a *design capability* to be owned in P1-02/P1-04, not
  an access-control **defect** — from the security lens, "the runtime role can read
  nothing without a tenant context" is the safe failure mode, not a vulnerability.
  Already tracked on the P1-02 row.

### A02 Cryptographic Failures — schema shape correct; algorithm deferred (P1-04).
- `password_hash` (`user`) and `token_hash` (`session`) are `text NOT NULL`, and
  the schema comments are explicit: never store plaintext or a reversible encoding.
  The actual hashing algorithm (argon2id/bcrypt) and token-hashing scheme are
  correctly P1-04's scope — there is no crypto *implemented* here to attack.
- Informational: the schema cannot itself *enforce* that a caller stores a hash
  rather than plaintext in a `text` column — that is an app-layer discipline that
  P1-04's security review must confirm at implementation time. No P1-01 finding;
  carry the check to P1-04.

### A05 Security Misconfiguration — SEC-P101-01 (bootstrap credentials) below.
- `GRANT USAGE ON SCHEMA public TO grovyn_app` and no `CREATE` — correct; the
  runtime role cannot create objects in `public`.
- `grovyn_app` is `NOBYPASSRLS`; `grovyn_migrator` is `BYPASSRLS` and is documented
  as never serving an HTTP request — correct privilege separation.

### A06 Vulnerable/Outdated Components — Informational (SEC-P101-04).
- Runtime deps (`backend/package.json`) are `cors`, `drizzle-orm`, `express`, `pg`;
  `drizzle-kit` and `dotenv` are **devDependencies** (verified). The 4 moderate
  `npm audit` advisories D-014 flagged are inside `drizzle-kit`'s bundled dev-only
  `esbuild` dev-server — **not in the runtime dependency path**, only reachable by
  the `generate`/`migrate` CLI, which is not a production-served surface. Acceptable
  for this phase; see SEC-P101-04 for the CI-gate recommendation.

### A08 Software & Data Integrity — audit_log immutability: independently SOUND.
See SEC-P101-02 (verification) and SEC-P101-03 (residual tamper-evidence gap).

## Findings

### SEC-P101-01 — Placeholder credentials in `bootstrap-roles.sql` can ship to prod — MEDIUM (A05 Misconfiguration / A07)
- Location: `backend/drizzle/bootstrap-roles.sql:27-28`.
- Both roles are created with hardcoded placeholder passwords
  (`'CHANGE_ME_MIGRATOR'`, `'CHANGE_ME_APP'`). The file's inline comment correctly
  says these must be changed and come from a secrets manager in prod — but that is
  operator discipline, not a control. If this file is run unmodified against a
  reachable cluster, `grovyn_migrator` (a `BYPASSRLS` role — full cross-tenant
  access) ships with a **publicly known password committed to the repo**.
- `grovyn_migrator` is the crown-jewel identity: its compromise defeats every
  tenant-isolation guarantee in this task at once. It must never live in the app
  runtime environment, must be rotated off the placeholder before any reachable
  deployment, and its credential must be held more tightly than `grovyn_app`'s.
- Fix (owner: security-engineer + whoever owns P7 deploy): the deployment runbook
  (P7-01/P7-02) must make bootstrap password rotation a **gated step**, not a
  comment; prefer parameterizing the passwords (env/secrets injection at bootstrap
  time) over committed placeholder literals so an unmodified run cannot succeed with
  a known password. Ties to the idempotency fix already tracked on P1-10.
- Not blocking for P1-01 (no reachable deployment exists yet), **but must be closed
  before any real cluster is stood up** — same class as baseline SEC-01.

### SEC-P101-02 — GRANT-layer audit_log immutability — INDEPENDENTLY VERIFIED SOUND — INFO (A08)
- Location: `backend/drizzle/0001_force_rls_and_grants.sql:34-44`.
- Re-verified from the privilege lens, not taken from CRITIQUE 016: `grovyn_app` is
  granted `SELECT, INSERT` on `audit_log` and **no** `UPDATE`/`DELETE` anywhere;
  `tenant`/`user`/`session` get `SELECT, INSERT, UPDATE` and **no** `DELETE`. Grants
  are additive and there is no `ALTER DEFAULT PRIVILEGES`, no column-level grant, and
  no grant to `PUBLIC` in the migration, so the explicit grants are the *only* table
  privileges `grovyn_app` holds — there is no alternate path to `UPDATE`/`DELETE` on
  `audit_log`. Postgres refuses the privilege **before** RLS is evaluated, so this
  defends against a compromised or buggy application identity, which is the realistic
  threat. This is stronger than D-008 required and is the correct model. Confirmed
  sound; no change required to the grant model.
- The withheld `DELETE` on `tenant`/`user`/`session` correctly enforces D-008's
  soft-delete-only rule at the privilege layer. FKs are `ON DELETE no action`
  (`0000` lines 59-63), consistent — with no DELETE grant they never fire, so there
  is no cascade to abuse.

### SEC-P101-03 — audit_log has no tamper-EVIDENCE, and operator corrections are un-audited — LOW (A08 Integrity, future hardening)
- Immutability here is enforced by **privilege**, not by tamper-evidence. A
  `BYPASSRLS`/superuser operator (`grovyn_migrator`) can still alter or delete an
  `audit_log` row out-of-band, and doing so leaves **no trace** — the audit log
  cannot record edits to itself. CRITIQUE 016 §B.1 raised this meta-gap for the
  runbook; from the A08 lens it is also a *tamper-evidence* gap: nothing lets a later
  auditor detect that a correction happened.
- Acceptable for this phase (the escape hatch is legitimate and now tracked for the
  P7 runbook). Recorded as a future hardening item for a higher-assurance posture:
  consider hash-chaining audit rows (each row carries a hash of the prior) or
  shipping audit events to an append-only/WORM external sink, so tampering becomes
  *detectable* even by the migrator role. Not required now; do not add an `UPDATE`
  grant to `grovyn_app` to make corrections "convenient" — that dissolves SEC-P101-02.

### SEC-P101-04 — Apply the standing `npm audit` CI gate to the new toolchain — INFO (A06)
- The baseline's standing recommendation (add `npm audit` as a CI gate) now has a
  concrete target: `drizzle-kit`'s dev-only `esbuild` advisories. They are out of the
  runtime path today, but the gate should be wired so a future advisory that lands in
  a *runtime* dep (`drizzle-orm`/`pg`) is caught. Confirm `drizzle-kit`/`dotenv` stay
  in `devDependencies` (verified now) so they never enter the production install.

## Cross-check against CRITIQUE 016's forward specs (security concurrence)
- §C.1 pre-context read path (P1-02/P1-04): from the security lens the fail-closed
  default is correct; the resolution (narrow auth role or `SECURITY DEFINER`
  resolver) must itself be security-reviewed when built — a `SECURITY DEFINER`
  function is a privilege-escalation surface if its search_path/body is not locked
  down. Flagged for the P1-02 review.
- §5/§C.2 audit_log + customer-PII erasure (P1-13): concur — crypto-shredding the
  jsonb snapshot fields is the correct reconciliation of immutability with erasure.
- §B.3 fail-closed `retain_until` (P1-13/purge): concur — a NULL `retain_until` on a
  soft-deleted row must be treated as do-not-purge-and-alert.
- §B.2 `grovyn_app.rolbypassrls = false` standing assertion + idempotent bootstrap
  (P1-10): concur strongly — a silent BYPASSRLS grant is the single highest-impact
  drift that dissolves every guarantee in this review; the standing test is the only
  thing that catches it.

## Standing recommendations (carried/added)
- Wire `npm audit` (backend + frontend) as a CI gate (baseline, now concrete).
- Tenant-isolation security tests (baseline) land as P1-10; this review adds that
  P1-10 must also assert the runtime role's `NOBYPASSRLS` bit against the real
  cluster.
- Bootstrap credential rotation must be a gated deploy step, not a comment (SEC-P101-01).
