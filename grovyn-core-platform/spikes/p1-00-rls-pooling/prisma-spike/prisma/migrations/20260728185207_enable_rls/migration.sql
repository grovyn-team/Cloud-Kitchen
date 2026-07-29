-- HAND-WRITTEN SQL: schema.prisma has no DSL for RLS (no ENABLE ROW LEVEL
-- SECURITY / CREATE POLICY / role grants). `prisma migrate dev --create-only`
-- produced a genuinely empty migration for this schema-unchanged diff; this
-- SQL was typed in manually to make RLS live. This is the gate-7 evidence.
ALTER TABLE "rls_test" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rls_test" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "rls_test"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

GRANT SELECT, INSERT ON "rls_test" TO grovyn_app;
GRANT USAGE, SELECT ON SEQUENCE "rls_test_id_seq" TO grovyn_app;