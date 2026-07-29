/**
 * P1-03 — fail-closed scoped data-access layer (DAL).
 *
 * This is the *primary* tenant-scoping enforcement layer; Postgres RLS
 * (P1-01/`schema.js`) is the backstop, not the other way round (per the
 * D-001/D-003 framing this task closes). The property that must hold, and
 * does hold by construction:
 *
 *   There is no code path through this module that executes a query
 *   without a tenant context already set on the underlying connection.
 *
 * This is achieved by NOT reinventing a query builder or a tenant-filter
 * mechanism. `createScopedDb(client)` is only ever called from
 * `../middleware/tenantContext.js`'s `withTenantContext()`, and only AFTER
 * `BEGIN` + `SELECT set_config('app.current_tenant', $1, true)` have already
 * run on `client` inside the same transaction (see that file). The `client`
 * this function receives is therefore never "context-less" — there is no
 * constructor argument, code path, or exported helper here that can produce
 * a usable `db` handle bound to a connection that hasn't had tenant context
 * established first. A future feature module cannot "forget" to scope a
 * query because scoping isn't something a query *adds* — it's already true
 * of the connection every query in this module's output runs on, enforced
 * transparently by Postgres RLS the moment any SQL (Drizzle-built or raw)
 * touches a tenant-scoped table.
 *
 * Shape: this wraps Drizzle's own query builder (`drizzle-orm/node-postgres`)
 * bound to the per-request client, rather than hand-rolling a repository
 * layer — Drizzle's `.select()/.insert()/.update()/.delete()` and the
 * relational `.query.<table>.findMany()/.findFirst()` API (both available
 * off the object this module returns) already give feature code typed,
 * schema-aware access with no extra machinery to maintain. A `.raw(text,
 * params)` escape hatch is included for the rare case Drizzle's builder
 * doesn't fit (e.g. calling `resolve_tenant_by_slug`-style SQL functions) —
 * it is a thin pass-through to the SAME already-scoped client, so it is not
 * a bypass of anything, just a different syntax for the same guarantee.
 *
 * Deliberately NOT exported from here: the raw `pool` (`./pool.js`) and
 * anything that could construct a `drizzle()` instance off an unscoped
 * connection. Application/feature code should never import `drizzle-orm`
 * directly against `pool` — go through `withTenantContext` so this module
 * is the only thing that ever builds a query-capable object, and it only
 * ever does so on an already-scoped client.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

/**
 * @param {import('pg').PoolClient} client a checked-out pg client that
 *   `withTenantContext` has ALREADY run `BEGIN` and a bound-parameter
 *   `set_config('app.current_tenant', $1, true)` on, inside the same
 *   transaction. Never call this with a bare pool or a client that hasn't
 *   had tenant context established — every query issued through the
 *   returned object will otherwise hit RLS's fail-closed "no context"
 *   behavior (zero rows on read, rejected write), which is safe (never a
 *   cross-tenant leak) but is not the tenant-scoped behavior a handler
 *   expects, and indicates a caller bypassed the middleware.
 * @returns {import('drizzle-orm/node-postgres').NodePgDatabase<typeof schema> & { raw: (text: string, params?: unknown[]) => Promise<import('pg').QueryResult> }}
 *   a Drizzle query-builder instance scoped to this one request's
 *   transaction, plus a `.raw()` escape hatch for parameterized SQL text.
 */
export function createScopedDb(client) {
  const db = drizzle(client, { schema });

  // Attach the raw-SQL escape hatch directly on the Drizzle instance rather
  // than wrapping/freezing it — Drizzle manages internal session state on
  // this object, so we extend it instead of reconstructing or freezing it.
  // A fresh `db` is built per request (this function is called once per
  // `withTenantContext`-wrapped request), so nothing here is shared or
  // mutable across requests/tenants.
  db.raw = (text, params) => client.query(text, params);

  return db;
}

/**
 * Re-exported so feature/service code that needs to reference a table
 * (e.g. `eq(schema.user.tenantId, ...)` — though tenant-id predicates
 * should almost never be hand-written; RLS already applies them) can import
 * the schema from the DAL rather than reaching into `./schema.js` directly.
 * Both are equivalent; this is a convenience re-export, not a different
 * schema.
 */
export { schema };
