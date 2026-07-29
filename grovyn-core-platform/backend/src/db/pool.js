/**
 * P1-02 S3 — runtime Postgres connection pool.
 *
 * This is the ONLY pool the running application server is ever allowed to
 * query through. It authenticates exclusively as the NOBYPASSRLS `grovyn_app`
 * role (see `drizzle/bootstrap-roles.sql`, `drizzle/0001_force_rls_and_grants.sql`)
 * so Postgres Row-Level Security is a real backstop behind the app-layer DAL
 * (P1-03, `../db/dal.js`) for every query issued at request time.
 *
 * Non-optional (SECURITY_REVIEWS/002 IR-03, carried on the P1-02 TASK_BOARD
 * row): this module reads ONLY `DATABASE_APP_URL`. It does NOT fall back to
 * `DATABASE_URL` or `DATABASE_MIGRATOR_URL` under any circumstance — those
 * are the drizzle-kit CLI's variables (`drizzle.config.js`), used exclusively
 * by the BYPASSRLS `grovyn_migrator` role for migrations/seed, and must never
 * be reachable from request-serving code. If a deployment forgets to set
 * `DATABASE_APP_URL`, this module throws at import time (fail loudly at boot)
 * rather than silently widening to a broader-privileged connection or a
 * connection that doesn't exist.
 *
 * This module owns connection lifecycle only. It does NOT set
 * `app.current_tenant` and does NOT hand out scoped query access by itself —
 * that is `../middleware/tenantContext.js` (P1-02 S2). Nothing should import
 * `pool` directly to run a request-time query; go through
 * `tenantContext.js`'s `withTenantContext()` so the tenant GUC is always set
 * before a query can run on a checked-out connection.
 */

import pg from 'pg';

const APP_DATABASE_URL = process.env.DATABASE_APP_URL;

if (!APP_DATABASE_URL) {
  throw new Error(
    '[db/pool] DATABASE_APP_URL is not set. The runtime pool must authenticate ' +
      "as the NOBYPASSRLS `grovyn_app` role and MUST NOT fall back to DATABASE_URL " +
      'or DATABASE_MIGRATOR_URL (SECURITY_REVIEWS/002 finding IR-03 — those are ' +
      'the BYPASSRLS migrator/CLI variables and would silently dissolve every ' +
      'RLS guarantee if reused here). Set DATABASE_APP_URL to a grovyn_app ' +
      'connection string before starting the server. See backend/.env.example.'
  );
}

/**
 * Singleton runtime pool. `max` intentionally left at pg's default (10) —
 * P1-02's job was correctness under pooling/reuse, not sizing; revisit
 * sizing with real production load data.
 *
 * Timeouts (P1-03 / SR3-01, SECURITY_REVIEWS/003 — Medium, A05 availability):
 * previously unset, which meant a single wedged/slow query could hold a
 * pooled connection until the OS TCP timeout, and — with no
 * `connectionTimeoutMillis` — every OTHER request's `pool.connect()` would
 * queue indefinitely behind it. On the single-box (D-006) deployment target
 * that is a real cross-tenant denial-of-service coupling: one tenant's bad
 * query can starve every other tenant's requests, including login. Values
 * chosen (documented here per the current fast-mode directive — no
 * DECISIONS_LOG entry for this task):
 *   - `connectionTimeoutMillis: 5_000` — how long `pool.connect()` waits for
 *     a free connection before rejecting. Fails fast with a clear, catchable
 *     error instead of a request hanging indefinitely under pool exhaustion
 *     (the P1-04 login path in particular needs this to error rather than
 *     hang). 5s is generous for normal connection-establishment latency and
 *     short enough that a queued request surfaces the problem quickly.
 *   - `statement_timeout: 15_000` — server-side ceiling (ms) on a single SQL
 *     statement's execution, including lock-wait time. The primary defense:
 *     Postgres itself cancels the statement and frees the connection/locks,
 *     which is more informative and less disruptive than the client-side
 *     backstop below. 15s comfortably covers Phase 1/2 query shapes (point
 *     lookups, small rollups) while bounding how long one tenant's
 *     pathological query can occupy a connection.
 *   - `query_timeout: 20_000` — client-side backstop (ms), deliberately
 *     ABOVE `statement_timeout` so the server-side timeout is expected to
 *     fire first under normal operation; this only trips if the server-side
 *     timeout doesn't (e.g. a network partition after the server accepted
 *     the query, or a hang before the server started processing it).
 *   - `idle_in_transaction_session_timeout: 30_000` — server-side ceiling
 *     (ms) on how long a connection may sit inside an open transaction with
 *     no statement in flight. `statement_timeout` alone does not catch this
 *     case: `withTenantContext` (tenantContext.js) holds a connection inside
 *     BEGIN...COMMIT for the duration of the handler, and a handler bug that
 *     awaits something slow *between* queries (not during one) would
 *     otherwise hold the connection open with neither timeout above ever
 *     triggering. Not explicitly named in SR3-01 but closes the same class
 *     of gap; cheap to add now.
 * All four are pool-level `pg.Pool` config, applied to every connection this
 * pool opens. Revisit alongside real production load/latency data at P7.
 */
export const pool = new pg.Pool({
  connectionString: APP_DATABASE_URL,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 15_000,
  query_timeout: 20_000,
  idle_in_transaction_session_timeout: 30_000,
});

// A pooled *idle* client can still emit an 'error' event (e.g. the backend
// terminated the connection). Without a listener here, that would crash the
// whole Node process (pg's documented behavior for unhandled pool errors).
// Log and let the pool recover — never let one dead idle connection take
// down request serving.
pool.on('error', (err) => {
  console.error('[db/pool] unexpected error on idle client', err);
});
