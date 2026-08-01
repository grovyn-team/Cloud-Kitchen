/**
 * Integration Task 4, round 3 — the missing seed step CI needs before
 * `tests/tenantContext.pgtest.mjs` and `tests/dal.pgtest.mjs` can run: both
 * suites' own doc comments say they expect "at least two seeded tenants +
 * one active user each... see the container setup this task's report
 * documents" -- but no such seed script was ever committed to the repo,
 * only described in an earlier phase's chat transcript. Every OTHER
 * *.pgtest.mjs suite self-seeds its own fixtures (a documented, deliberate
 * difference this task found while wiring CI, not invented here) -- these
 * two are the exception. Idempotent (`ON CONFLICT DO NOTHING` /
 * `WHERE NOT EXISTS`) so it's safe to run before every CI job even against
 * a database that already has this fixture data.
 *
 * Usage: DATABASE_MIGRATOR_URL=... node scripts/seed-pgtest-fixtures.mjs
 */

import pg from 'pg';

const MIGRATOR_URL = process.env.DATABASE_MIGRATOR_URL || process.env.DATABASE_URL;
if (!MIGRATOR_URL) {
  console.error('DATABASE_MIGRATOR_URL (or DATABASE_URL) must be set to the BYPASSRLS migrator connection.');
  process.exit(1);
}

const TENANT_A = process.env.PGTEST_TENANT_A || '11111111-1111-1111-1111-111111111111';
const TENANT_B = process.env.PGTEST_TENANT_B || '22222222-2222-2222-2222-222222222222';
const TENANT_A_EMAIL = process.env.PGTEST_TENANT_A_USER_EMAIL || 'admin@acme.example';
const TENANT_B_EMAIL = process.env.PGTEST_TENANT_B_USER_EMAIL || 'admin@beta.example';
// Not a real login fixture (these two suites never authenticate through
// `/auth/login`) -- a syntactically valid argon2id hash is enough to
// satisfy the `password_hash NOT NULL` column.
const PLACEHOLDER_HASH = '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const pool = new pg.Pool({ connectionString: MIGRATOR_URL, max: 1 });

async function seedTenant(id, slug, name, userEmail) {
  await pool.query(
    `INSERT INTO tenant (id, name, slug, branch_limit, seat_limit)
     VALUES ($1, $2, $3, 100, 100)
     ON CONFLICT (id) DO NOTHING`,
    [id, name, slug]
  );
  await pool.query(
    `INSERT INTO "user" (tenant_id, email, name, password_hash, role)
     SELECT $1, $2, $3, $4, 'ADMIN'
     WHERE NOT EXISTS (SELECT 1 FROM "user" WHERE tenant_id = $1 AND lower(email) = lower($2))`,
    [id, userEmail, `${name} Admin`, PLACEHOLDER_HASH]
  );
  await pool.query(
    `INSERT INTO tax_rate (tenant_id, rate_percent, effective_from, effective_to)
     SELECT $1, 5.00, DATE '2000-01-01', NULL
     WHERE NOT EXISTS (SELECT 1 FROM tax_rate WHERE tenant_id = $1 AND effective_to IS NULL)`,
    [id]
  );
}

try {
  await seedTenant(TENANT_A, 'pgtest-fixture-a', 'Acme', TENANT_A_EMAIL);
  await seedTenant(TENANT_B, 'pgtest-fixture-b', 'Beta', TENANT_B_EMAIL);
  console.log(`OK: seeded fixture tenants ${TENANT_A} (${TENANT_A_EMAIL}) and ${TENANT_B} (${TENANT_B_EMAIL}).`);
} finally {
  await pool.end();
}
