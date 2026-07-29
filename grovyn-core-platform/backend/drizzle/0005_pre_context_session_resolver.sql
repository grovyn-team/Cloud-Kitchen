-- P1-04 — third pre-context SECURITY DEFINER resolver function, extending
-- D-015's pattern (`0002_pre_context_auth_resolvers.sql`) from login to
-- ongoing request authentication.
--
-- Problem: exactly the same pre-context problem D-015 solved for login also
-- applies to verifying an EXISTING session on every subsequent request. A
-- bearer token proves possession of a session, but the server does not yet
-- know which tenant that session belongs to — and the `session` table's RLS
-- policy (`session_tenant_isolation`, schema.js) requires `app.current_tenant`
-- to already be set to look a session up at all. There is no client-supplied
-- value here we can trust to set that context before verifying the token
-- (that would be exactly the "trust a client-supplied tenant id" anti-pattern
-- the architecture rules forbid) — the token itself is the only thing to look
-- up by, and it must be looked up across all tenants to find out which one it
-- belongs to, then validated.
--
-- Resolution: `resolve_session_by_token_hash`, a third narrow, parameterized
-- SECURITY DEFINER function, following D-015's exact shape (fixed signature,
-- single hardcoded/filtered query, no `format()`/`EXECUTE`/string
-- concatenation, `search_path` locked to `''`, `EXECUTE` revoked from PUBLIC
-- and re-granted only to `grovyn_app`). It is called through the SAME narrow
-- `runPreContextQuery(pool, fn)` helper (`src/db/preContext.js`) D-015's
-- forward spec (SR3-03 / CRITIQUE 018 F2) asked P1-04 to build for
-- `resolve_tenant_by_slug`/`authenticate_lookup` — this is not a second,
-- competing escape hatch back to the raw pool; it is the same kind of call
-- (SELECT from a fixed-signature pre-context resolver function) the helper
-- already exists to run.
--
-- Deliberately returns the session's `tenant_id` (so the caller can then
-- establish real tenant context for the REST of the request) together with
-- the joined user's role/deleted_at (so role is read from the DB record on
-- every request, never from client input — CLAUDE.md's non-optional rule)
-- and an aggregated array of the user's currently-active branch grants (so
-- branch-scope middleware needs no second unscoped round trip). The token
-- itself is looked up by its SHA-256 hash — the same discipline as
-- `password_hash`/`token_hash`: never store or match on the raw secret.
--
-- This function does NOT filter out expired/revoked sessions or deleted
-- users in its WHERE clause — it returns the raw row (or none, if the hash
-- matches no session at all) and lets the caller (P1-04's session
-- middleware) apply those checks explicitly and return one indistinguishable
-- generic 401 for every invalid case, the same "one chokepoint decides
-- validity, not the query" shape `authenticate_lookup` already established
-- for login.
--
-- Assumes `grovyn_migrator` / `grovyn_app` already exist (bootstrap-roles.sql)
-- and this migration runs as `grovyn_migrator`, same as every prior one.

CREATE FUNCTION resolve_session_by_token_hash(p_token_hash text)
RETURNS TABLE (
  session_id uuid,
  tenant_id uuid,
  user_id uuid,
  session_expires_at timestamptz,
  session_revoked_at timestamptz,
  user_email text,
  user_name text,
  user_role public.user_role,
  user_deleted_at timestamptz,
  branch_ids uuid[]
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT
    s.id,
    s.tenant_id,
    s.user_id,
    s.expires_at,
    s.revoked_at,
    u.email,
    u.name,
    u.role,
    u.deleted_at,
    COALESCE(
      (
        SELECT array_agg(sba.branch_id)
        FROM public.staff_branch_access sba
        WHERE sba.user_id = s.user_id
          AND sba.tenant_id = s.tenant_id
          AND sba.revoked_at IS NULL
      ),
      ARRAY[]::uuid[]
    )
  FROM public.session s
  JOIN public."user" u ON u.id = s.user_id
  WHERE s.token_hash = p_token_hash
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION resolve_session_by_token_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_session_by_token_hash(text) TO grovyn_app;
