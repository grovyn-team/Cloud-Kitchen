-- HAND-WRITTEN SQL, for parity with the Prisma spike: drizzle-orm's pg-core
-- has no DSL for FORCE ROW LEVEL SECURITY or table-level GRANT statements
-- (only ENABLE + CREATE POLICY were auto-generated in 0000). FORCE is optional
-- defense-in-depth here since grovyn_app is not the table owner (RLS already
-- applies to non-owner roles without FORCE) -- included anyway for parity with
-- the Prisma database's config.
ALTER TABLE "rls_test" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON "rls_test" TO grovyn_app;
GRANT USAGE, SELECT ON SEQUENCE "rls_test_id_seq" TO grovyn_app;