-- Applied per-database, AFTER the ORM's migration workflow has created the
-- `rls_test` table. This file exists to measure exactly how much (if any)
-- hand-written SQL each ORM's own workflow required beyond this point
-- (gate 7). Run identically against both rls_spike_prisma and rls_spike_drizzle
-- as a control -- the interesting empirical question is whether each ORM's
-- *own* migration tool could have produced this SQL itself.
ALTER TABLE rls_test ENABLE ROW LEVEL SECURITY;
ALTER TABLE rls_test FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON rls_test
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

GRANT SELECT, INSERT ON rls_test TO grovyn_app;
GRANT USAGE, SELECT ON SEQUENCE rls_test_id_seq TO grovyn_app;
