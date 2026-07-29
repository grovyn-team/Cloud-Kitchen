/**
 * P1-02 S2 — per-request Postgres tenant-context middleware.
 *
 * Every RLS policy in `src/db/schema.js` gates on the session GUC
 * `app.current_tenant` (see `tenantIsolation()` there). That GUC must be set
 * with `set_config('app.current_tenant', $1, true)` (the `is_local = true`
 * form, transaction-scoped exactly like `SET LOCAL`) **inside the same
 * transaction** that then runs the request's queries — never on a bare pool
 * connection outside a transaction, and never via string-interpolated SQL.
 * (D-002 / CRITIQUE 015: the P1-00 spike's claim that raw interpolation was
 * "unavoidable" for this statement is false — `set_config` IS
 * parameter-bindable, unlike the `SET`/`SET LOCAL` *statement* form the spike
 * used, which genuinely does not accept a bound parameter.)
 *
 * There is no real authenticated-request flow yet (P1-04 is unbuilt). This
 * middleware does not invent one: it trusts `req.tenantId` to already be a
 * verified UUID by the time it runs. **P1-04 is required to set
 * `req.tenantId` from the authenticated session/resolved tenant — never from
 * a client-supplied header/query/body value** — before this middleware (or
 * anything wrapped by `withTenantContext`) executes. UUID-shape validation
 * here is defense-in-depth only, not the primary control (the bound
 * parameter is); it exists so a malformed value fails with a clean 400
 * instead of a confusing `::uuid` cast error deep in the query, and so this
 * middleware never has to trust the *format* of what upstream code hands it.
 *
 * Design: `withTenantContext(pool)` returns a wrapper for a *handler*
 * function of shape `(req, db) => resultOrThrow`, not a bare
 * `(req, res, next)` Express middleware. This is deliberate, not
 * decorative:
 *   - The handler is only ever given `db` — the P1-03 DAL's scoped Drizzle
 *     instance (`../db/dal.js`'s `createScopedDb(client)`), bound to the
 *     transaction's checked-out client — never the pool, never the raw `pg`
 *     client, never `res`. A handler cannot reach the pool by accident
 *     (there's nothing to reach: this module never exports it) and cannot
 *     manage the transaction itself (`db` has no `.query('COMMIT')`-capable
 *     surface beyond running ordinary SQL via Drizzle or `db.raw()`).
 *   - The wrapper COMMITs (or ROLLBACKs) and releases the connection BEFORE
 *     any response byte is sent — the handler returns a value (or throws),
 *     it does not call `res.json()` itself. This avoids the well-known
 *     `res.on('finish')`-based transaction middleware footgun, where the
 *     response has already been flushed to the client by the time a
 *     post-hoc COMMIT is attempted (and could still fail).
 *   - On ANY error (BEGIN, set_config, handler throw, or COMMIT itself), the
 *     transaction is ROLLBACK'd and the connection is released with an error
 *     (`client.release(err)`), which tells `pg` to destroy the connection
 *     rather than return a possibly-poisoned session to the pool for a
 *     later, unrelated request/tenant to reuse.
 *   - On the happy path, `DISCARD ALL` runs before the connection is
 *     returned to the pool (P1-03 / SR3-02, SECURITY_REVIEWS/003 — Low,
 *     defense-in-depth). Tenant isolation itself never depended on this: the
 *     GUC is transaction-scoped (`is_local = true`, reset automatically on
 *     COMMIT/ROLLBACK) and re-set on every request regardless. But without a
 *     reset, a buggy handler's session-level `SET`, `SET ROLE`, temp table,
 *     prepared statement, or advisory lock could ride a recycled connection
 *     into the next, unrelated request. If `DISCARD ALL` itself fails, the
 *     connection is treated as untrustworthy and discarded (not recycled) —
 *     the already-committed request result is still returned to the client
 *     either way, since the data was already durably persisted by COMMIT.
 *
 * Response envelope: handlers normally return plain data, serialized as
 * `res.status(200).json(result)`. To send a non-200 status, a handler must
 * call the exported `reply(status, body)` helper (P1-03 / SR3-04, CRITIQUE
 * 018 F1) rather than returning a bare `{ status, body }` object — the
 * previous duck-typed check (`'status' in result && 'body' in result`)
 * would misinterpret a legitimate data row that happens to own columns
 * named `status`/`body` (e.g. a support ticket) as an HTTP envelope. `reply`
 * brands its return value with a module-private `Symbol` that ordinary
 * application data can never accidentally produce.
 */

import { createScopedDb } from '../db/dal.js';

/**
 * RFC-4122-shaped UUID (any version/variant nibble — the tenant id is a
 * Postgres `uuid` default-random v4 column, but this check only needs to
 * reject non-UUID garbage before it reaches the `::uuid` cast in the RLS
 * predicate, not validate a specific version).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidTenantId(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Branded marker (P1-03 / SR3-04, CRITIQUE 018 F1). Module-private —
 * intentionally not exported — so nothing outside this file can construct a
 * value that satisfies `isReplyEnvelope`. Application data (fetched under
 * the caller's tenant context, however it happens to be shaped) can never
 * accidentally carry this Symbol as an own property.
 */
const REPLY_ENVELOPE = Symbol('tenantContext.replyEnvelope');

/**
 * The ONLY sanctioned way for a `withTenantContext`-wrapped handler to send
 * a non-200 status. Returns a branded, unambiguous envelope — never confused
 * with a plain data object, unlike the duck-typed `{status, body}` check
 * this replaces.
 *
 * @param {number} status HTTP status code.
 * @param {unknown} body response body to serialize.
 */
export function reply(status, body) {
  return { [REPLY_ENVELOPE]: true, status, body };
}

function isReplyEnvelope(value) {
  return Boolean(value) && typeof value === 'object' && value[REPLY_ENVELOPE] === true;
}

/**
 * P1-04 extraction: the transaction-management core of `withTenantContext`
 * pulled out into its own reusable primitive, so the same
 * BEGIN/set_config/COMMIT-or-ROLLBACK/DISCARD-ALL/release discipline is
 * available to a caller that already has a server-verified `tenantId` in
 * hand but is NOT wrapping an Express `(req, res)` handler — e.g. P1-04's
 * session-verified `/auth/refresh`, `/auth/logout` (which DO go through
 * `withTenantContext` below, since by the time they run, session middleware
 * has already set `req.tenantId`) and, distinctly, the LOGIN handler's own
 * post-authentication writes (issuing the session row, writing the
 * `auth.login_*` audit_log row) — login cannot use `withTenantContext`
 * itself because `req.tenantId` isn't known until *after* the pre-context
 * resolver calls run inside the handler, but once it IS known (a real,
 * looked-up tenant id — not blind client input), writing to that tenant's
 * `session`/`audit_log` rows is an entirely ordinary tenant-scoped write and
 * deserves the exact same BEGIN/set_config/COMMIT discipline as any other
 * request, not a hand-rolled one-off.
 *
 * Behavior is IDENTICAL to what `withTenantContext`'s wrapped handler did
 * inline before this extraction (verified by re-running
 * `tests/tenantContext.pgtest.mjs` unmodified after this refactor — see
 * P1-04's report): connect, BEGIN, bound-parameter `set_config`, run `fn`
 * against a scoped DAL instance, COMMIT + `DISCARD ALL` + clean release on
 * success: ROLLBACK + `client.release(err)` (destroy, never recycle a
 * possibly-poisoned connection) on any failure, then rethrow so the caller
 * decides how to surface the error.
 *
 * @param {import('pg').Pool} pool a pg Pool authenticated as `grovyn_app`.
 * @param {string} tenantId a tenant id the CALLER has already verified
 *   server-side (from a resolved-by-DB value, e.g. `resolve_tenant_by_slug`'s
 *   result, or a verified session's `tenant_id`) — this function does NOT
 *   re-validate it beyond what `set_config`'s bound parameter + the RLS
 *   predicate's own `::uuid` cast already enforce. Never pass raw,
 *   unverified client input here.
 * @param {(db: ReturnType<typeof createScopedDb>) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export async function runInTenantContext(pool, tenantId, fn) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    // Bound parameter ($1), not string interpolation -- the non-optional
    // correction from D-002/CRITIQUE 015. `is_local = true` (the literal
    // third argument) scopes the setting to this transaction only, the
    // same as `SET LOCAL`, and it is reset automatically on
    // COMMIT/ROLLBACK regardless of which happens.
    await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

    // P1-03 DAL: the ONLY place in the request path that constructs a
    // query-capable object, and it only ever does so on `client` AFTER
    // the two statements above have run in this same transaction. See
    // `../db/dal.js` module doc for the full fail-closed-by-construction
    // argument.
    const db = createScopedDb(client);

    const value = await fn(db);
    await client.query('COMMIT');

    // Healthy connection, transaction closed cleanly. Reset session-level
    // state (P1-03 / SR3-02) before returning it to the pool for the next
    // checkout (a different request, possibly a different tenant) --
    // belt-and-braces, not load-bearing for tenant isolation itself (see
    // module doc). If the reset fails, the connection is untrustworthy --
    // discard it rather than recycle -- but the caller's work already
    // committed successfully above.
    try {
      await client.query('DISCARD ALL');
      client.release();
    } catch (discardErr) {
      console.error(
        '[tenantContext] DISCARD ALL failed after commit; discarding connection',
        discardErr
      );
      client.release(discardErr);
    }

    return value;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // Best-effort: the connection may already be unusable (e.g. the
      // error that triggered this was itself a protocol/connection
      // failure). Logged, not swallowed silently, but we still fall
      // through to release(err) below either way.
      console.error('[tenantContext] ROLLBACK failed after handler error', rollbackErr);
    }
    client.release(err);
    throw err;
  }
}

/**
 * @param {import('pg').Pool} pool a pg Pool authenticated as the NOBYPASSRLS
 *   `grovyn_app` role (see `src/db/pool.js` for the runtime singleton).
 *   Accepted as a parameter (rather than importing the singleton directly)
 *   so tests can bind this to a small, isolated pool to force connection
 *   reuse under concurrency (S3.2) without touching the real runtime pool or
 *   requiring `DATABASE_APP_URL` to be set just to exercise the middleware
 *   logic.
 * @returns {(handler: (req: import('express').Request, db: ReturnType<typeof createScopedDb>) => any) => import('express').RequestHandler}
 *   a decorator: give it a tenant-scoped handler, get back a normal Express
 *   route handler.
 */
export function withTenantContext(pool) {
  return function wrap(handler) {
    return async function tenantScopedHandler(req, res, next) {
      const tenantId = req.tenantId;
      if (!isValidTenantId(tenantId)) {
        return res.status(400).json({
          error: 'BadRequest',
          message: 'Missing or invalid tenant context.',
        });
      }

      let result;
      try {
        result = await runInTenantContext(pool, tenantId, (db) => handler(req, db));
      } catch (err) {
        return next(err);
      }

      if (result === undefined) {
        return res.status(204).end();
      }
      if (isReplyEnvelope(result)) {
        return res.status(result.status).json(result.body);
      }
      return res.status(200).json(result);
    };
  };
}
