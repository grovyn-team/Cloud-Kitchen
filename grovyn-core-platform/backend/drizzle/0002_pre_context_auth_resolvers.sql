-- P1-02 S1 — pre-context auth resolver functions.
-- Raised by: decision-critic (CRITIQUE 016 §C.1). Logged as D-015
-- (.claude/DECISIONS_LOG.md).
--
-- Problem: authentication is inherently pre-context. A login request must
-- (1) resolve a tenant from a subdomain/slug, then (2) find a user by email
-- within that tenant — BEFORE any `app.current_tenant` GUC exists to set.
-- Under the RLS policies in 0000/0001, the runtime role `grovyn_app`
-- (NOBYPASSRLS) reads ZERO rows from `tenant`/`user` with no context set —
-- correct fail-closed isolation, but it means `grovyn_app` cannot perform
-- steps 1 or 2 of login. The only role that can is `grovyn_migrator`
-- (BYPASSRLS) — and `bootstrap-roles.sql` explicitly forbids that role from
-- ever serving a live request. So there was no legal path for login.
--
-- Resolution (D-015): two narrow, parameterized SECURITY DEFINER resolver
-- functions, each a single hardcoded/filtered query — not a general-purpose
-- RLS bypass. Ownership + privilege model:
--   - Created by whichever role runs this migration (`grovyn_migrator` per
--     `drizzle.config.js`'s DATABASE_MIGRATOR_URL) — that role becomes the
--     function OWNER, and SECURITY DEFINER functions execute with the
--     OWNER's privileges regardless of caller. `grovyn_migrator` is already
--     BYPASSRLS, so these functions bypass RLS/FORCE ROW LEVEL SECURITY by
--     construction — exactly like any BYPASSRLS connection would. That is
--     the intended elevation; it is scoped by each function's own WHERE
--     clause (below), not by RLS, since RLS does not apply inside the
--     function body at all.
--   - `grovyn_app` (the runtime, request-facing role) gets ONLY `EXECUTE` on
--     these two functions — no direct SELECT/table grant on `tenant`/`user`
--     beyond what 0001 already granted (which still requires context, so it
--     stays useless pre-context; these functions are additive, not a
--     widening of 0001's grants).
--   - `search_path` is locked to `''` and every identifier inside each body
--     is schema-qualified (`public.tenant`, `public."user"`) — closes the
--     classic SECURITY DEFINER search_path hijack, where a malicious/shadow
--     object placed earlier in a caller-influenced search_path could
--     otherwise be resolved instead of the real `public` table.
--   - `EXECUTE` is REVOKEd from PUBLIC (Postgres grants it by default on
--     CREATE FUNCTION) and re-GRANTed only to `grovyn_app` explicitly, so a
--     future role added to the cluster does not silently inherit this
--     pre-context read path.
--
-- Self-serve tenant CREATION is explicitly OUT OF SCOPE here (deferred,
-- D-015) — both functions are READ-only lookups against already-provisioned
-- tenants/users; neither inserts a row.
--
-- Assumes `grovyn_migrator` / `grovyn_app` already exist (see
-- `drizzle/bootstrap-roles.sql`, run once per cluster before this migration)
-- and that this migration itself runs as `grovyn_migrator` (same assumption
-- `0001_force_rls_and_grants.sql` already makes for its GRANTs).

-- ============================================================================
-- resolve_tenant_by_slug — step 1 of login: find an active tenant by its
-- public slug (subdomain/URL segment), before any tenant context exists.
-- Returns only the columns login needs (id to then call
-- authenticate_lookup, name/slug for UI) — deliberately NOT
-- plan/branch_limit/seat_limit or any timestamp. Excludes soft-deleted
-- (churned) tenants (`deleted_at IS NULL`) so a churned tenant's slug can no
-- longer authenticate, even though the slug itself stays reserved
-- (`tenant_slug_unique_idx` is global, not partial, by design — see
-- schema.js). The existing `tenant_slug_unique_idx` unique index on `slug`
-- already covers this WHERE clause; no new index needed.
-- ============================================================================
CREATE FUNCTION resolve_tenant_by_slug(p_slug text)
RETURNS TABLE (id uuid, name text, slug text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT t.id, t.name, t.slug
  FROM public.tenant t
  WHERE t.slug = p_slug
    AND t.deleted_at IS NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION resolve_tenant_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_tenant_by_slug(text) TO grovyn_app;

-- ============================================================================
-- authenticate_lookup — step 2 of login: find an active user by email
-- *within an already-resolved tenant*. Takes `p_tenant_id` from step 1's
-- result — it never resolves a tenant itself, so it cannot be used on its
-- own to enumerate users across tenants; a caller must already hold a valid
-- tenant id.
--
-- Bakes in, as the single chokepoint, the two rules CRITIQUE 016 flagged as
-- easy for P1-04 to get wrong if left to per-call-site application code:
--   - `deleted_at IS NULL` filter (§B.4 — a deleted user and an active user
--     can hold the same email under the partial unique index, so an
--     unfiltered lookup by email is ambiguous).
--   - case-insensitive match on `lower(email)`, matching the exact shape of
--     `user_tenant_email_active_unique_idx` on
--     `(tenant_id, lower(email)) WHERE deleted_at IS NULL` — this WHERE
--     clause is index-covered as-is, no new index needed.
-- Returns `password_hash` so the caller (P1-04) can verify with
-- argon2id/bcrypt; returns nothing beyond what a login flow needs (no
-- retention/audit columns).
-- ============================================================================
CREATE FUNCTION authenticate_lookup(p_tenant_id uuid, p_email text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  email text,
  name text,
  password_hash text,
  role public.user_role
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT u.id, u.tenant_id, u.email, u.name, u.password_hash, u.role
  FROM public."user" u
  WHERE u.tenant_id = p_tenant_id
    AND lower(u.email) = lower(p_email)
    AND u.deleted_at IS NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION authenticate_lookup(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authenticate_lookup(uuid, text) TO grovyn_app;
