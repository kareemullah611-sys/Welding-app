#!/usr/bin/env bash
set -euo pipefail

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump is required but not installed."
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" && -z "${DIRECT_URL:-}" ]]; then
  echo "DATABASE_URL or DIRECT_URL is required."
  exit 1
fi

DB_URL="${DIRECT_URL:-${DATABASE_URL}}"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUTPUT_FILE="${BACKUP_DIR}/welding_app_${TIMESTAMP}.dump"

mkdir -p "${BACKUP_DIR}"
echo "Creating backup: ${OUTPUT_FILE}"
pg_dump --format=custom --no-owner --no-privileges --file="${OUTPUT_FILE}" "${DB_URL}"
echo "Backup completed: ${OUTPUT_FILE}"
