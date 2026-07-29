/**
 * drizzle-kit config — used only by the CLI (`npm run db:generate` /
 * `db:migrate`), never imported by application runtime code. Reuses the
 * pattern proven in `spikes/p1-00-rls-pooling/drizzle-spike/drizzle.config.ts`.
 *
 * `DATABASE_URL` here is the MIGRATOR connection (BYPASSRLS role, e.g.
 * `grovyn_migrator` — infra for this task only, see
 * `drizzle/0001_force_rls_and_grants.sql`), never the runtime `grovyn_app`
 * role. The per-request runtime connection/context is P1-02's concern, not
 * this file's.
 */
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.js',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_MIGRATOR_URL || process.env.DATABASE_URL,
  },
});
