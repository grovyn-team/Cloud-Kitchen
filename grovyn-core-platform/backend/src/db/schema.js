/**
 * P1-01 — Phase 1 minimal schema: tenant, user, session, audit_log.
 *
 * Tenancy model: D-001 (shared schema, mandatory `tenant_id`, Postgres RLS as
 * a defense-in-depth backstop behind the app-layer DAL — the DAL wrapper is
 * P1-03, NOT built here).
 * ORM: D-002 (Drizzle, resolved by the P1-00 spike — see
 * `spikes/p1-00-rls-pooling/SPIKE.md`). This file reuses that spike's proven
 * `pgPolicy()` / `.enableRLS()` pattern verbatim (see `tenantIsolation()`
 * below), not a re-derivation.
 * Retention: D-008 (soft-delete only for financial/audit-adjacent data;
 * tombstone, don't hard-delete).
 * Plan hooks: D-009 (`plan`/`branch_limit`/`seat_limit` on `tenant`, dormant —
 * semantics documented inline per D-009's own required follow-up).
 * User PII: D-013 (user/staff PII gets ordinary soft-delete + retention, NOT
 * a per-subject crypto-shred column — that machinery is Phase-3 customer-PII
 * scope only, P1-13).
 *
 * Scope note: this migration does NOT build the per-request RLS context
 * middleware (P1-02) or the fail-closed DAL wrapper (P1-03) — RLS here is a
 * real, load-bearing backstop the moment these tables exist and are queried
 * by any role other than the migrator, but the *primary* tenant-scoping
 * enforcement (the DAL) is a separate, later task.
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  pgPolicy,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Shared tenant-isolation predicate for every *child* (tenant-scoped, i.e.
 * has a `tenant_id` FK) table. Identical in shape to the predicate proven in
 * the P1-00 spike (`spikes/p1-00-rls-pooling/drizzle-spike/src/schema.ts`):
 *   tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
 * `current_setting(..., true)` (the `missing_ok` form) returns NULL instead
 * of erroring when no context has been set — combined with `NULLIF(..., '')`
 * this means "no context set" naturally evaluates the predicate to NULL,
 * which Postgres treats as false for both USING and WITH CHECK — i.e.
 * fail-closed by construction (verified behavior: spike gate 4).
 *
 * Context itself is set per-request by P1-02 via
 * `set_config('app.current_tenant', $1, true)` with a BOUND PARAMETER (not
 * string interpolation — D-002/CRITIQUE 015 non-optional correction). Not
 * built in this file.
 *
 * IMPORTANT (CRITIQUE 015 §1, verified in this task — see P1-01 report):
 * every policy below sets BOTH `using` and `withCheck` to this same
 * expression explicitly. Postgres's documented fallback (a `FOR ALL` policy
 * with only `USING` given reuses it for `WITH CHECK` too) is real, but this
 * schema does not rely on that implicit fallback for a tenant-isolation
 * control — it is written out so the intent is unambiguous in the generated
 * SQL and in any future code review, and so the guarantee doesn't depend on
 * a future edit accidentally narrowing the policy to something where the
 * fallback no longer applies (e.g. splitting into per-command policies).
 */
const tenantIsolation = (table) =>
  sql`${table.tenantId} = NULLIF(current_setting('app.current_tenant', true), '')::uuid`;

/**
 * Shared retention-policy marker (D-008). A row's `retention_category`
 * records which purge-eligibility floor governs it; `retain_until` (per
 * table below) is the concrete computed date. Both are DORMANT in P1-01 —
 * there is no purge job yet; this only ensures every future soft-delete
 * write has somewhere correct to record the policy that applied.
 *   - 'standard': no statutory floor; ordinary soft-delete data (kept
 *     non-hard-deletable per this task's blanket rule, not because the law
 *     requires it).
 *   - 'financial_72mo': CGST §36 — 72 months from the annual-return due
 *     date, +1 year after final disposal of any appeal (D-008). Not used by
 *     any P1-01 table directly (no financial records yet — those land in
 *     Phase 2) but reserved here so Phase 2 tables reuse the same enum
 *     rather than inventing a parallel one.
 *   - 'employment_72mo_placeholder': D-013 consequence #2 — conservative
 *     placeholder for terminated-staff PII pending real legal confirmation
 *     of the labour-law-specific post-termination floor (Payment of Wages
 *     Act / PF / ESI, commonly 3-8 years). Over-retention, not
 *     under-retention, is the accepted risk here.
 */
export const retentionCategoryEnum = pgEnum('retention_category', [
  'standard',
  'financial_72mo',
  'employment_72mo_placeholder',
]);

/**
 * Provisional role marker. Superseded by P1-06's real role/permission
 * tables (branch-scoped RBAC) — this is deliberately the minimal thing that
 * lets `user.role` exist and be queried today without inventing a
 * permissions model this task doesn't own.
 */
export const userRoleEnum = pgEnum('user_role', ['ADMIN', 'STAFF']);

// ============================================================================
// tenant — the root of the tenancy model. NOT itself `tenant_id`-scoped (it
// IS the tenant; a self-referential `tenant_id` FK to itself would be
// meaningless). Its RLS policy instead compares its own primary key `id` to
// the session's tenant context, so an authenticated tenant context can see
// its own account row and nothing else (name/plan/slug of other tenants is
// not enumerable through a scoped connection). The migrator/BYPASSRLS role
// (infra for this task; see drizzle/0001) is the only identity expected to
// read/write across all tenants (onboarding a new tenant, billing/plan
// admin tooling later).
// ============================================================================
export const tenant = pgTable(
  'tenant',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),

    // --- D-009 dormant plan/limit hooks. Semantics fixed now per D-009's
    // own required follow-up ("document each field's semantics ... so the
    // dormant columns aren't archaeology later"). No CHECK constraint, no
    // trigger, no application enforcement yet — enforcement is a single
    // future `checkLimit()` chokepoint, not ad hoc per-table logic.
    //
    // `plan`: pricing-tier identifier (e.g. 'trial' | 'starter' | 'growth' |
    //   'enterprise'). Free text, not an FK — there is no `plans` catalog
    //   table yet; validated at the app layer if/when it matters.
    // `branch_limit`: max number of *active* (deleted_at IS NULL) rows in
    //   the future `branch` table (P1-06) this tenant may hold concurrently.
    //   A tombstoned/soft-deleted branch does NOT count against the limit —
    //   deleting one immediately frees the slot. `branch_limit` gates
    //   concurrent operating footprint, not lifetime branch-creation count.
    // `seat_limit`: max number of *active* (deleted_at IS NULL) rows in this
    //   `user` table for the tenant. One "seat" == one login-capable user
    //   account row (one admin or one staff login identity) — NOT a
    //   distinct human (one person with two accounts occupies two seats;
    //   nothing here prevents or detects that), NOT a device, and NOT a
    //   concurrent `session` (a single user can hold many sessions without
    //   consuming extra seats — session count is unrelated to seat
    //   counting). A terminated/soft-deleted user frees their seat
    //   immediately (deleted_at IS NOT NULL excludes them from the count).
    plan: text('plan').notNull().default('trial'),
    branchLimit: integer('branch_limit').notNull().default(1),
    seatLimit: integer('seat_limit').notNull().default(5),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    // --- D-008 soft-delete / retention. `deleted_at` NULL = active,
    // non-NULL = tombstoned. Never hard-delete: every tenant-scoped
    // financial/audit table added in later phases holds an FK to this row
    // and must stay queryable for its own statutory retention window even
    // after the tenant account itself is tombstoned (e.g. a churned
    // tenant's GST records still owe 72 months). `retention_category` is
    // 'standard' for the tenant row itself — the account/org record is not
    // itself a financial document; the financial records it owns carry
    // their own 'financial_72mo' category independently once Phase 2 lands,
    // regardless of this row's tombstone state.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    retentionCategory: retentionCategoryEnum('retention_category').notNull().default('standard'),
    // Set by the application layer (no purge job exists yet) at the moment
    // `deleted_at` is set, to `deleted_at + <category's floor>`. Present now
    // so a future purge job has one indexed column to query instead of
    // recomputing the floor from `retention_category` on every run.
    retainUntil: timestamp('retain_until', { withTimezone: true }),
  },
  (table) => [
    // Slug uniqueness is global (used for tenant lookup/routing before a
    // tenant context exists, e.g. subdomain resolution at login) — not
    // partial-on-deleted_at, deliberately: a tombstoned tenant's slug stays
    // reserved rather than becoming reusable, to avoid a new tenant
    // accidentally inheriting a churned tenant's old subdomain/links.
    uniqueIndex('tenant_slug_unique_idx').on(table.slug),
    pgPolicy('tenant_self_access', {
      for: 'all',
      to: 'public',
      using: sql`${table.id} = NULLIF(current_setting('app.current_tenant', true), '')::uuid`,
      withCheck: sql`${table.id} = NULLIF(current_setting('app.current_tenant', true), '')::uuid`,
    }),
  ],
).enableRLS();

// ============================================================================
// user — tenant admin/staff login identities. PII treatment per D-013:
// ordinary soft-delete + retention, explicitly NOT a per-subject
// crypto-shred column (that's Phase-3 customer-PII scope, P1-13).
// ============================================================================
export const user = pgTable(
  'user',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),

    // PII (D-013: employment-necessity basis, DPDP §7/§12(3)/§8(7) —
    // ordinary retention treatment, no crypto-shred machinery).
    email: text('email').notNull(),
    name: text('name').notNull(),

    // Real hashing algorithm (argon2id/bcrypt) is chosen and wired in P1-04
    // (real auth) — this column exists now so the table shape is final;
    // never store a plaintext password or a reversible encoding here.
    passwordHash: text('password_hash').notNull(),

    // Provisional — P1-06 replaces this with real branch-scoped role/
    // permission tables. Kept minimal on purpose.
    role: userRoleEnum('role').notNull().default('STAFF'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    // D-008 soft-delete + D-013 retention marker (see module doc above for
    // the 'employment_72mo_placeholder' rationale).
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    retentionCategory: retentionCategoryEnum('retention_category')
      .notNull()
      .default('employment_72mo_placeholder'),
    retainUntil: timestamp('retain_until', { withTimezone: true }),
  },
  (table) => [
    index('user_tenant_id_idx').on(table.tenantId),
    // Partial + case-insensitive: uniqueness is scoped per tenant (the same
    // email may exist as a different login identity in a different tenant —
    // this is not a single-sign-on system) and only enforced among *active*
    // rows, so a departed employee's email can be reissued to a new hire
    // without fighting a uniqueness constraint held by a tombstoned row.
    uniqueIndex('user_tenant_email_active_unique_idx')
      .on(table.tenantId, sql`lower(${table.email})`)
      .where(sql`${table.deletedAt} IS NULL`),
    pgPolicy('user_tenant_isolation', {
      for: 'all',
      to: 'public',
      using: tenantIsolation(table),
      withCheck: tenantIsolation(table),
    }),
  ],
).enableRLS();

// ============================================================================
// session — auth session/token records. Tenant-scoped like any other child
// table; NOT the RLS context middleware itself (P1-02) and NOT the auth
// implementation (P1-04) — just the storage shape.
// ============================================================================
export const session = pgTable(
  'session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),

    // Store only a hash of the bearer token, never the raw token — same
    // discipline as `password_hash`. Hashing scheme is P1-04's concern.
    tokenHash: text('token_hash').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    // This table's tombstone-equivalent field, named for what it means
    // operationally (a logout / forced revoke) rather than a generic
    // `deleted_at` — but it plays the identical "soft-delete marker" role
    // D-008 asks of every tenant-scoped table in this task's scope.
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    // 'standard': sessions are operational/security-log-adjacent, not
    // financial or employment records — no statutory floor applies. Kept
    // non-hard-deletable anyway per this task's blanket soft-delete rule, on
    // the grounds that a revoked-session row has real incident-forensics
    // value, not because a law requires it.
    retentionCategory: retentionCategoryEnum('retention_category').notNull().default('standard'),
    retainUntil: timestamp('retain_until', { withTimezone: true }),
  },
  (table) => [
    index('session_tenant_id_idx').on(table.tenantId),
    index('session_user_id_idx').on(table.userId),
    uniqueIndex('session_token_hash_unique_idx').on(table.tokenHash),
    pgPolicy('session_tenant_isolation', {
      for: 'all',
      to: 'public',
      using: tenantIsolation(table),
      withCheck: tenantIsolation(table),
    }),
  ],
).enableRLS();

// ============================================================================
// audit_log — append-only. No `deleted_at`/`updated_at`/retention marker:
// this task's scope note is explicit that audit_log needs no soft-delete
// ("you can't un-audit"). Immutability is enforced two ways: (1) RLS policy
// below, and (2) the runtime role is granted SELECT/INSERT only — no UPDATE
// or DELETE grant at all (drizzle/0001_force_rls_and_grants.sql) — so even a
// future application bug that tried to UPDATE/DELETE a row would be refused
// at the privilege layer before RLS is even evaluated. This is a genuine
// design decision beyond what D-008/D-009 already specified; logged in
// DECISIONS_LOG.md as part of this task's schema-design entry.
// ============================================================================
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    // Nullable: system/background actions (e.g. a future purge job) have no
    // human actor. Never dangles despite being a plain FK with no cascade
    // rule — actor rows are soft-deleted, never hard-deleted (D-008).
    actorUserId: uuid('actor_user_id').references(() => user.id),
    // e.g. 'user.create', 'user.update', 'session.create', 'session.revoke',
    // 'inventory.edit' (future). Free text, not an enum — the action
    // vocabulary will grow with every module and an enum would need a
    // migration per new action name.
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    beforeData: jsonb('before_data'),
    afterData: jsonb('after_data'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_log_tenant_id_idx').on(table.tenantId),
    index('audit_log_entity_idx').on(table.entityType, table.entityId),
    pgPolicy('audit_log_tenant_isolation', {
      for: 'all',
      to: 'public',
      using: tenantIsolation(table),
      withCheck: tenantIsolation(table),
    }),
  ],
).enableRLS();
