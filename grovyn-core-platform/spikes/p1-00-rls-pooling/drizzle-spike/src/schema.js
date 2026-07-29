import { sql } from 'drizzle-orm';
import { pgTable, serial, uuid, text, timestamp, pgPolicy } from 'drizzle-orm/pg-core';

// Native drizzle-orm RLS support (pgPolicy + enableRLS) -- no hand-written SQL
// needed to express ENABLE ROW LEVEL SECURITY / CREATE POLICY; drizzle-kit
// generates it from this schema. This is the gate-7 test for Drizzle.
export const rlsTest = pgTable(
  'rls_test',
  {
    id: serial('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    payload: text('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    pgPolicy('tenant_isolation', {
      for: 'all',
      to: 'public',
      using: sql`${table.tenantId} = NULLIF(current_setting('app.current_tenant', true), '')::uuid`,
    }),
  ],
).enableRLS();
