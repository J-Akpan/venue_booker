#!/usr/bin/env bash
# Logical backup of the primary. Usage: DB_HOST=... DB_USER=... DB_NAME=... PGPASSWORD=... ./scripts/backup-db.sh
# Schedule nightly (cron / k8s CronJob) and ship $BACKUP_DIR to object storage with versioning + lifecycle rules.
# For point-in-time recovery also enable WAL archiving (or use your cloud's managed PITR); see docs/DESIGN.md.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/${DB_NAME:?DB_NAME required}-$STAMP.dump"

mkdir -p "$BACKUP_DIR"
pg_dump --host "${DB_HOST:-localhost}" --port "${DB_PORT:-5432}" --username "${DB_USER:?DB_USER required}" \
        --format=custom --no-owner "$DB_NAME" > "$FILE"
pg_restore --list "$FILE" > /dev/null          # fail loudly if the dump is unreadable
find "$BACKUP_DIR" -name '*.dump' -mtime +"$RETENTION_DAYS" -delete
echo "backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
