-- Deterministic seed: 5 tenants x 20 rows = 100 rows, identical uuids in both
-- databases so cross-database comparison is meaningful.
INSERT INTO rls_test (tenant_id, payload)
SELECT t.tenant_id, 'row ' || g
FROM (VALUES
  ('11111111-1111-1111-1111-111111111111'::uuid), -- tenant A
  ('22222222-2222-2222-2222-222222222222'::uuid), -- tenant B
  ('33333333-3333-3333-3333-333333333333'::uuid), -- tenant C
  ('44444444-4444-4444-4444-444444444444'::uuid), -- tenant D
  ('55555555-5555-5555-5555-555555555555'::uuid)  -- tenant E
) AS t(tenant_id)
CROSS JOIN generate_series(1, 20) AS g;
