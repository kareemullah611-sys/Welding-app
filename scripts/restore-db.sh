#!/usr/bin/env bash
set -euo pipefail

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "pg_restore is required but not installed."
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required."
  exit 1
fi

if [[ -z "${1:-}" ]]; then
  echo "Usage: npm run db:restore -- <path-to-backup.dump>"
  exit 1
fi

BACKUP_FILE="$1"
if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

echo "Restoring backup: ${BACKUP_FILE}"
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="${DATABASE_URL}" "${BACKUP_FILE}"
echo "Restore completed."
