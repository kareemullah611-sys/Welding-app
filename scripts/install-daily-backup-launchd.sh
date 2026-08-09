#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${BACKUP_ENV_FILE:-${PROJECT_DIR}/.env.backup}"
BACKUP_HOUR="${BACKUP_HOUR:-2}"
BACKUP_MINUTE="${BACKUP_MINUTE:-15}"
LABEL="${BACKUP_LAUNCHD_LABEL:-com.mrf-hardware.daily-pg-backup}"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="${PROJECT_DIR}/backups/logs"

if [[ ! "${BACKUP_HOUR}" =~ ^[0-9]+$ ]] || [[ "${BACKUP_HOUR}" -lt 0 ]] || [[ "${BACKUP_HOUR}" -gt 23 ]]; then
  echo "BACKUP_HOUR must be 0-23."
  exit 1
fi

if [[ ! "${BACKUP_MINUTE}" =~ ^[0-9]+$ ]] || [[ "${BACKUP_MINUTE}" -lt 0 ]] || [[ "${BACKUP_MINUTE}" -gt 59 ]]; then
  echo "BACKUP_MINUTE must be 0-59."
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  cat > "${ENV_FILE}" <<'ENV'
# Use DIRECT_URL for Neon/Railway direct Postgres backup connections.
# Do not commit this file.
DIRECT_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require"
BACKUP_DIR="./backups"
BACKUP_RETENTION_DAYS="30"
ENV
  chmod 600 "${ENV_FILE}"
  echo "Created ${ENV_FILE}. Edit it with your production DIRECT_URL, then run this command again."
  exit 1
fi

mkdir -p "${HOME}/Library/LaunchAgents" "${LOG_DIR}"

cat > "${PLIST}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd '${PROJECT_DIR}' &amp;&amp; BACKUP_ENV_FILE='${ENV_FILE}' npm run db:backup</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${BACKUP_HOUR}</integer>
    <key>Minute</key>
    <integer>${BACKUP_MINUTE}</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/daily-backup.out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/daily-backup.err.log</string>
</dict>
</plist>
PLIST

launchctl unload "${PLIST}" >/dev/null 2>&1 || true
launchctl load "${PLIST}"

echo "Installed daily pg_dump backup:"
echo "  Schedule: ${BACKUP_HOUR}:$(printf '%02d' "${BACKUP_MINUTE}")"
echo "  Config:   ${ENV_FILE}"
echo "  Plist:    ${PLIST}"
echo "  Logs:     ${LOG_DIR}"
