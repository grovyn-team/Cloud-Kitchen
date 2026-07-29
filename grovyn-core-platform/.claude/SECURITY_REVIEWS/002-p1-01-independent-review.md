# Security Review 002 — P1-01 independent countersign (tenant · user · session · audit_log on Drizzle + RLS)

> **Independent** OWASP-Top-10 security-engineer pass on P1-01, performed to satisfy
> the separation-of-duties gap that `001-p1-01-schema-rls.md` self-declared in its
> provenance note (001 was written by the same coordinating actor that ran the
> critic relay, so it did not achieve separation of duties). This review verifies
> every claim against the actual files rather than inheriting 001's or CRITIQUE
> 016's conclusions. It supersedes/countersigns 001 in the append-only convention;
> 001 is left intact.
>
> Artifacts reviewed (line-by-line): `backend/src/db/schema.js`,
> `backend/drizzle/0000_conscious_namor.sql`, `backend/drizzle/0001_force_rls_and_grants.sql`,
> `backend/drizzle/bootstrap-roles.sql`, `backend/drizzle.config.js`,
> `backend/.env.example`, `backend/package.json`, and
> `backend/drizzle/meta/_journal.json` + `0000_snapshot.json` + `0001_snapshot.json`.

## Verdict

**I CONCUR with 001's core conclusion: NO Critical and NO High findings.** The
schema, RLS policies, FORCE, and privilege model are security-sound for P1-01's
scope. I independently re-derived every A01/A03/A08 claim from the SQL and journal,
not from the schema.js comments.

**Gate verdict: CLEAR WITH FOLLOW-UPS.** Nothing blocks P1-01 moving to Done. I add
one finding 001 missed (IR-01, Low) and re-affirm 001's SEC-P101-01 (bootstrap creds,
Medium) as the highest-priority carried item — it must be closed before any reachable
cluster exists, but no reachable deployment exists yet, so it is not a P1-01 blocker.

## Independent verifications

### Migration-chain integrity — VERIFIED (not covered by 001)
- `0001_force_rls_and_grants` is a hand-written custom SQL file. Such files only run
  if registered in `meta/_journal.json`. Confirmed it IS registered (idx 1, tag
  `0001_force_rls_and_grants`), so `drizzle-kit migrate` will apply the FORCE + GRANT
  statements. Had it been unregistered, FORCE and the whole grant/immutability model
  would silently never run — a latent High. It is wired correctly. This is the single
  most important thing 001 did not explicitly verify.

### A03 Injection — NO surface in P1-01. CONCUR.
- All four policy predicates (`0000` lines 72-75) are static catalog SQL:
  `... = NULLIF(current_setting('app.current_tenant', true), '')::uuid`. The GUC key is
  a hardcoded literal; role names are static identifiers. No format(), EXECUTE, string
  concatenation, or template interpolation anywhere in the migrations or schema.js.
  drizzle.config.js takes its URL only from env. The set_config write-path is P1-02
  (already mandated bound-parameter by CRITIQUE 015) and is absent here.

### A01 Broken Access Control / A04 Insecure Design — SOUND, fail-closed. CONCUR.
- RLS ENABLEd on all 4 tables (`0000` 15,28,43,58) AND FORCEd on all 4 (`0001` 20-23).
  FORCE closes the owner-bypass path (tables owned by the migrator).
- `tenant` policy compares its own id, not a tenant_id (`0000` line 74):
  `"tenant"."id" = NULLIF(...)::uuid`. The requested check passes; a scoped connection
  sees only its own tenant row and cannot enumerate other tenants.
- user/session/audit_log compare tenant_id (lines 72,73,75). Correct.
- Fail-closed by construction: unset context -> NULLIF -> NULL -> predicate false for
  USING and WITH CHECK -> zero rows / rejected insert. The ::uuid cast hard-errors on
  non-UUID text rather than widening. Both USING and WITH CHECK written explicitly.
- Policies are TO public: broader-and-safer, not a defect (grovyn_app is subject to it,
  BYPASSRLS migrator skips by design, future roles auto-covered).

### Privilege / grant model — SOUND. CONCUR + independently extended.
- grovyn_app: SELECT, INSERT on audit_log and NO UPDATE/DELETE (`0001` line 44).
  SELECT, INSERT, UPDATE and NO DELETE on tenant/user/session (lines 34-36).
  GRANT USAGE ON SCHEMA public with NO CREATE (line 25).
- Grants are additive-only; no GRANT ... TO PUBLIC, no ALTER DEFAULT PRIVILEGES, no
  column-level grant. The explicit grants are the ONLY table privileges grovyn_app
  holds — no alternate UPDATE/DELETE path to audit_log. Postgres refuses the privilege
  before RLS is even evaluated, so audit immutability holds against a compromised or
  buggy grovyn_app identity. Independently sound.
- No SERIAL/sequence columns exist (all PKs are uuid DEFAULT gen_random_uuid()), so no
  sequence grants are needed or missing. Enum USAGE reaches grovyn_app via the default
  PUBLIC grant on types — correct, no missing grant.
- FKs are ON DELETE no action (`0000` 59-63); with no DELETE grant they never fire —
  no cascade to abuse.

### A02 Cryptographic Failures / secrets — CONCUR.
- password_hash / token_hash are text NOT NULL with explicit never-store-plaintext
  comments; algorithm correctly deferred to P1-04. No crypto implemented here to attack.
- No real secrets committed. drizzle.config.js reads URL from env only. .env.example
  holds documented placeholders (SESSION_SECRET=change-me..., AUTH_DEMO_PASSWORD flagged
  DEMO-ONLY). bootstrap-roles.sql holds CHANGE_ME_* placeholder role passwords — IR-02.

## Findings

### SEC-P101-IR-01 — FORCE RLS and the entire GRANT model are invisible to Drizzle's snapshot, so ORM drift-detection cannot catch their removal — LOW (A08 Integrity / A05) — NEW, not in 001 or CRITIQUE 016
- Location: `backend/drizzle/meta/0001_snapshot.json` vs `0001_force_rls_and_grants.sql`.
- Verified directly: the snapshot encodes "isRLSEnabled": true for all 4 tables and the
  full policy predicates (current_setting x8, withCheck x4). But FORCE ROW LEVEL SECURITY
  appears 0 times and GRANT appears 0 times in the snapshot — Drizzle has no model for
  either. 0000 and 0001 snapshots are semantically identical (only id/prevId and key
  ordering differ).
- Consequence: the most security-critical hand-written controls in this task — FORCE RLS
  (the owner-bypass closer) and the privilege model (including audit_log's no-UPDATE/
  no-DELETE immutability) — are un-versioned from the ORM's perspective. A future
  db:generate diffs against a snapshot that believes only ENABLE (not FORCE) and zero
  grants exist. It won't emit a DROP (Drizzle won't drop what it can't see), so it won't
  actively remove them — but a green/empty generate diff gives false "schema matches DB"
  confidence while these controls could be absent or altered in a real database and drift
  detection would never flag it. Preservation depends entirely on human discipline
  re-adding a hand migration after any schema change.
- Fix (owner: P1-10 test author + database-administrator): P1-10's isolation suite must
  assert these controls LIVE against the cluster, not via Drizzle:
  pg_class.relforcerowsecurity = true for all four tables, and
  has_table_privilege('grovyn_app','audit_log','UPDATE') = false /
  ('grovyn_app','audit_log','DELETE') = false (and DELETE=false on tenant/user/session).
  This is the only mechanism that catches accidental loss of FORCE or an over-broad grant.
  Pairs with 001's standing rec that P1-10 assert grovyn_app.rolbypassrls = false.
- Not blocking: P1-01's artifacts are correct as written; this is a drift-assurance gap,
  not a present defect.

### SEC-P101-IR-02 — Placeholder credentials in bootstrap-roles.sql can ship to a reachable cluster — MEDIUM (A05 / A07) — RE-VERIFIED, CONCUR with 001 SEC-P101-01
- Location: `backend/drizzle/bootstrap-roles.sql:27-28`.
- Independently confirmed: both roles created with committed literal passwords
  (CHANGE_ME_MIGRATOR, CHANGE_ME_APP). grovyn_migrator is LOGIN BYPASSRLS — the crown-
  jewel identity whose compromise defeats every isolation guarantee in this task at once.
  The inline rotate-me comment is operator discipline, not a control; an unmodified run
  against a network-reachable Postgres ships a BYPASSRLS login with a repo-public password.
- Medium (not High) ONLY because (a) no reachable deployment exists yet and (b) the file
  is deliberately outside the migration chain and must be run manually, so it cannot ship
  by accident via db:migrate. It becomes High the moment a cluster is stood up.
- Fix (owner: P7 deploy + database-administrator): parameterize the passwords via secrets/
  env injection at bootstrap time so an unmodified run cannot succeed with a known password
  (fail-closed), rather than relying on a CHANGE_ME comment. Make rotation a gated runbook
  step. Must be closed before any real cluster.

### SEC-P101-IR-03 — Migrator/runtime role separation depends on env discipline; forward-flag the reverse-fallback footgun — INFO (A05) — NEW angle
- Location: `backend/drizzle.config.js:20` (DATABASE_MIGRATOR_URL || DATABASE_URL) and
  `.env.example:24-38`.
- The migrator CLI falls back to DATABASE_URL if DATABASE_MIGRATOR_URL is unset. This
  direction is fail-loud: if DATABASE_URL points at grovyn_app (NOBYPASSRLS, no CREATE),
  migrations fail on DDL rather than doing damage.
- The dangerous direction is the inverse — runtime code ever falling back to the migrator
  (BYPASSRLS) URL. That wiring is P1-02, not built here, so this is a forward flag: P1-02's
  review must confirm the runtime pool uses grovyn_app with NO fallback to a BYPASSRLS URL,
  and that the two roles are genuinely distinct in every deployed environment. A runtime
  accidentally on grovyn_migrator silently dissolves all RLS. No P1-01 defect.

## Concurrences (independently re-checked, agree with 001)
- SEC-P101-02 (audit_log GRANT-layer immutability sound): CONCUR — re-derived above.
- SEC-P101-03 (no tamper-EVIDENCE; migrator/superuser out-of-band edits leave no trace):
  CONCUR, Low/future-hardening. Hash-chaining or a WORM external sink is the right long-
  term answer; do NOT add an UPDATE grant to make corrections convenient (that dissolves
  IR-02/SEC-P101-02).
- SEC-P101-04 (npm audit CI gate; drizzle-kit/dotenv confirmed devDependencies, out of the
  runtime path): CONCUR — verified package.json runtime deps are only cors, drizzle-orm,
  express, pg.
- CRITIQUE 016 C.1 pre-context read path is a P1-02/P1-04 design capability, not a P1-01
  access-control defect — from the security lens, "runtime role reads nothing without a
  tenant context" is the correct fail-closed posture. CONCUR. Flag: if the resolution uses
  SECURITY DEFINER, its search_path/body must be locked down and reviewed at P1-02.

## Carried standing recommendations
1. P1-10 must assert LIVE against the cluster: relforcerowsecurity=true (x4),
   has_table_privilege UPDATE/DELETE = false per IR-01, and grovyn_app.rolbypassrls = false.
   Drizzle cannot police these — tests must.
2. Bootstrap credential rotation -> gated, parameterized deploy step, not a comment (IR-02).
   Close before any reachable cluster.
3. Wire npm audit (backend + frontend) as a CI gate (baseline; concrete target = drizzle-kit
   dev-only esbuild advisories).
4. P1-02 review must confirm bound-parameter set_config, no runtime->migrator URL fallback,
   and transaction-scoped GUC correctness under connection pooling (IR-03).

## Sign-off
Independent security-engineer countersign of 001. CLEAR WITH FOLLOW-UPS — P1-01 may move to
Done. No Critical/High. One new Low (IR-01); 001's Medium re-affirmed (IR-02) as the top
carried item.
