#!/usr/bin/env bash
# Restore a dump into a target database. Usage: ./scripts/restore-db.sh backups/file.dump
# Rehearse this regularly against a scratch database: an untested backup is not a backup.
set -euo pipefail
pg_restore --host "${DB_HOST:-localhost}" --port "${DB_PORT:-5432}" --username "${DB_USER:?}" \
           --dbname "${DB_NAME:?}" --clean --if-exists --no-owner "${1:?dump file required}"
