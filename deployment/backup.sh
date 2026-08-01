#!/bin/sh
# Integration Task 6, round 3 — scheduled pg_dump from the compose stack.
# Runs as its own long-lived `backup` compose service (see
# docker-compose.yml): loops forever, dumping on an interval, retaining the
# most recent N dumps in a bind-mounted host directory (`./backups`, so
# dumps survive `docker compose down -v` destroying the Postgres volume --
# the whole point of a backup is that it does NOT live inside the thing it's
# backing up).
set -e

: "${PGHOST:=postgres}"
: "${PGPORT:=5432}"
: "${PGDATABASE:=grovyn}"
: "${BACKUP_INTERVAL_SECONDS:=86400}"
: "${BACKUP_RETAIN_COUNT:=14}"
: "${BACKUP_DIR:=/backups}"

export PGPASSWORD="$GROVYN_MIGRATOR_PASSWORD"

mkdir -p "$BACKUP_DIR"

echo "Backup service started. Interval: ${BACKUP_INTERVAL_SECONDS}s, retaining last ${BACKUP_RETAIN_COUNT} dumps in ${BACKUP_DIR}."

while true; do
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  dest="${BACKUP_DIR}/grovyn_${stamp}.dump"
  echo "[$(date -u -Iseconds)] Starting backup -> $dest"
  # -Fc (custom format): compressed, and the only format `pg_restore` can
  # selectively restore from / restore into a differently-named database --
  # a plain SQL dump would hardcode the source database name.
  if pg_dump -h "$PGHOST" -p "$PGPORT" -U grovyn_migrator -d "$PGDATABASE" -Fc -f "$dest"; then
    echo "[$(date -u -Iseconds)] Backup complete: $(ls -lh "$dest" | awk '{print $5}')"
  else
    echo "[$(date -u -Iseconds)] Backup FAILED for $dest" >&2
    rm -f "$dest"
  fi

  # Retain only the most recent N dumps.
  ls -1t "${BACKUP_DIR}"/grovyn_*.dump 2>/dev/null | tail -n +$((BACKUP_RETAIN_COUNT + 1)) | while read -r old; do
    echo "Pruning old backup: $old"
    rm -f "$old"
  done

  sleep "$BACKUP_INTERVAL_SECONDS"
done
