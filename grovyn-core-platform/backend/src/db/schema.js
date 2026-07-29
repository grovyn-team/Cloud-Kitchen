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
  numeric,
  date,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  unique,
  foreignKey,
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

/**
 * Phase 2/3/3.5/6 enums (Sales, Inventory, Notifications). No new retention
 * enum is added — Phase-2 financial tables (`sale`, `saleLineItem`,
 * `taxPeriodSummary`) reuse `retentionCategoryEnum` above (`financial_72mo`)
 * per D-014's stated design intent, not a parallel enum.
 */
export const saleSourceEnum = pgEnum('sale_source', ['manual', 'csv_import', 'excel_import']);

// Nullable on `sale` (see below) rather than notNull-with-a-default: many
// real CSV/POS exports don't cleanly break out a single payment method per
// sale (split/mixed tenders, missing column) and forcing a fake default
// (e.g. 'cash') into a financial record misrepresents real reconciliation
// data. Better to record "unknown" as NULL than a wrong guess.
export const paymentMethodEnum = pgEnum('payment_method', [
  'cash',
  'card',
  'upi',
  'netbanking',
  'other',
  'mixed',
]);

export const inventoryMovementTypeEnum = pgEnum('inventory_movement_type', [
  'sale_deduction',
  'manual_adjustment',
  'excel_import',
  'restock',
  'correction',
]);

export const notificationTypeEnum = pgEnum('notification_type', [
  'low_stock',
  'inventory_request',
  'anomaly',
  'other',
]);

export const notificationStatusEnum = pgEnum('notification_status', [
  'unread',
  'read',
  'resolved',
]);

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
    // Slug uniqueness is global, deliberately not partial-on-deleted_at: a
    // tombstoned tenant's slug stays reserved rather than becoming reusable,
    // to avoid a new tenant accidentally inheriting a churned tenant's old
    // subdomain/links.
    //
    // NOTE ON PRE-CONTEXT LOOKUP (corrected 2026-07-29, D-015 /
    // CRITIQUE 016 §C.1): this column is used for tenant lookup/routing
    // before a tenant context exists (subdomain/slug resolution at login) —
    // but NOT via a direct `SELECT ... FROM tenant WHERE slug = ...` under
    // this table's own RLS policy (`tenant_self_access`, below), which
    // requires `app.current_tenant` to already equal the row's `id` and
    // therefore returns zero rows pre-context by construction (this is
    // correct isolation, not a bug). The actual pre-context read path is the
    // `SECURITY DEFINER` function `resolve_tenant_by_slug(slug)`
    // (`drizzle/0002_pre_context_auth_resolvers.sql`), which runs as the
    // migration owner (BYPASSRLS) and is the only thing `grovyn_app` is
    // granted `EXECUTE` on for this purpose. Do not assume a plain scoped
    // query against this table can resolve a tenant by slug — it cannot.
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

// ============================================================================
// branch — P1-04 added this table ONLY as the minimal FK target
// `staff_branch_access` needs to function. This task (schema for Phases
// 2/3/3.5/6) extends it with the real branch-CRUD fields P1-06's own
// description calls for (address/hours/contact), since every module below
// (Sales/Inventory/Customers/Notifications) is branch-scoped and a branch
// picker/detail view needs more than a bare name. All new fields are
// nullable free text — no structured hours model (open/close per weekday
// etc.) is built here; `openingHours` is a single display string an admin
// edits directly, deliberately minimal per this task's scope (a real
// structured hours model, if ever needed, is P1-06's call, not invented
// here as a side effect of Sales/Inventory schema work). No new timezone
// default is hardcoded India-specific here on purpose — P35-02 already
// flags hardcoded India constants as a problem to fix, and D-007's
// jurisdiction seam is a tax-module concern; don't add a second India
// assumption at the schema layer while those are still being resolved.
//
// Real role/permission tables (replacing `user.role`'s provisional enum,
// also nominally P1-06's job) are DELIBERATELY NOT added in this task: none
// of the Phase 2/3/3.5/6 functional requirements this task covers
// (Sales/Inventory/Customers/Notifications/Tax, per `PROJECT_BRIEF.md` §2-3)
// need finer-grained access control than the existing ADMIN/STAFF
// distinction + branch scoping already built in P1-04
// (`requireRole`/`requireBranchAccess`) — every module in scope here only
// differentiates "Admin, all branches" vs. "Staff, their assigned branch."
// Building a permission table now would be speculative schema with no
// consumer. Left to P1-06 to build when/if a real requirement demands it.
// ============================================================================
export const branch = pgTable(
  'branch',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    name: text('name').notNull(),

    // --- P2/P3/P3.5/P6 extension: real branch detail fields. All nullable —
    // a branch can be created with just a name and filled in later.
    address: text('address'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),
    phone: text('phone'),
    // Free-form display string (e.g. "Mon-Sat 09:00-22:00, Sun closed") —
    // see module doc above for why this isn't a structured per-weekday model.
    openingHours: text('opening_hours'),
    // IANA tz name (e.g. 'Asia/Kolkata'). Nullable, no schema-level default —
    // see module doc above.
    timezone: text('timezone'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    // D-008 soft-delete + retention marker, same shape as every other
    // tenant-scoped table here. A tombstoned branch stays FK-valid for
    // historical `staff_branch_access`/sales/inventory rows that reference it
    // (P1-06+) — never hard-deleted.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    retentionCategory: retentionCategoryEnum('retention_category').notNull().default('standard'),
    retainUntil: timestamp('retain_until', { withTimezone: true }),
  },
  (table) => [
    index('branch_tenant_id_idx').on(table.tenantId),
    pgPolicy('branch_tenant_isolation', {
      for: 'all',
      to: 'public',
      using: tenantIsolation(table),
      withCheck: tenantIsolation(table),
    }),
  ],
).enableRLS();

// ============================================================================
// staff_branch_access — P1-04's branch-scope grant table. A row means "this
// user may act within this branch"; ADMIN role is exempt at the application
// layer (an ADMIN implicitly has all-branch access within their own tenant,
// mirroring the pre-DB template's `storeIds = all stores for ADMIN`
// behavior) — this table only ever holds grants for STAFF. Soft-revoke, not
// hard-delete (D-008/D-013 pattern): removing a staff member's access to a
// branch sets `revoked_at`, it never deletes the row, so "who could access
// branch X on date Y" stays reconstructable for audit/forensics.
// ============================================================================
export const staffBranchAccess = pgTable(
  'staff_branch_access',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // This table's tombstone-equivalent field, named like `session.revoked_at`
    // for the same reason: "revoked" is what removing a grant operationally
    // means, not a generic soft-delete of a data row.
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    retentionCategory: retentionCategoryEnum('retention_category').notNull().default('standard'),
    retainUntil: timestamp('retain_until', { withTimezone: true }),
  },
  (table) => [
    index('staff_branch_access_tenant_id_idx').on(table.tenantId),
    index('staff_branch_access_user_id_idx').on(table.userId),
    index('staff_branch_access_branch_id_idx').on(table.branchId),
    // Partial unique: a user can only hold ONE *active* grant for a given
    // branch at a time (prevents duplicate-active-grant bookkeeping drift);
    // a revoked grant does not block re-granting the same user/branch pair
    // later (a new row is inserted, the old one stays as history).
    uniqueIndex('staff_branch_access_active_unique_idx')
      .on(table.userId, table.branchId)
      .where(sql`${table.revokedAt} IS NULL`),
    pgPolicy('staff_branch_access_tenant_isolation', {
      for: 'all',
      to: 'public',
      using: tenantIsolation(table),
      withCheck: tenantIsolation(table),
    }),
  ],
).enableRLS();

// ============================================================================
// PHASE 2/3/3.5/6 — Sales, Inventory, Customers, Notifications, Tax(GST).
// One combined migration per this task's explicit fast-mode directive
// (normally staged module-by-module). All tables below follow the identical
// pattern established by P1-01/P1-04 above: non-null indexed `tenant_id`,
// `tenantIsolation()` RLS policy with explicit `using`+`withCheck`,
// `.enableRLS()`, D-008 soft-delete (`deleted_at`/`retain_until`) unless
// explicitly called out as append-only (mirrors `audit_log`'s exception).
// FORCE ROW LEVEL SECURITY + GRANT (no DELETE, ever) for every table below
// lands in the hand-written companion migration, same split as
// 0001/0004 — Drizzle has no DSL for either statement.
// ============================================================================

// ============================================================================
// sale — order/sale header. Money/aggregate fields (`subtotal`, `taxAmount`,
// `totalAmount`) are a deliberate denormalized cache computed once at
// write-time from `saleLineItem` rows in the SAME transaction (backend-
// developer's job, P2-02) rather than summed on every dashboard read — this
// is what makes the `(tenant_id, branch_id, sale_date)` rollup index
// actually cheap for P2-03's revenue rollups. `saleDate` (the business/
// transaction date, used for rollups) is deliberately separate from
// `createdAt` (when the row was written) — an admin importing last month's
// CSV writes rows today with a `saleDate` in the past.
// `retentionCategory` defaults to 'financial_72mo' (D-008 — sales are
// explicitly named as 72-month-floor financial records in
// `PROJECT_BRIEF.md` §5.6), overriding the table-generic 'standard' default
// the same way `user` overrides it to 'employment_72mo_placeholder'.
// ============================================================================
export const sale = pgTable(
  'sale',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),

    saleDate: date('sale_date').notNull(),
    source: saleSourceEnum('source').notNull().default('manual'),
    // Free-form grouping id for a single CSV/Excel upload run (e.g. a
    // client-generated UUID or "filename+timestamp") so a batch's rows can
    // be found/rolled back together. Not an FK — there is no `import_batch`
    // table; P2-02 owns the actual import/validate-before-commit mechanism.
    importBatchRef: text('import_batch_ref'),

    // Nullable — see paymentMethodEnum comment above for why this isn't
    // notNull-with-a-default.
    paymentMethod: paymentMethodEnum('payment_method'),

    subtotalAmount: numeric('subtotal_amount', { precision: 12, scale: 2 }).notNull(),
    taxAmount: numeric('tax_amount', { precision: 12, scale: 2 }).notNull(),
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull(),

    // Who entered/imported this sale. Nullable in principle (a future
    // system-generated correction) but expected to be set on every real
    // write; not enforced notNull to leave room for that case rather than
    // invent a synthetic system-user row.
    createdByUserId: uuid('created_by_user_id').references(() => user.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    // D-008 soft-delete. Voiding/correcting a sale sets `deleted_at` (never
    // a real row delete, never an in-place total/line edit) — the "why" of
    // a void belongs in `audit_log`, not a dedicated column here, to avoid
    // duplicating audit_log's job.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    retentionCategory: retentionCategoryEnum('retention_category')
      .notNull()
      .default('financial_72mo'),
    retainUntil: timestamp('retain_until', { withTimezone: true }),
  },
  (table) => [
    index('sale_tenant_id_idx').on(table.tenantId),
    // The composite this task's board note (P2-01) explicitly calls for:
    // branch-scoped rollups (staff's own branch, or an admin drilling into
    // one branch).
    index('sale_tenant_branch_date_idx').on(table.tenantId, table.branchId, table.saleDate),
    // Cross-branch admin rollup (DBA guardrail example: "Admin dashboard
    // aggregates across all branches for a tenant") — a query with no
    // branch filter still hits an index on the leading (tenant_id,
    // sale_date) prefix instead of a full scan.
    index('sale_tenant_date_idx').on(table.tenantId, table.saleDate),
    // Composite-FK hardening (decision-critic verdict, 2026-07-29): lets
    // `sale_line_item` FK against `(sale_id, tenant_id)` instead of just
    // `sale_id`, so a child row's own `tenant_id` is verified equal to its
    // parent sale's actual `tenant_id` AT INSERT TIME by the FK constraint
    // itself — not just by RLS (which a BYPASSRLS connection ignores
    // entirely, and which never re-validates FK targets on write). `id`
    // alone is already unique (PK); this composite unique is redundant with
    // that in the single-column sense but is what Postgres requires as the
    // referenced side of a composite FK.
    unique('sale_id_tenant_id_unique').on(table.id, table.tenantId),
    pgPolicy('sale_tenant_isolation', {
      for: 'all',
      to: 'public',
      using: tenantIsolation(table),
      withCheck: tenantIsolation(table),
    }),
  ],
).enableRLS();

// ============================================================================
// sale_line_item — line items for a `sale`. Carries its OWN `tenant_id`
// (denormalized, not just reachable via a `sale_id` join) because RLS
// policies are evaluated per-table against that table's own columns — a
// child table with no `tenant_id` of its own cannot be isolated by RLS
// without a subquery-based policy (slower, and not the pattern this schema
// uses anywhere else). This mirrors why `session`/`staff_branch_access`
// above also carry `tenant_id` despite already having a `user_id`/`sale_id`
// FK to a table that has one.
// `inventoryItemId` is nullable: a line can reference a real catalog
// `inventory_item` (enables the "auto-adjusts from sales" inventory
// requirement below) OR be free-text-only for an ad-hoc/uncatalogued item
// entered manually — matches the module's "manual entry" flexibility.
// ============================================================================
export const saleLineItem = pgTable(
  'sale_line_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    // No single-column `.references(() => sale.id)` here — the composite FK
    // below (`sale_line_item_sale_id_tenant_id_fk`) covers referential
    // integrity for this column AND cross-checks it against `tenant_id` in
    // the same constraint (composite-FK hardening, decision-critic
    // verdict, 2026-07-29).
    saleId: uuid('sale_id').notNull(),
    inventoryItemId: uuid('inventory_item_id').references(() => inventoryItem.id),

    itemName: text('item_name').notNull(),
    sku: text('sku'),
    quantity: numeric('quantity', { precision: 12, scale: 3 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
    lineSubtotal: numeric('line_subtotal', { precision: 12, scale: 2 }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    // Same D-008 shape as every other soft-delete table in this task
    // (blanket rule) even though in practice a correction is expected to
    // void the parent `sale` header rather than edit an individual line —
    // present for consistency/future-proofing, not because line-level
    // editing is the intended correction path.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    retentionCategory: retentionCategoryEnum('retention_category')
      .notNull()
      .default('financial_72mo'),
    retainUntil: timestamp('retain_until', { withTimezone: true }),
  },
  (table) => [
    index('sale_line_item_tenant_id_idx').on(table.tenantId),
    index('sale_line_item_sale_id_idx').on(table.saleId),
    index('sale_line_item_inventory_item_id_idx').on(table.inventoryItemId),
    // Composite-FK hardening (decision-critic verdict, 2026-07-29): rejects
    // an insert/update where `sale_id` points at a real `sale` row but that
    // row's `tenant_id` doesn't match this row's own `tenant_id` — closes
    // the gap where a mismatched-tenant child row could otherwise be
    // written under a BYPASSRLS connection (RLS never re-validates FK
    // targets) or by any future code path that skips the DAL.
    foreignKey({
      columns: [table.saleId, table.tenantId],
      foreignColumns: [sale.id, sale.tenantId],
      name: 'sale_line_item_sale_id_tenant_id_fk',
    }),
    pgPolicy('sale_line_item_tenant_isolation', {
      for: 'all',
      to: 'public',
      using: tenantIsolation(table),
      withCheck: tenantIsolation(table),
    }),
  ],
).enableRLS();

// ============================================================================
// inventory_item — branch-scoped catalog + current stock level. Catalog
// metadata (name/unit/threshold), not itself a financial-statute record —
// `retentionCategory` stays 'standard' (the table-generic default), unlike
// `inventory_movement` below which IS the actual financial-adjacent event
// stream (`PROJECT_BRIEF.md` §5.6 names "inventory movements" alongside
// sales/tax/audit as 72-month-floor records — the movement log, not the
// catalog row, is what that applies to).
// `lowStockThreshold` exists to support a future notification trigger
// (P2-06/notification module) — no trigger/job is built here, just the
// field it reads.
// `costPerUnit` exists so P2-06 (margin/COGS tiles) doesn't need a second
// schema cycle — nullable because a newly added item may not have a cost
// yet.
// ============================================================================
export const inventoryItem = pgTable(
  'inventory_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),

    name: text('name').notNull(),
    sku: text('sku'),
    unit: text('unit').notNull(),
    currentStock: numeric('current_stock', { precision: 12, scale: 3 }).notNull().default('0'),
    lowStockThreshold: numeric('low_stock_threshold', { precision: 12, scale: 3 }),
    costPerUnit: numeric('cost_per_unit', { precision: 12, scale: 2 }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    retentionCategory: retentionCategoryEnum('retention_category').notNull().default('standard'),
    retainUntil: timestamp('retain_until', { withTimezone: true }),
  },
  (table) => [
    index('inventory_item_tenant_id_idx').on(table.tenantId),
    index('inventory_item_tenant_branch_idx').on(table.tenantId, table.branchId),
    // Composite-FK hardening (decision-critic verdict, 2026-07-29) — same
    // rationale as `sale`'s `sale_id_tenant_id_unique` above: lets
    // `inventory_movement` FK against `(item_id, tenant_id)`.
    unique('inventory_item_id_tenant_id_unique').on(table.id, table.tenantId),
    pgPolicy('inventory_item_tenant_isolation', {
      for: 'all',
      to: 'public',
      using: tenantIsolation(table),
      withCheck: tenantIsolation(table),
    }),
  ],
).enableRLS();

// ============================================================================
// inventory_movement — append-only adjustment/movement log, explicitly
// modeled on `audit_log` above per this task's own instructions ("append-
// only similar to audit_log"): NO `deleted_at`/`updated_at`/retention
// marker (you can't un-log a stock movement any more than you can un-audit
// an action), immutability enforced at the GRANT layer (SELECT/INSERT
// only, no UPDATE/DELETE — see the companion migration) exactly like
// `audit_log`. `quantityDelta` is signed (negative = deduction, e.g. a
// sale; positive = addition, e.g. restock); `resultingStock` snapshots the
// item's `current_stock` immediately after this movement so history is
// reconstructable without replaying every prior row.
// `actorUserId` is nullable for the same reason `audit_log.actor_user_id`
// is: a `sale_deduction` movement is system-triggered by a sale write, not
// a human editing inventory directly.
// FORWARD NOTE (not built here): `PROJECT_BRIEF.md` §5.6 names inventory
// movements as 72-month-floor financial records, but because this table has
// no `deleted_at` (append-only, matching audit_log), the D-008
// `retain_until`-driven soft-delete purge chokepoint doesn't apply to it —
// a future purge mechanism for this table (if one is ever built) will need
// a different shape (e.g. time-boxed archival by `created_at`), same as
// `audit_log` itself would. Flagging, not solving, here.
// ============================================================================
export const inventoryMovement = pgTable(
  'inventory_movement',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    // No single-column `.references(() => inventoryItem.id)` here — the
    // composite FK below (`inventory_movement_item_id_tenant_id_fk`) covers
    // referential integrity for this column AND cross-checks it against
    // `tenant_id` in the same constraint (composite-FK hardening,
    // decision-critic verdict, 2026-07-29).
    itemId: uuid('item_id').notNull(),

    movementType: inventoryMovementTypeEnum('movement_type').notNull(),
    quantityDelta: numeric('quantity_delta', { precision: 12, scale: 3 }).notNull(),
    resultingStock: numeric('resulting_stock', { precision: 12, scale: 3 }).notNull(),
    reason: text('reason'),

    actorUserId: uuid('actor_user_id').references(() => user.id),
    // Set when `movementType = 'sale_deduction'`, linking the movement back
    // to the sale that caused it. Nullable for every other movement type.
    relatedSaleId: uuid('related_sale_id').references(() => sale.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('inventory_movement_tenant_branch_idx').on(table.tenantId, table.branchId),
    index('inventory_movement_tenant_item_idx').on(table.tenantId, table.itemId),
    // Composite-FK hardening (decision-critic verdict, 2026-07-29) — same
    // rationale as `sale_line_item`'s composite FK above.
    foreignKey({
      columns: [table.itemId, table.tenantId],
      foreignColumns: [inventoryItem.id, inventoryItem.tenantId],
      name: 'inventory_movement_item_id_tenant_id_fk',
    }),
    pgPolicy('inventory_movement_tenant_isolation', {
      for: 'all',
      to: 'public',
      using: tenantIsolation(table),
      withCheck: tenantIsolation(table),
    }),
  ],
).enableRLS();

// ============================================================================
// customer — branch-scoped customer record. `category`/`rating` per
// `PROJECT_BRIEF.md` §3 ("category/segment, rating"). `category` is free
// text, not an enum: tenant-defined segments (e.g. "VIP", "corporate",
// "walk-in") shouldn't require a schema migration to add one.
//
// PII SCOPE NOTE (explicit, per this task's own instructions — do not treat
// as resolved): `name`/`phone`/`email` below are customer PII. This table
// gets ONLY the ordinary D-008 soft-delete + retention shape every other
// table here gets — it deliberately does NOT implement D-008/D-013's
// planned master-vs-invoice-snapshot split or crypto-shred erasure design.
// That design is explicitly P1-13's job (Backlog, DBA+Security owned) and
// is a **prerequisite gate before this table can be considered erasure-
// compliant** — flagged to security-engineer per this task's own
// instructions, not resolved here.
// ============================================================================
export const customer = pgTable(
  'customer',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),

    name: text('name').notNull(),
    phone: text('phone'),
    email: text('email'),
    category: text('category'),
    // 1-5 star-style rating. Integer, not numeric — no fractional-star
    // requirement surfaced anywhere in the brief.
    rating: integer('rating'),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    retentionCategory: retentionCategoryEnum('retention_category').notNull().default('standard'),
    retainUntil: timestamp('retain_until', { withTimezone: true }),
  },
  (table) => [
    index('customer_tenant_id_idx').on(table.tenantId),
    index('customer_tenant_branch_idx').on(table.tenantId, table.branchId),
    index('customer_tenant_branch_category_idx').on(
      table.tenantId,
      table.branchId,
      table.category,
    ),
    pgPolicy('customer_tenant_isolation', {
      for: 'all',
      to: 'public',
      using: tenantIsolation(table),
      withCheck: tenantIsolation(table),
    }),
  ],
).enableRLS();

// ============================================================================
// notification — staff -> admin request/alert feed (low-stock triggers,
// inventory requests, anomalies; `PROJECT_BRIEF.md` §3). Branch-scoped
// (`branch_id` notNull) per this task's explicit instruction. `actorUserId`
// is nullable for system-triggered notifications (e.g. an automated
// low-stock crossing has no human actor, same reasoning as
// `audit_log.actor_user_id`/`inventory_movement.actor_user_id`).
// `relatedEntityType`/`relatedEntityId` is a loosely-typed polymorphic
// reference (not an FK — the related entity's table varies by
// `type`, e.g. an `inventory_item` id for `low_stock`/`inventory_request`)
// — same shape as `audit_log.entity_type`/`entity_id`, named
// `relatedEntity*` instead of reusing `entity*` verbatim because this table
// isn't itself a log of an action ON an entity, it's a message ABOUT one;
// kept the field pair conceptually identical to audit_log's on purpose.
// ============================================================================
export const notification = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),

    type: notificationTypeEnum('type').notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),

    actorUserId: uuid('actor_user_id').references(() => user.id),
    relatedEntityType: text('related_entity_type'),
    relatedEntityId: uuid('related_entity_id'),

    status: notificationStatusEnum('status').notNull().default('unread'),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => user.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    retentionCategory: retentionCategoryEnum('retention_category').notNull().default('standard'),
    retainUntil: timestamp('retain_until', { withTimezone: true }),
  },
  (table) => [
    index('notification_tenant_id_idx').on(table.tenantId),
    index('notification_tenant_branch_status_idx').on(
      table.tenantId,
      table.branchId,
      table.status,
    ),
    // Admin's cross-branch notification feed (no branch filter) — leading
    // (tenant_id, status) prefix serves that without a full scan.
    index('notification_tenant_status_idx').on(table.tenantId, table.status),
    pgPolicy('notification_tenant_isolation', {
      for: 'all',
      to: 'public',
      using: tenantIsolation(table),
      withCheck: tenantIsolation(table),
    }),
  ],
).enableRLS();

// ============================================================================
// tax_period_summary — Phase 6 GST module (D-007: India GST only, CA-in-
// the-loop; "prepares and reconciles data for the client's CA", NOT a
// filing tool). Deliberately ONE table, not two: this task's brief asks for
// "a period summary table ... and an exportable breakdown" — a summary
// already broken down by (branch, period, gst_rate) IS the exportable
// breakdown when queried; a second table would duplicate the first one's
// rows under a different name. Rows are computed FROM `sale`/`sale_line_item`
// data (that computation is a backend-developer job, not built here) — this
// table is a cache of that computation, not a source of truth.
// One row per (tenant, branch, period, gst_rate); the partial unique index
// below prevents a recompute from silently duplicating a row instead of
// updating it.
// ============================================================================
export const taxPeriodSummary = pgTable(
  'tax_period_summary',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),

    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    // GST slab percentage this row summarizes (e.g. 5.00, 12.00, 18.00).
    gstRate: numeric('gst_rate', { precision: 5, scale: 2 }).notNull(),

    taxableAmount: numeric('taxable_amount', { precision: 14, scale: 2 }).notNull(),
    taxAmount: numeric('tax_amount', { precision: 14, scale: 2 }).notNull(),
    saleCount: integer('sale_count'),

    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    retentionCategory: retentionCategoryEnum('retention_category')
      .notNull()
      .default('financial_72mo'),
    retainUntil: timestamp('retain_until', { withTimezone: true }),
  },
  (table) => [
    index('tax_period_summary_tenant_id_idx').on(table.tenantId),
    index('tax_period_summary_tenant_branch_period_idx').on(
      table.tenantId,
      table.branchId,
      table.periodStart,
      table.periodEnd,
    ),
    uniqueIndex('tax_period_summary_active_unique_idx')
      .on(table.tenantId, table.branchId, table.periodStart, table.periodEnd, table.gstRate)
      .where(sql`${table.deletedAt} IS NULL`),
    pgPolicy('tax_period_summary_tenant_isolation', {
      for: 'all',
      to: 'public',
      using: tenantIsolation(table),
      withCheck: tenantIsolation(table),
    }),
  ],
).enableRLS();
