/**
 * Integration Task 2, round 3 — operational check: reports any tenant with
 * no open-ended (`effective_to IS NULL`) `tax_rate` row, i.e. any tenant
 * whose NEXT sale would throw `NoGstRateConfiguredError`
 * (`gstRateService.js`) before it could even fail-closed at write time.
 *
 * DELIBERATELY NOT an HTTP endpoint on the running app -- this needs a
 * cross-tenant query, and the runtime pool (`src/db/pool.js`, `grovyn_app`)
 * is RLS-scoped to exactly ONE tenant per request by design (`tenant`'s own
 * `tenant_self_access` policy: `id = current_setting('app.current_tenant')`
 * -- a request literally cannot see any tenant but its own, even a public
 * unauthenticated one). A cross-tenant check requires the BYPASSRLS
 * migrator role, which the app server intentionally never holds at runtime
 * (SEC-P101-IR-03's "no runtime-to-migrator fallback, ever" guarantee) --
 * building this as a live health endpoint would mean either it silently
 * can't work (RLS confines it to one tenant) or granting the running
 * process migrator-level privilege, which is the exact regression this
 * codebase has been guarding against since Phase 1. This runs the same way
 * `drizzle-kit migrate`/CI (Integration Task 4, round 3) does: as
 * `grovyn_migrator`, on demand or from a deploy/CI step, never from the
 * request-serving process.
 *
 * Usage: DATABASE_MIGRATOR_URL=... node scripts/check-tenant-gst-rates.mjs
 * Exit 0 if every tenant has an open rate row, exit 1 (with the offending
 * tenant ids/names/slugs printed) otherwise -- wireable into CI/deploy as a
 * gate, same convention as this repo's other exit-code-driven scripts.
 */

import pg from 'pg';

const MIGRATOR_URL = process.env.DATABASE_MIGRATOR_URL || process.env.DATABASE_URL;
if (!MIGRATOR_URL) {
  console.error('DATABASE_MIGRATOR_URL (or DATABASE_URL) must be set to the BYPASSRLS migrator connection.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: MIGRATOR_URL, max: 1 });

try {
  const result = await pool.query(`
    SELECT t.id, t.name, t.slug
    FROM tenant t
    LEFT JOIN tax_rate tr ON tr.tenant_id = t.id AND tr.effective_to IS NULL
    WHERE t.deleted_at IS NULL AND tr.id IS NULL
    ORDER BY t.created_at
  `);

  if (result.rows.length === 0) {
    console.log('OK: every tenant has an open-ended GST rate row.');
    process.exit(0);
  }

  console.error(`FAIL: ${result.rows.length} tenant(s) have NO open-ended GST rate row (their next sale will fail closed):`);
  for (const row of result.rows) {
    console.error(`  - ${row.id}  ${row.slug}  "${row.name}"`);
  }
  process.exit(1);
} finally {
  await pool.end();
}
