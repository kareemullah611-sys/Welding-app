#!/usr/bin/env bash
# MRF Hardware / Welding App — quick local setup (requires Node.js + PostgreSQL already installed)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }

command -v node >/dev/null 2>&1 || { echo "Node.js is required. Run: bash scripts/setup-offline.sh"; exit 1; }
command -v psql >/dev/null 2>&1 || { echo "PostgreSQL (psql) is required. Run: bash scripts/setup-offline.sh"; exit 1; }

echo -e "${BOLD}MRF Hardware — quick setup${NC}"

if [[ ! -f .env ]]; then
  cp .env.example .env
  ok "Created .env from .env.example — local Postgres URLs; edit if needed"
else
  info ".env already exists"
fi

npm install
npm run db:generate
npm run db:bootstrap

echo ""
ok "Setup finished."
echo ""
echo "  npm run dev          # development server → http://localhost:3000"
echo "  superadmin / admin123"
echo ""
warn "For full checks (Node/Postgres install, build): npm run setup:offline"
