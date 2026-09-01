#!/usr/bin/env bash
set -euo pipefail

EXPLICIT_DATABASE_URL_SET="${DATABASE_URL+x}"
EXPLICIT_DATABASE_URL="${DATABASE_URL:-}"
EXPLICIT_DIRECT_URL_SET="${DIRECT_URL+x}"
EXPLICIT_DIRECT_URL="${DIRECT_URL:-}"
EXPLICIT_BACKUP_DIR_SET="${BACKUP_DIR+x}"
EXPLICIT_BACKUP_DIR="${BACKUP_DIR:-}"
EXPLICIT_RETENTION_SET="${BACKUP_RETENTION_DAYS+x}"
EXPLICIT_RETENTION="${BACKUP_RETENTION_DAYS:-}"

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

[[ -n "${EXPLICIT_DATABASE_URL_SET}" ]] && DATABASE_URL="${EXPLICIT_DATABASE_URL}"
if [[ -n "${EXPLICIT_DIRECT_URL_SET}" ]]; then
  DIRECT_URL="${EXPLICIT_DIRECT_URL}"
elif [[ -n "${EXPLICIT_DATABASE_URL_SET}" ]]; then
  unset DIRECT_URL
fi
[[ -n "${EXPLICIT_BACKUP_DIR_SET}" ]] && BACKUP_DIR="${EXPLICIT_BACKUP_DIR}"
[[ -n "${EXPLICIT_RETENTION_SET}" ]] && BACKUP_RETENTION_DAYS="${EXPLICIT_RETENTION}"

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

RAW_DB_URL="${DIRECT_URL:-${DATABASE_URL}}"
DB_URL="$(RAW_DB_URL="${RAW_DB_URL}" node -e 'const u=new URL(process.env.RAW_DB_URL); u.searchParams.delete("schema"); process.stdout.write(u.toString())')"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUTPUT_FILE="${BACKUP_DIR}/welding_app_${TIMESTAMP}.dump"
TEMP_FILE="${OUTPUT_FILE}.partial"
MIN_BACKUP_BYTES="${MIN_BACKUP_BYTES:-10240}"

mkdir -p "${BACKUP_DIR}"
echo "Creating backup: ${OUTPUT_FILE}"
trap 'rm -f "${TEMP_FILE}"' EXIT
pg_dump --format=custom --compress=9 --no-owner --no-privileges --file="${TEMP_FILE}" "${DB_URL}"
ARCHIVE_ITEMS="$(pg_restore --list "${TEMP_FILE}" | awk '!/^;/ && NF { count++ } END { print count+0 }')"
if [[ "${ARCHIVE_ITEMS}" -le 0 ]]; then
  echo "Backup verification failed: archive contains no restore items."
  exit 1
fi
if stat -f%z "${TEMP_FILE}" >/dev/null 2>&1; then
  BACKUP_BYTES="$(stat -f%z "${TEMP_FILE}")"
else
  BACKUP_BYTES="$(stat -c%s "${TEMP_FILE}")"
fi
if [[ "${BACKUP_BYTES}" -lt "${MIN_BACKUP_BYTES}" ]]; then
  echo "Backup verification failed: ${BACKUP_BYTES} bytes is below minimum ${MIN_BACKUP_BYTES}."
  exit 1
fi
mv "${TEMP_FILE}" "${OUTPUT_FILE}"
trap - EXIT

if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "${OUTPUT_FILE}" > "${OUTPUT_FILE}.sha256"
else
  sha256sum "${OUTPUT_FILE}" > "${OUTPUT_FILE}.sha256"
fi
DB_TARGET="$(DB_URL_FOR_TARGET="${DB_URL}" node -e 'const u=new URL(process.env.DB_URL_FOR_TARGET); process.stdout.write(`${u.hostname}/${u.pathname.slice(1)}`)')"
printf '{"createdAt":"%s","databaseTarget":"%s","bytes":%s,"archiveItems":%s,"retentionDays":%s}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${DB_TARGET}" "${BACKUP_BYTES}" "${ARCHIVE_ITEMS}" "${BACKUP_RETENTION_DAYS}" > "${OUTPUT_FILE}.manifest.json"

if [[ "${BACKUP_RETENTION_DAYS}" =~ ^[0-9]+$ ]] && [[ "${BACKUP_RETENTION_DAYS}" -gt 0 ]]; then
  find "${BACKUP_DIR}" -type f -name "welding_app_*.dump" -mtime +"${BACKUP_RETENTION_DAYS}" -delete
  find "${BACKUP_DIR}" -type f \( -name "welding_app_*.dump.sha256" -o -name "welding_app_*.dump.manifest.json" \) -mtime +"${BACKUP_RETENTION_DAYS}" -delete
fi

echo "Backup completed: ${OUTPUT_FILE}"
