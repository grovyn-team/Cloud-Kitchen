-- Bootstrap: two isolated databases, one per ORM candidate, plus the shared
-- non-superuser app runtime role pattern (created per-database below since
-- roles are cluster-wide but grants are per-database).
CREATE DATABASE rls_spike_prisma;
CREATE DATABASE rls_spike_drizzle;

CREATE ROLE grovyn_app LOGIN PASSWORD 'app_runtime_pw' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
