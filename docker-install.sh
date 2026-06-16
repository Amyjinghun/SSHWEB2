#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="SSHWeb"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env.docker"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

log() { printf '%b\n' "${BLUE}==>${NC} $*"; }
ok() { printf '%b\n' "${GREEN}OK${NC} $*"; }
warn() { printf '%b\n' "${YELLOW}WARN${NC} $*"; }
fail() { printf '%b\n' "${RED}ERROR${NC} $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage:
  bash docker-install.sh              Interactive install or upgrade
  bash docker-install.sh install      Same as default
  bash docker-install.sh up           Start containers
  bash docker-install.sh down         Stop containers, keep data
  bash docker-install.sh restart      Restart containers
  bash docker-install.sh status       Show container status
  bash docker-install.sh logs         Follow logs
  bash docker-install.sh uninstall    Stop containers and optionally remove data

Environment overrides for non-interactive installs:
  APP_PORT=18080 DB_EXPOSE_PORT=3307 MYSQL_DATABASE=sshweb MYSQL_USER=sshweb
EOF
}

require_project_root() {
  [ -f "${COMPOSE_FILE}" ] || fail "docker-compose.yml not found. Run this script from the project root."
  [ -f "${SCRIPT_DIR}/Dockerfile" ] || fail "Dockerfile not found. Run this script from the project root."
  [ -f "${SCRIPT_DIR}/server/package.json" ] || fail "server/package.json not found."
  [ -f "${SCRIPT_DIR}/client/package.json" ] || fail "client/package.json not found."
  [ -f "${SCRIPT_DIR}/database/schema.sql" ] || fail "database/schema.sql not found."
}

is_root() {
  [ "${EUID:-$(id -u)}" -eq 0 ]
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

compose() {
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

random_secret() {
  if have_cmd openssl; then
    openssl rand -base64 48 | tr -d '\n'
  else
    od -An -N48 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

read_default() {
  local prompt="$1"
  local default="$2"
  local var_name="$3"
  local value
  read -r -p "${prompt} [${default}]: " value
  printf -v "${var_name}" '%s' "${value:-$default}"
}

confirm() {
  local prompt="$1"
  local default="${2:-y}"
  local value
  read -r -p "${prompt} (y/n) [${default}]: " value
  value="${value:-$default}"
  [[ "${value}" =~ ^[Yy]$ ]]
}

install_docker_if_needed() {
  if have_cmd docker; then
    ok "$(docker --version)"
  else
    is_root || fail "Docker is not installed. Re-run as root so the script can install Docker, or install Docker manually."
    log "Installing Docker using get.docker.com"
    apt-get update -y
    apt-get install -y ca-certificates curl gnupg openssl
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker >/dev/null 2>&1 || true
    systemctl start docker >/dev/null 2>&1 || true
    ok "$(docker --version)"
  fi

  if docker compose version >/dev/null 2>&1; then
    ok "$(docker compose version | head -n 1)"
  else
    is_root || fail "Docker Compose plugin is missing. Re-run as root or install docker-compose-plugin manually."
    log "Installing Docker Compose plugin"
    apt-get update -y
    apt-get install -y docker-compose-plugin
    docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin installation failed."
    ok "$(docker compose version | head -n 1)"
  fi
}

validate_port() {
  local name="$1"
  local value="$2"
  [[ "${value}" =~ ^[0-9]+$ ]] || fail "${name} must be a number."
  [ "${value}" -ge 1 ] && [ "${value}" -le 65535 ] || fail "${name} must be between 1 and 65535."
}

validate_identifier() {
  local name="$1"
  local value="$2"
  [[ "${value}" =~ ^[A-Za-z0-9_]+$ ]] || fail "${name} may only contain letters, numbers, and underscores."
}

check_port_available() {
  local port="$1"
  local label="$2"
  if have_cmd ss && ss -tuln | awk '{print $5}' | grep -Eq "[:.]${port}$"; then
    warn "${label} port ${port} appears to be in use. If this is an existing SSHWeb container, continuing is safe."
    return
  fi
  if have_cmd lsof && lsof -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    warn "${label} port ${port} appears to be in use. If this is an existing SSHWeb container, continuing is safe."
  fi
}

write_env_file() {
  local app_port="$1"
  local db_port="$2"
  local db_name="$3"
  local db_user="$4"
  local mysql_password="$5"
  local mysql_root_password="$6"
  local jwt_secret="$7"
  local encryption_key="$8"
  local cors_origins="$9"

  umask 077
  cat > "${ENV_FILE}" <<EOF
APP_PORT=${app_port}
DB_EXPOSE_PORT=${db_port}
MYSQL_DATABASE=${db_name}
MYSQL_USER=${db_user}
MYSQL_PASSWORD=${mysql_password}
MYSQL_ROOT_PASSWORD=${mysql_root_password}
JWT_SECRET=${jwt_secret}
ENCRYPTION_KEY=${encryption_key}
CORS_ORIGINS=${cors_origins}
EOF
  ok "Wrote ${ENV_FILE}"
}

load_existing_env() {
  if [ -f "${ENV_FILE}" ]; then
    local line key value
    while IFS= read -r line || [ -n "${line}" ]; do
      line="${line%$'\r'}"
      case "${line}" in
        ''|\#*) continue ;;
      esac
      key="${line%%=*}"
      value="${line#*=}"
      [[ "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
      export "${key}=${value}"
    done < "${ENV_FILE}"
  fi
}

configure_env() {
  load_existing_env

  local app_port="${APP_PORT:-18080}"
  local db_port="${DB_EXPOSE_PORT:-3307}"
  local db_name="${MYSQL_DATABASE:-sshweb}"
  local db_user="${MYSQL_USER:-sshweb}"
  local cors_origins="${CORS_ORIGINS:-}"
  local mysql_password="${MYSQL_PASSWORD:-$(random_secret)}"
  local mysql_root_password="${MYSQL_ROOT_PASSWORD:-$(random_secret)}"
  local jwt_secret="${JWT_SECRET:-$(random_secret)}"
  local encryption_key="${ENCRYPTION_KEY:-$(random_secret)}"

  if [ -t 0 ]; then
    echo
    log "Install configuration. Press Enter to keep the default."
    read_default "Application port" "${app_port}" app_port
    read_default "Database exposed port" "${db_port}" db_port
    read_default "Database name" "${db_name}" db_name
    read_default "Database user" "${db_user}" db_user
    read_default "CORS origins, comma separated. Empty allows same-origin/reverse-proxy use" "${cors_origins}" cors_origins
  fi

  validate_port "APP_PORT" "${app_port}"
  validate_port "DB_EXPOSE_PORT" "${db_port}"
  validate_identifier "MYSQL_DATABASE" "${db_name}"
  validate_identifier "MYSQL_USER" "${db_user}"
  check_port_available "${app_port}" "Application"
  check_port_available "${db_port}" "Database"

  if [ -f "${ENV_FILE}" ]; then
    warn "Existing .env.docker found. Secrets will be preserved unless you edit or delete that file."
  fi

  echo
  printf '%b\n' "${BOLD}Configuration summary${NC}"
  printf '  Application URL: http://127.0.0.1:%s\n' "${app_port}"
  printf '  Database:        %s@db/%s\n' "${db_user}" "${db_name}"
  printf '  DB host port:    %s\n' "${db_port}"
  printf '  CORS origins:    %s\n' "${cors_origins:-<empty>}"
  echo

  if [ -t 0 ]; then
    confirm "Continue with Docker install" "y" || fail "Install cancelled."
  fi

  write_env_file "${app_port}" "${db_port}" "${db_name}" "${db_user}" \
    "${mysql_password}" "${mysql_root_password}" "${jwt_secret}" "${encryption_key}" "${cors_origins}"
}

preflight() {
  require_project_root
  install_docker_if_needed
  have_cmd curl || warn "curl is not installed; HTTP verification will be skipped."
}

install_or_upgrade() {
  preflight
  configure_env

  log "Validating Compose configuration"
  compose config >/dev/null
  ok "Compose configuration is valid"

  log "Building image"
  compose build

  log "Starting containers"
  compose up -d

  verify
  print_success
}

verify() {
  local app_port
  app_port="$(grep '^APP_PORT=' "${ENV_FILE}" | cut -d= -f2-)"
  app_port="${app_port:-18080}"

  log "Waiting for containers"
  sleep 5
  compose ps

  if ! docker ps --filter "name=sshweb-db" --format '{{.Names}} {{.Status}}' | grep -q '^sshweb-db .*Up'; then
    warn "Database container is not Up. Recent logs:"
    docker logs --tail 80 sshweb-db 2>/dev/null || true
    return 1
  fi

  if ! docker ps --filter "name=sshweb-app" --format '{{.Names}} {{.Status}}' | grep -q '^sshweb-app .*Up'; then
    warn "Application container is not Up. Recent logs:"
    docker logs --tail 120 sshweb-app 2>/dev/null || true
    return 1
  fi

  if have_cmd curl; then
    local code
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "http://127.0.0.1:${app_port}/" 2>/dev/null || true)"
    case "${code}" in
      200|302|304) ok "HTTP check returned ${code}" ;;
      000|"") warn "HTTP check did not receive a response yet. The app may still be warming up." ;;
      *) warn "HTTP check returned ${code}. Check logs if the UI does not load." ;;
    esac
  fi
}

print_success() {
  local app_port
  local server_ip
  app_port="$(grep '^APP_PORT=' "${ENV_FILE}" | cut -d= -f2-)"
  app_port="${app_port:-18080}"
  server_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  server_ip="${server_ip:-127.0.0.1}"

  echo
  printf '%b\n' "${GREEN}${BOLD}${APP_NAME} Docker deployment is ready.${NC}"
  printf '  Local URL:   http://127.0.0.1:%s\n' "${app_port}"
  printf '  Server URL:  http://%s:%s\n' "${server_ip}" "${app_port}"
  printf '  Username:    admin\n'
  printf '  Password:    admin123\n'
  echo
  printf '  Config:      %s\n' "${ENV_FILE}"
  printf '  Logs:        bash docker-install.sh logs\n'
  printf '  Status:      bash docker-install.sh status\n'
  echo
  warn "Change the default admin password immediately after first login."
}

cmd_up() {
  require_project_root
  [ -f "${ENV_FILE}" ] || fail ".env.docker not found. Run install first."
  compose up -d
  verify || true
}

cmd_down() {
  require_project_root
  [ -f "${ENV_FILE}" ] || fail ".env.docker not found. Nothing to stop."
  compose down
}

cmd_restart() {
  require_project_root
  [ -f "${ENV_FILE}" ] || fail ".env.docker not found. Run install first."
  compose restart
  verify || true
}

cmd_status() {
  require_project_root
  if [ -f "${ENV_FILE}" ]; then
    compose ps
  else
    warn ".env.docker not found."
    docker ps --filter "name=sshweb" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || true
  fi
}

cmd_logs() {
  require_project_root
  [ -f "${ENV_FILE}" ] || fail ".env.docker not found. Run install first."
  compose logs -f --tail 200
}

cmd_uninstall() {
  require_project_root
  [ -f "${ENV_FILE}" ] || warn ".env.docker not found; using default Compose interpolation."

  echo
  warn "This will stop and remove SSHWeb containers. Database volume is kept by default."
  if [ -t 0 ]; then
    confirm "Continue" "n" || fail "Uninstall cancelled."
  fi

  if [ -f "${ENV_FILE}" ]; then
    compose down
  else
    docker compose -f "${COMPOSE_FILE}" down
  fi

  if [ -t 0 ] && confirm "Remove Docker volumes too? This deletes database data" "n"; then
    docker volume rm sshweb2_sshweb-db-data sshweb2_sshweb-logs sshweb-db-data sshweb-logs >/dev/null 2>&1 || true
    ok "Volumes removed where present"
  else
    ok "Containers removed; volumes preserved"
  fi
}

main() {
  local cmd="${1:-install}"
  case "${cmd}" in
    install) install_or_upgrade ;;
    up) cmd_up ;;
    down) cmd_down ;;
    restart) cmd_restart ;;
    status) cmd_status ;;
    logs) cmd_logs ;;
    uninstall) cmd_uninstall ;;
    -h|--help|help) usage ;;
    *) usage; fail "Unknown command: ${cmd}" ;;
  esac
}

main "$@"
