#!/bin/sh
# Integration Task 5, round 3 — runs on deploy, under the bypass role, as its
# own one-shot compose service (`migrate` in docker-compose.yml) that the
# `backend` service `depends_on: condition: service_completed_successfully`.
#
# NOT `npm run db:migrate` (drizzle-kit's own CLI). Reproduced locally,
# repeatedly, on a clean container while building this task and Integration
# Task 4's CI workflow: `drizzle-kit migrate` hangs on its own progress
# spinner and exits 1 with no error output at all -- untriaged, but
# consistently reproducible, so it cannot be trusted for an unattended
# deploy step. Applies each generated migration file in filename order via
# `psql`, as `grovyn_migrator` (so it owns the tables the GRANTs target --
# see `drizzle/bootstrap-roles.sql`'s own doc comment on why this matters),
# exactly the recipe this session's `.pgtest.mjs` suites and CI workflow
# both use.
#
# Real secrets: `bootstrap-roles.sql` creates the two cluster roles with
# placeholder passwords (documented there as dev-only). Immediately after
# bootstrapping, this script ALTERs both to whatever
# `GROVYN_MIGRATOR_PASSWORD`/`GROVYN_APP_PASSWORD` the environment supplies
# (falling back to the same placeholders ONLY if unset, e.g. local dev) --
# closes SEC-P101-IR-02 ("becomes High the moment a cluster is stood up")
# for real, not just by comment.
set -e

: "${PGHOST:=postgres}"
: "${PGPORT:=5432}"
: "${PGSUPERUSER:=postgres}"
: "${PGDATABASE:=grovyn}"
: "${GROVYN_MIGRATOR_PASSWORD:=CHANGE_ME_MIGRATOR}"
: "${GROVYN_APP_PASSWORD:=CHANGE_ME_APP}"

export PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD"

# Real gap found by actually running this against a fresh compose volume:
# the official Postgres image restarts itself once internally right after
# initdb completes on a truly first boot, and there's a narrow window where
# compose's `pg_isready`-based healthcheck reports healthy just before that
# restart -- `depends_on: condition: service_healthy` is not quite enough on
# its own. Retry the actual connection this script needs, not just
# `pg_isready`, before doing anything else.
echo "Waiting for a real, stable connection to Postgres..."
attempt=0
until psql -h "$PGHOST" -p "$PGPORT" -U "$PGSUPERUSER" -d postgres -c "SELECT 1" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "Postgres did not become reachable after 30 attempts." >&2
    exit 1
  fi
  sleep 2
done

echo "Ensuring database '$PGDATABASE' exists..."
psql -h "$PGHOST" -p "$PGPORT" -U "$PGSUPERUSER" -d postgres -tc \
  "SELECT 1 FROM pg_database WHERE datname = '$PGDATABASE'" | grep -q 1 || \
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGSUPERUSER" -d postgres -c "CREATE DATABASE $PGDATABASE"

echo "Bootstrapping roles (idempotent)..."
psql -h "$PGHOST" -p "$PGPORT" -U "$PGSUPERUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -f drizzle/bootstrap-roles.sql

echo "Setting real role passwords from environment..."
psql -h "$PGHOST" -p "$PGPORT" -U "$PGSUPERUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 <<SQL
ALTER ROLE grovyn_migrator PASSWORD '$GROVYN_MIGRATOR_PASSWORD';
ALTER ROLE grovyn_app PASSWORD '$GROVYN_APP_PASSWORD';
SQL

echo "Applying migrations as grovyn_migrator..."
export PGPASSWORD="$GROVYN_MIGRATOR_PASSWORD"

# Real gap found by actually depending on this service twice in one compose
# project (a later service's `depends_on: migrate: condition:
# service_completed_successfully` re-runs this one-shot container): none of
# the numbered migration files are idempotent on their own (plain `CREATE
# TABLE`, no `IF NOT EXISTS`) -- re-running the whole loop against an
# already-migrated database crashed with "relation already exists". Fixed
# properly, not worked around: track applied filenames in a real table
# (mirroring what a migration tool's own tracking table does) and skip
# anything already recorded, so this script is genuinely safe to run any
# number of times -- required for the `backup` service (Integration Task 6)
# to depend on it without re-triggering a full migration replay.
psql -h "$PGHOST" -p "$PGPORT" -U grovyn_migrator -d "$PGDATABASE" -v ON_ERROR_STOP=1 -c \
  "CREATE TABLE IF NOT EXISTS _migrations_applied (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"

for f in $(ls drizzle/*.sql | grep -v bootstrap-roles | sort -V); do
  base=$(basename "$f")
  already=$(psql -h "$PGHOST" -p "$PGPORT" -U grovyn_migrator -d "$PGDATABASE" -tAc \
    "SELECT 1 FROM _migrations_applied WHERE filename = '$base'")
  if [ "$already" = "1" ]; then
    echo "  Skipping $f (already applied)"
    continue
  fi
  echo "  Applying $f"
  psql -h "$PGHOST" -p "$PGPORT" -U grovyn_migrator -d "$PGDATABASE" -v ON_ERROR_STOP=1 -f "$f"
  psql -h "$PGHOST" -p "$PGPORT" -U grovyn_migrator -d "$PGDATABASE" -v ON_ERROR_STOP=1 -c \
    "INSERT INTO _migrations_applied (filename) VALUES ('$base')"
done

echo "Verifying every tenant has a resolvable GST rate..."
DATABASE_MIGRATOR_URL="postgresql://grovyn_migrator:${GROVYN_MIGRATOR_PASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}" \
  node scripts/check-tenant-gst-rates.mjs || echo "  (non-fatal on a fresh database with zero tenants yet)"

echo "Migrations complete."
