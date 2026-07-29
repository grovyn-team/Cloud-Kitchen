/**
 * P1-04 — narrow pre-context query helper.
 *
 * D-015 (`drizzle/0002_pre_context_auth_resolvers.sql`) built two
 * `SECURITY DEFINER` resolver functions (`resolve_tenant_by_slug`,
 * `authenticate_lookup`) specifically because authentication is inherently
 * pre-context: a login request must resolve a tenant and look up a user
 * BEFORE any `app.current_tenant` GUC exists to set, so it structurally
 * cannot go through `withTenantContext`/the scoped DAL (P1-02/P1-03), which
 * both require a tenant id to already be known. CRITIQUE 018 (F2) /
 * SECURITY_REVIEWS/003 (SR3-03) flagged this as an open gap: without a
 * sanctioned helper, P1-04 would be tempted to reach for the raw, unguarded
 * `pool` export directly — losing every structural guardrail
 * `tenantContext.js` builds (no BEGIN/COMMIT discipline, no `DISCARD ALL`
 * before release, no single chokepoint to audit) and interacting badly with
 * SR3-02 (a leaked session-level `app.current_tenant` on a recycled
 * connection would otherwise make a context-less read return a leaked
 * tenant's rows instead of failing closed).
 *
 * This module is that sanctioned helper, and the ONLY other place in the
 * codebase besides `src/middleware/tenantContext.js` that touches `pool`
 * directly. It is deliberately NOT a general-purpose escape hatch: it does
 * NOT run `BEGIN`, does NOT call `set_config`, and does NOT hand back
 * anything beyond a plain `pg` client for the caller to issue exactly the
 * query it needs. It exists to run calls into the three pre-context
 * `SECURITY DEFINER` resolver functions the schema defines
 * (`resolve_tenant_by_slug`, `authenticate_lookup`,
 * `resolve_session_by_token_hash` — the last one added by this task,
 * extending D-015's pattern from login to per-request session verification)
 * — nothing here validates or restricts the SQL text a caller passes in, so
 * every call site through this helper MUST be one of those three resolver
 * calls, never an ad hoc tenant-scoped query. `set_config`/tenant context is
 * correctly absent here: these functions are `SECURITY DEFINER` and do not
 * need it — they bypass RLS by construction, scoped instead by their own
 * fixed, parameterized `WHERE` clause (see the migration files for the
 * privilege/ownership model).
 *
 * @param {import('pg').Pool} pool a pg Pool authenticated as `grovyn_app`
 *   (see `src/db/pool.js`) — the same pool `withTenantContext` uses, just
 *   without a transaction/context wrapped around this particular checkout.
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export async function runPreContextQuery(pool, fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
