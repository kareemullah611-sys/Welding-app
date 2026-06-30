#!/usr/bin/env bash
# MRF Hardware / Welding App — full offline-first local setup (macOS + Linux)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()  { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
step()  { echo -e "\n${BOLD}==> $*${NC}"; }

OS="$(uname -s)"
IS_MAC=false
IS_LINUX=false
[[ "$OS" == "Darwin" ]] && IS_MAC=true
[[ "$OS" == "Linux" ]] && IS_LINUX=true

if ! $IS_MAC && ! $IS_LINUX; then
  fail "Unsupported OS: $OS (this script supports macOS and Linux only)"
fi

brew_install() {
  if ! command -v brew >/dev/null 2>&1; then
    return 1
  fi
  info "Installing $1 via Homebrew..."
  brew install "$1"
}

ensure_homebrew_path() {
  if $IS_MAC && command -v brew >/dev/null 2>&1; then
    for prefix in /opt/homebrew /usr/local; do
      if [[ -d "${prefix}/opt/postgresql@16/bin" ]]; then
        export PATH="${prefix}/opt/postgresql@16/bin:${PATH}"
      fi
      if [[ -d "${prefix}/opt/node@22/bin" ]]; then
        export PATH="${prefix}/opt/node@22/bin:${PATH}"
      fi
    done
  fi
}

check_node() {
  if ! command -v node >/dev/null 2>&1; then
    return 1
  fi
  local major
  major="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if [[ "$major" -lt 18 ]]; then
    warn "Node $(node -v) found; this project targets Node 22.x (see package.json engines)"
  else
    ok "Node $(node -v)"
  fi
  command -v npm >/dev/null 2>&1 || fail "npm not found (install Node.js with npm)"
  ok "npm $(npm -v)"
  return 0
}

install_node() {
  step "Node.js"
  if check_node; then
    return 0
  fi

  warn "Node.js not found."
  if $IS_MAC && brew_install node@22 || brew_install node; then
    ensure_homebrew_path
    check_node || fail "Node.js install finished but 'node' is still not on PATH. Restart your shell and re-run."
    return 0
  fi

  if $IS_LINUX && command -v apt-get >/dev/null 2>&1; then
    warn "On Debian/Ubuntu, run: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
  elif $IS_LINUX && command -v dnf >/dev/null 2>&1; then
    warn "On Fedora/RHEL, run: sudo dnf install nodejs npm"
  fi
  fail "Install Node.js 22.x manually, then re-run this script."
}

postgres_cli() {
  command -v psql >/dev/null 2>&1 && command -v createdb >/dev/null 2>&1
}

start_postgres_mac() {
  if ! $IS_MAC || ! command -v brew >/dev/null 2>&1; then
    return 0
  fi
  if brew services list 2>/dev/null | grep -q "postgresql@16.*started"; then
    return 0
  fi
  if brew list postgresql@16 >/dev/null 2>&1; then
    info "Starting PostgreSQL service..."
    brew services start postgresql@16 || true
  elif brew list postgresql >/dev/null 2>&1; then
    info "Starting PostgreSQL service..."
    brew services start postgresql || true
  fi
}

install_postgres() {
  step "PostgreSQL"
  ensure_homebrew_path

  if postgres_cli; then
    ok "PostgreSQL client tools found ($(psql --version | head -1))"
    start_postgres_mac
    return 0
  fi

  warn "PostgreSQL not found."
  warn "This app requires PostgreSQL — SQLite is not supported (schema uses PostgreSQL-only features)."
  if $IS_MAC && (brew_install postgresql@16 || brew_install postgresql); then
    ensure_homebrew_path
    start_postgres_mac
    sleep 2
    postgres_cli || fail "PostgreSQL install finished but psql/createdb are not on PATH."
    ok "PostgreSQL installed"
    return 0
  fi

  if $IS_LINUX && command -v apt-get >/dev/null 2>&1; then
    warn "On Debian/Ubuntu, run:"
    warn "  sudo apt-get update && sudo apt-get install -y postgresql postgresql-contrib"
    warn "  sudo systemctl enable --now postgresql"
  elif $IS_LINUX && command -v dnf >/dev/null 2>&1; then
    warn "On Fedora/RHEL, run: sudo dnf install postgresql-server postgresql && sudo postgresql-setup --initdb && sudo systemctl enable --now postgresql"
  fi
  fail "Install PostgreSQL 14+ manually, then re-run this script."
}

load_env_file() {
  if [[ -f .env ]]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
  fi
}

ensure_env_file() {
  step "Environment (.env)"
  if [[ -f .env ]]; then
    ok ".env already exists (leaving unchanged)"
    return 0
  fi

  if [[ ! -f .env.example ]]; then
    fail ".env.example is missing"
  fi

  cp .env.example .env

  if $IS_MAC; then
    local user db_url
    user="$(whoami)"
    db_url="postgresql://${user}@localhost:5432/welding_app?schema=public"
    if command -v python3 >/dev/null 2>&1; then
      python3 - <<PY
from pathlib import Path
path = Path(".env")
text = path.read_text()
text = text.replace(
    'DATABASE_URL="postgresql://user:password@localhost:5432/welding_app?schema=public"',
    'DATABASE_URL="${db_url}"',
)
if 'JWT_SECRET="your-super-secret-jwt-key-change-this-in-production"' in text:
    import secrets
    text = text.replace(
        'JWT_SECRET="your-super-secret-jwt-key-change-this-in-production"',
        f'JWT_SECRET="{secrets.token_urlsafe(48)}"',
    )
path.write_text(text)
PY
    else
      warn "Could not auto-tune DATABASE_URL; edit .env manually before continuing."
    fi
  fi

  ok "Created .env from .env.example"
  warn "Review DATABASE_URL in .env if database connection fails."
}

parse_db_name() {
  local url="$1"
  local name="${url##*/}"
  echo "${name%%\?*}"
}

ensure_database() {
  step "Database"
  load_env_file
  [[ -n "${DATABASE_URL:-}" ]] || fail "DATABASE_URL is not set in .env"

  if [[ "${DATABASE_URL}" == file:* ]] || [[ "${DATABASE_URL}" == sqlite:* ]]; then
    fail "SQLite DATABASE_URL detected. This app requires PostgreSQL. Update .env and re-run."
  fi

  local db_name
  db_name="$(parse_db_name "$DATABASE_URL")"
  [[ -n "$db_name" ]] || fail "Could not parse database name from DATABASE_URL"

  if psql "$DATABASE_URL" -c "SELECT 1" >/dev/null 2>&1; then
    ok "Connected to database \"${db_name}\""
    return 0
  fi

  info "Database \"${db_name}\" not reachable — attempting createdb..."
  if createdb "$db_name" 2>/dev/null; then
    ok "Created database \"${db_name}\""
    return 0
  fi

  warn "Could not create or connect to \"${db_name}\"."
  warn "Ensure PostgreSQL is running and DATABASE_URL in .env is correct."
  warn "Example: postgresql://$(whoami)@localhost:5432/welding_app?schema=public"
  fail "Fix DATABASE_URL, create the database manually (createdb ${db_name}), then re-run."
}

run_setup_core() {
  step "npm install"
  npm install
  ok "Dependencies installed"

  step "Prisma generate"
  npm run db:generate
  ok "Prisma client generated"

  step "Database schema + seed (bootstrap)"
  # Uses db push + conditional seed + migration safety guards (see scripts/bootstrap.ts)
  npm run db:bootstrap
  ok "Database ready"
}

build_app() {
  step "Production build"
  npm run build
  ok "Build completed"
}

print_success() {
  echo ""
  echo -e "${GREEN}${BOLD}Setup complete!${NC}"
  echo ""
  echo -e "${BOLD}Start development:${NC}"
  echo "  npm run dev"
  echo "  Open http://localhost:3000"
  echo ""
  echo -e "${BOLD}Start production (local):${NC}"
  echo "  npm run start"
  echo ""
  echo -e "${BOLD}Default login (super admin):${NC}"
  echo -e "  Username: ${GREEN}superadmin${NC}"
  echo -e "  Password: ${GREEN}admin123${NC}"
  echo ""
  echo -e "${BOLD}City admin logins:${NC} quetta_admin, lahore_admin, kabul_admin, … / ${GREEN}city123${NC}"
  echo ""
  echo -e "${BOLD}Electron (desktop):${NC} npm run package:mac:dev"
  echo -e "${BOLD}Packaged Mac app:${NC}   npm run package:mac:dist"
  echo ""
  warn "Change JWT_SECRET and default passwords before any production deployment."
}

main() {
  echo -e "${BOLD}MRF Hardware — offline setup${NC}"
  info "Project root: $ROOT_DIR"

  install_node
  install_postgres
  ensure_env_file
  ensure_database
  run_setup_core

  if [[ "${SKIP_BUILD:-}" == "1" ]]; then
    warn "Skipping build (SKIP_BUILD=1)"
  else
    build_app
  fi

  print_success
}

main "$@"
