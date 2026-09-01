#!/usr/bin/env bash
set -euo pipefail

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "pg_restore is required but not installed."
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" && -z "${DIRECT_URL:-}" ]]; then
  echo "DATABASE_URL or DIRECT_URL is required."
  exit 1
fi

RAW_DB_URL="${DIRECT_URL:-${DATABASE_URL}}"
DB_URL="$(RAW_DB_URL="${RAW_DB_URL}" node -e 'const u=new URL(process.env.RAW_DB_URL); u.searchParams.delete("schema"); process.stdout.write(u.toString())')"

if [[ -z "${1:-}" ]]; then
  echo "Usage: npm run db:restore -- <path-to-backup.dump>"
  exit 1
fi

BACKUP_FILE="$1"
if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

pg_restore --list "${BACKUP_FILE}" >/dev/null

TARGET="$(DB_URL_FOR_TARGET="${DB_URL}" node -e 'const u=new URL(process.env.DB_URL_FOR_TARGET); process.stdout.write(`${u.hostname}/${u.pathname.slice(1)}`)')"
HOST="${TARGET%%/*}"
EXPECTED_ACK="I ACKNOWLEDGE ${TARGET}"
if [[ "${RESTORE_ACKNOWLEDGEMENT:-}" != "${EXPECTED_ACK}" ]]; then
  echo "Restore blocked. Set RESTORE_ACKNOWLEDGEMENT='${EXPECTED_ACK}' after verifying the target."
  exit 1
fi
if [[ "${HOST}" != "localhost" && "${HOST}" != "127.0.0.1" && "${ALLOW_REMOTE_DATABASE_RESTORE:-false}" != "true" ]]; then
  echo "Remote restore blocked. Set ALLOW_REMOTE_DATABASE_RESTORE=true only after approval."
  exit 1
fi

echo "Restoring backup into acknowledged target: ${TARGET}"
pg_restore --exit-on-error --single-transaction --clean --if-exists --no-owner --no-privileges --dbname="${DB_URL}" "${BACKUP_FILE}"
echo "Restore completed."
