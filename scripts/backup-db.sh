#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${BACKUP_ENV_FILE:-}" ]]; then
  if [[ ! -f "${BACKUP_ENV_FILE}" ]]; then
    echo "BACKUP_ENV_FILE does not exist: ${BACKUP_ENV_FILE}"
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "${BACKUP_ENV_FILE}"
  set +a
elif [[ -f ".env.backup" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env.backup"
  set +a
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump is required but not installed."
  exit 1
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "pg_restore is required but not installed."
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" && -z "${DIRECT_URL:-}" ]]; then
  echo "DATABASE_URL or DIRECT_URL is required."
  exit 1
fi

DB_URL="${DIRECT_URL:-${DATABASE_URL}}"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUTPUT_FILE="${BACKUP_DIR}/welding_app_${TIMESTAMP}.dump"

mkdir -p "${BACKUP_DIR}"
echo "Creating backup: ${OUTPUT_FILE}"
pg_dump --format=custom --compress=9 --no-owner --no-privileges --file="${OUTPUT_FILE}" "${DB_URL}"
pg_restore --list "${OUTPUT_FILE}" >/dev/null

if [[ "${BACKUP_RETENTION_DAYS}" =~ ^[0-9]+$ ]] && [[ "${BACKUP_RETENTION_DAYS}" -gt 0 ]]; then
  find "${BACKUP_DIR}" -type f -name "welding_app_*.dump" -mtime +"${BACKUP_RETENTION_DAYS}" -delete
fi

echo "Backup completed: ${OUTPUT_FILE}"
