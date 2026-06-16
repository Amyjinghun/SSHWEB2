#!/bin/bash
#===============================================
# SSHWeb 服务器群控面板 - 统一安装/卸载脚本
# 支持 Debian 11/12 / Ubuntu 20.04+
#
# 用法:
#   bash setup.sh              # 交互式菜单
#   bash setup.sh install      # 直接安装 (PM2模式)
#   bash setup.sh docker       # Docker安装
#   bash setup.sh uninstall    # 直接卸载
#   bash setup.sh update       # 更新版本
#===============================================

set -e

# ──── 颜色定义 ────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ──── 常量 ────
INSTALL_DIR="/opt/sshweb"
LOG_DIR="/var/log/sshweb"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION="1.0.0"

# ══════════════════════════════════════════════
# 通用函数
# ══════════════════════════════════════════════

print_banner() {
  echo -e "${CYAN}"
  echo "  ╔═══════════════════════════════════════════════╗"
  echo "  ║                                               ║"
  echo "  ║        SSHWeb 服务器群控管理面板               ║"
  echo "  ║        v${VERSION}                              ║"
  echo "  ║                                               ║"
  echo "  ╚═══════════════════════════════════════════════╝"
  echo -e "${NC}"
}

print_separator() {
  echo -e "${BLUE}  ──────────────────────────────────────────────${NC}"
}

step_info() {
  local step="$1"
  echo -e "\n${BOLD}${YELLOW}  [${step}]${NC} ${BOLD}$2${NC}\n"
}

step_done() {
  echo -e "  ${GREEN}✓ $1${NC}"
}

step_warn() {
  echo -e "  ${YELLOW}! $1${NC}"
}

step_fail() {
  echo -e "  ${RED}✗ $1${NC}"
}

check_root() {
  if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}错误: 请使用 root 权限运行此脚本${NC}"
    exit 1
  fi
}

check_os() {
  if [ ! -f /etc/debian_version ]; then
    echo -e "${RED}错误: 此脚本仅支持 Debian/Ubuntu 系统${NC}"
    exit 1
  fi
}

read_default() {
  local prompt="$1"
  local default="$2"
  local var="$3"
  read -p "  ${prompt} [${default}]: " input
  eval "${var}=\${input:-${default}}"
}

confirm_action() {
  local prompt="$1"
  local default="${2:-n}"
  read -p "  ${prompt} (y/n) [${default}]: " confirm
  confirm=${confirm:-$default}
  [[ "$confirm" =~ ^[Yy]$ ]]
}

# ══════════════════════════════════════════════
# 安装功能
# ══════════════════════════════════════════════

do_install() {
  print_banner
  check_root
  check_os

  # 检查是否已安装
  if [ -d "${INSTALL_DIR}" ] && command -v pm2 &>/dev/null && pm2 list 2>/dev/null | grep -q "sshweb"; then
    echo -e "${YELLOW}  检测到已安装的 SSHWeb 实例${NC}"
    if confirm_action "  是否先卸载旧版本再重新安装?" "y"; then
      do_uninstall_silent
    else
      echo -e "${YELLOW}  已取消安装${NC}"
      return 1
    fi
  fi

  # 检查项目文件
  if [ ! -f "${SCRIPT_DIR}/server/package.json" ]; then
    echo -e "${RED}错误: 请在项目根目录运行此脚本${NC}"
    exit 1
  fi

  # ──── 交互式配置 ────
  print_separator
  echo -e "${BOLD}${CYAN}  安装配置${NC} ${DIM}(直接回车使用默认值)${NC}"
  print_separator

  local APP_PORT DB_HOST DB_PORT DB_NAME DB_USER DB_PASS

  read_default "应用端口" "18080" "APP_PORT"

  echo ""
  echo -e "  ${DIM}数据库配置 (填写远程地址可对接外部 MySQL/MariaDB)${NC}"
  read_default "数据库主机" "localhost" "DB_HOST"
  read_default "数据库端口" "3306" "DB_PORT"
  read_default "数据库名称" "sshweb" "DB_NAME"
  read_default "数据库用户" "sshweb" "DB_USER"
  read_default "数据库密码" "sshweb123456" "DB_PASS"

  # 自动判断本地/远程
  local IS_LOCAL=false
  if [[ "$DB_HOST" == "localhost" || "$DB_HOST" == "127.0.0.1" ]]; then
    IS_LOCAL=true
  fi

  # 配置确认
  echo ""
  print_separator
  echo -e "${BOLD}${GREEN}  配置确认${NC}"
  print_separator
  echo -e "  应用端口:       ${BOLD}${APP_PORT}${NC}"
  echo -e "  数据库主机:     ${BOLD}${DB_HOST}:${DB_PORT}${NC}"
  echo -e "  数据库名称:     ${BOLD}${DB_NAME}${NC}"
  echo -e "  数据库用户:     ${BOLD}${DB_USER}${NC}"
  echo -e "  数据库密码:     ${BOLD}${DB_PASS}${NC}"
  if $IS_LOCAL; then
    echo -e "  数据库模式:     ${BOLD}本地安装${NC}"
  else
    echo -e "  数据库模式:     ${BOLD}远程连接${NC}"
  fi
  print_separator
  echo ""

  if ! confirm_action "  确认开始安装?" "y"; then
    echo -e "  ${YELLOW}已取消安装${NC}"
    return 1
  fi

  # ──── 步骤 1: 系统依赖 ────
  step_info "1/7" "安装系统依赖"
  apt-get update -y
  apt-get install -y curl wget git unzip mariadb-client openssl

  if ! command -v node &>/dev/null; then
    echo -e "  ${YELLOW}安装 Node.js 20.x...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi
  step_done "Node.js $(node -v) / npm $(npm -v)"

  # ──── 步骤 2: 数据库 ────
  step_info "2/7" "配置数据库"

  if $IS_LOCAL; then
    # 本地模式：检测/安装/启动 MariaDB，自动建库建用户
    local DB_SERVICE=""
    if systemctl list-unit-files mysql.service &>/dev/null && systemctl is-active mysql &>/dev/null; then
      DB_SERVICE="mysql"
    elif systemctl list-unit-files mariadb.service &>/dev/null && systemctl is-active mariadb &>/dev/null; then
      DB_SERVICE="mariadb"
    fi

    if [ -z "$DB_SERVICE" ]; then
      echo -e "  ${YELLOW}安装 MariaDB 服务端...${NC}"
      apt-get install -y mariadb-server
      DB_SERVICE="mariadb"
    fi

    if systemctl is-active "$DB_SERVICE" &>/dev/null; then
      step_done "$DB_SERVICE 已在运行"
    else
      systemctl enable "$DB_SERVICE"
      systemctl start "$DB_SERVICE"
      step_done "$DB_SERVICE 已启动"
    fi

    mysql -u root <<EOF
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
EOF
    step_done "数据库已配置"
  else
    # 远程模式：测试连接，跳过本地安装
    echo -e "  ${YELLOW}远程数据库模式，跳过本地安装${NC}"
    if command -v mysql &>/dev/null; then
      if mysql -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASS}" -e "USE \`${DB_NAME}\`;" 2>/dev/null; then
        step_done "远程数据库连接成功"
      else
        step_fail "远程数据库连接失败，请检查主机/端口/用户名/密码，以及数据库是否已创建"
        exit 1
      fi
    else
      echo -e "  ${YELLOW}安装 mysql-client 用于测试连接...${NC}"
      apt-get install -y mariadb-client
      if mysql -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASS}" -e "USE \`${DB_NAME}\`;" 2>/dev/null; then
        step_done "远程数据库连接成功"
      else
        step_fail "远程数据库连接失败，请检查主机/端口/用户名/密码，以及数据库是否已创建"
        exit 1
      fi
    fi
  fi

  # ──── 步骤 3: 部署文件 ────
  step_info "3/7" "部署项目文件"
  mkdir -p "${INSTALL_DIR}"
  mkdir -p "${LOG_DIR}"
  cp -r "${SCRIPT_DIR}"/* "${INSTALL_DIR}/"
  cp -r "${SCRIPT_DIR}/.env.example" "${INSTALL_DIR}/.env.example" 2>/dev/null || true
  cd "${INSTALL_DIR}"
  step_done "文件已复制到 ${INSTALL_DIR}"

  # ──── 步骤 4: 初始化数据库 ────
  step_info "4/7" "初始化数据库表结构"

  local TEMP_SCHEMA TEMP_SEED
  TEMP_SCHEMA=$(mktemp)
  TEMP_SEED=$(mktemp)

  sed "s/CREATE DATABASE IF NOT EXISTS \`sshweb\`/CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`/g; s/USE \`sshweb\`/USE \`${DB_NAME}\`/g" \
    "${INSTALL_DIR}/database/schema.sql" > "${TEMP_SCHEMA}"
  sed "s/USE \`sshweb\`/USE \`${DB_NAME}\`/g" \
    "${INSTALL_DIR}/database/seed.sql" > "${TEMP_SEED}"

  mysql -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASS}" < "${TEMP_SCHEMA}"
  mysql -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASS}" < "${TEMP_SEED}"
  rm -f "${TEMP_SCHEMA}" "${TEMP_SEED}"
  step_done "数据库初始化完成"

  # ──── 步骤 5: 构建前后端 ────
  step_info "5/7" "安装依赖并构建"

  cd "${INSTALL_DIR}/server"
  npm install --production
  step_done "后端依赖安装完成"

  cd "${INSTALL_DIR}/client"
  npm install
  npm run build
  step_done "前端构建完成"

  # ──── 步骤 6: 生成配置 ────
  step_info "6/7" "生成配置文件"

  local JWT_SECRET ENCRYPTION_KEY
  JWT_SECRET=$(openssl rand -base64 32)
  ENCRYPTION_KEY=$(openssl rand -base64 32)

  cat > "${INSTALL_DIR}/.env" <<EOF
APP_NAME=SSHWeb
APP_PORT=${APP_PORT}
NODE_ENV=production

MYSQL_HOST=${DB_HOST}
MYSQL_PORT=${DB_PORT}
MYSQL_DATABASE=${DB_NAME}
MYSQL_USER=${DB_USER}
MYSQL_PASSWORD=${DB_PASS}

JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=7d

ENCRYPTION_KEY=${ENCRYPTION_KEY}

SSH_CONNECT_TIMEOUT=10000
SSH_EXEC_TIMEOUT=60000
ENABLE_DANGEROUS_COMMAND_BLOCK=true
EOF

  cp "${INSTALL_DIR}/.env" "${INSTALL_DIR}/server/.env"
  step_done "配置文件已生成"

  # ──── 步骤 7: PM2 启动 ────
  step_info "7/7" "启动服务"

  if ! command -v pm2 &>/dev/null; then
    npm install -g pm2
  fi

  sed -i "s|cwd: '/opt/sshweb'|cwd: '${INSTALL_DIR}'|g" "${INSTALL_DIR}/ecosystem.config.js"
  pm2 start "${INSTALL_DIR}/ecosystem.config.js"
  pm2 save
  pm2 startup systemd -u root --hp /root 2>/dev/null || true
  step_done "服务已启动"

  # ──── 安装验证 ────
  verify_installation "${APP_PORT}"

  # ──── 安装完成提示 ────
  print_install_result "${APP_PORT}"
}

verify_installation() {
  local port="$1"
  echo ""
  echo -e "${BOLD}${YELLOW}  安装验证${NC}"

  sleep 2
  local PM2_STATUS
  PM2_STATUS=$(pm2 jlist 2>/dev/null | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ "$PM2_STATUS" = "online" ]; then
    step_done "服务进程: 运行中 (online)"
  else
    step_fail "服务进程: ${PM2_STATUS:-未检测到}"
    step_warn "请执行 pm2 logs sshweb 查看错误日志"
  fi

  sleep 2
  if ss -tlnp 2>/dev/null | grep -q ":${port} " || netstat -tlnp 2>/dev/null | grep -q ":${port} "; then
    step_done "端口监听: ${port} 已就绪"
  else
    step_fail "端口监听: ${port} 未检测到"
  fi

  local HTTP_CODE
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:${port}/" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ]; then
    step_done "HTTP 响应: ${HTTP_CODE} 正常"
  elif [ "$HTTP_CODE" != "000" ]; then
    step_warn "HTTP 响应: ${HTTP_CODE} (服务可能仍在启动)"
  else
    step_fail "HTTP 响应: 无响应"
  fi
}

print_install_result() {
  local port="$1"
  local SERVER_IP
  SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')

  echo ""
  echo -e "${GREEN}"
  echo "  ╔═══════════════════════════════════════════════╗"
  echo "  ║                                               ║"
  echo "  ║          SSHWeb 安装完成!                      ║"
  echo "  ║                                               ║"
  echo "  ╚═══════════════════════════════════════════════╝"
  echo -e "${NC}"
  echo -e "  ${BOLD}访问信息${NC}"
  print_separator
  echo -e "  地址:  ${CYAN}http://${SERVER_IP}:${port}${NC}"
  echo -e "  账号:  ${BOLD}admin${NC}"
  echo -e "  密码:  ${BOLD}admin123${NC}"
  echo ""
  echo -e "  ${BOLD}路径信息${NC}"
  print_separator
  echo -e "  项目:  ${INSTALL_DIR}"
  echo -e "  日志:  ${LOG_DIR}"
  echo -e "  配置:  ${INSTALL_DIR}/.env"
  echo ""
  echo -e "  ${BOLD}常用命令${NC}"
  print_separator
  echo -e "  pm2 status          查看服务状态"
  echo -e "  pm2 logs sshweb     查看日志"
  echo -e "  pm2 restart sshweb  重启服务"
  echo -e "  pm2 stop sshweb     停止服务"
  echo ""
  echo -e "  ${YELLOW}${BOLD}首次登录后请立即修改默认密码!${NC}"
  echo ""
}

# ══════════════════════════════════════════════
# 卸载功能
# ══════════════════════════════════════════════

do_uninstall() {
  print_banner
  check_root

  echo -e "${RED}${BOLD}"
  echo "  ┌─────────────────────────────────────────────┐"
  echo "  │                                             │"
  echo "  │          SSHWeb 卸载程序                     │"
  echo "  │     ${NC}${RED}警告: 此操作将完全删除 SSHWeb!${RED}            │"
  echo "  │                                             │"
  echo "  └─────────────────────────────────────────────┘"
  echo -e "${NC}"

  if [ ! -d "${INSTALL_DIR}" ]; then
    step_warn "未检测到 SSHWeb 安装目录 (${INSTALL_DIR})"
    if ! confirm_action "  仍然继续?" "n"; then
      return 1
    fi
  fi

  echo ""
  echo -e "  ${RED}即将执行:${NC}"
  echo -e "  ${RED}  • 停止并删除 SSHWeb 服务${NC}"
  echo -e "  ${RED}  • 删除项目文件 (${INSTALL_DIR})${NC}"
  echo -e "  ${RED}  • 删除日志文件 (${LOG_DIR})${NC}"
  echo -e "  ${RED}  • 清理 Nginx 配置${NC}"
  echo ""

  read -p "  输入 YES 确认卸载: " confirm
  if [ "$confirm" != "YES" ]; then
    echo -e "  ${YELLOW}已取消卸载${NC}"
    return 1
  fi

  # 数据库处理
  local DROP_DB=false
  local DB_NAME="sshweb" DB_USER="sshweb"

  read -p "  是否同时删除数据库? (输入 YES 确认): " drop_confirm
  if [ "$drop_confirm" = "YES" ]; then
    DROP_DB=true
    read_default "数据库名称" "sshweb" "DB_NAME"
    read_default "数据库用户" "sshweb" "DB_USER"
  fi

  echo ""
  do_uninstall_silent "$DROP_DB" "$DB_NAME" "$DB_USER"
}

do_uninstall_silent() {
  local DROP_DB="${1:-false}"
  local DB_NAME="${2:-sshweb}"
  local DB_USER="${3:-sshweb}"

  # ──── 步骤 1: 停止服务 ────
  step_info "1/5" "停止 SSHWeb 服务"

  if command -v pm2 &>/dev/null && pm2 list 2>/dev/null | grep -q "sshweb"; then
    pm2 stop sshweb 2>/dev/null || true
    pm2 delete sshweb 2>/dev/null || true
    pm2 save 2>/dev/null || true
    step_done "PM2 进程已停止"
  else
    step_warn "未检测到 PM2 进程"
  fi

  # 停止 Docker 容器
  if command -v docker &>/dev/null && docker ps --format '{{.Names}}' 2>/dev/null | grep -q "sshweb"; then
    cd "${INSTALL_DIR}" 2>/dev/null || true
    if [ -f "docker-compose.custom.yml" ]; then
      docker compose -f docker-compose.custom.yml down 2>/dev/null || true
    elif [ -f "docker-compose.yml" ]; then
      docker compose down 2>/dev/null || docker-compose down 2>/dev/null || true
    fi
    step_done "Docker 容器已停止"
  fi

  # ──── 步骤 2: 删除文件 ────
  step_info "2/5" "删除项目文件"
  rm -rf "${INSTALL_DIR}"
  rm -rf "${LOG_DIR}"
  step_done "项目文件已删除"

  # ──── 步骤 3: 处理数据库 ────
  step_info "3/5" "处理数据库"
  if [[ "$DROP_DB" == "true" ]]; then
    if command -v docker &>/dev/null && docker volume ls 2>/dev/null | grep -q "sshweb-db-data"; then
      docker volume rm sshweb-db-data 2>/dev/null || true
      step_done "Docker 数据库卷已删除"
    elif command -v mysql &>/dev/null || command -v mariadb &>/dev/null; then
      mysql -u root <<EOF 2>/dev/null || true
DROP DATABASE IF EXISTS \`${DB_NAME}\`;
DROP USER IF EXISTS '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
EOF
      step_done "数据库已删除"
    else
      step_warn "未找到数据库客户端，请手动删除数据库"
    fi
  else
    step_warn "保留数据库"
  fi

  # ──── 步骤 4: 清理 Nginx ────
  step_info "4/5" "清理 Nginx 配置"
  if [ -f /etc/nginx/sites-enabled/sshweb ] || [ -f /etc/nginx/sites-available/sshweb ]; then
    rm -f /etc/nginx/sites-enabled/sshweb
    rm -f /etc/nginx/sites-available/sshweb
    nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
    step_done "Nginx 配置已清理"
  else
    step_warn "未检测到 Nginx 配置"
  fi

  # ──── 步骤 5: 清理残留 ────
  step_info "5/5" "清理残留"
  command -v pm2 &>/dev/null && pm2 save 2>/dev/null || true
  command -v docker &>/dev/null && docker volume rm sshweb-logs 2>/dev/null || true
  step_done "清理完成"

  echo ""
  echo -e "${GREEN}"
  echo "  ╔═══════════════════════════════════════════════╗"
  echo "  ║                                               ║"
  echo "  ║          SSHWeb 已完全卸载!                    ║"
  echo "  ║                                               ║"
  echo "  ╚═══════════════════════════════════════════════╝"
  echo -e "${NC}"
  echo -e "  ${BOLD}以下组件未被卸载 (如需卸载请手动执行):${NC}"
  echo ""
  echo -e "  ${DIM}# 卸载 Node.js${NC}"
  echo -e "  ${DIM}apt-get remove -y nodejs npm${NC}"
  echo ""
  echo -e "  ${DIM}# 卸载 MariaDB (会删除所有数据库)${NC}"
  echo -e "  ${DIM}apt-get remove -y mariadb-server && rm -rf /var/lib/mysql${NC}"
  echo ""
  echo -e "  ${DIM}# 卸载 PM2${NC}"
  echo -e "  ${DIM}npm uninstall -g pm2${NC}"
  echo ""
  echo -e "  ${DIM}# 卸载 Nginx${NC}"
  echo -e "  ${DIM}apt-get remove -y nginx${NC}"
  echo ""
}

# ══════════════════════════════════════════════
# 更新功能
# ══════════════════════════════════════════════

do_update() {
  print_banner
  check_root

  if [ ! -d "${INSTALL_DIR}" ]; then
    step_fail "未检测到 SSHWeb 安装 (${INSTALL_DIR})"
    step_warn "请先执行安装"
    return 1
  fi

  echo -e "  ${BOLD}当前安装目录: ${INSTALL_DIR}${NC}"
  echo ""

  if ! confirm_action "  确认更新 SSHWeb?" "y"; then
    step_warn "已取消更新"
    return 1
  fi

  # ──── 步骤 1: 备份配置 ────
  step_info "1/4" "备份配置文件"
  local BACKUP_ENV="${INSTALL_DIR}/.env.bak.$(date +%Y%m%d%H%M%S)"
  if [ -f "${INSTALL_DIR}/.env" ]; then
    cp "${INSTALL_DIR}/.env" "${BACKUP_ENV}"
    step_done "配置已备份到 ${BACKUP_ENV}"
  fi

  # ──── 步骤 2: 停止服务 ────
  step_info "2/4" "停止服务"
  if command -v pm2 &>/dev/null && pm2 list 2>/dev/null | grep -q "sshweb"; then
    pm2 stop sshweb 2>/dev/null || true
    step_done "服务已停止"
  fi

  # ──── 步骤 3: 更新文件并重新构建 ────
  step_info "3/4" "更新文件并构建"

  # 更新后端
  cp -r "${SCRIPT_DIR}/server/src" "${INSTALL_DIR}/server/"
  cp -r "${SCRIPT_DIR}/server/package.json" "${INSTALL_DIR}/server/"
  cd "${INSTALL_DIR}/server"
  npm install --production
  step_done "后端已更新"

  # 更新前端
  cp -r "${SCRIPT_DIR}/client/src" "${INSTALL_DIR}/client/"
  cp -r "${SCRIPT_DIR}/client/package.json" "${INSTALL_DIR}/client/"
  cd "${INSTALL_DIR}/client"
  npm install
  npm run build
  step_done "前端已更新"

  # 恢复配置
  if [ -f "${BACKUP_ENV}" ]; then
    cp "${BACKUP_ENV}" "${INSTALL_DIR}/.env"
    cp "${BACKUP_ENV}" "${INSTALL_DIR}/server/.env"
  fi

  # ──── 步骤 4: 重启服务 ────
  step_info "4/4" "重启服务"
  pm2 restart sshweb 2>/dev/null || pm2 start "${INSTALL_DIR}/ecosystem.config.js"
  pm2 save
  step_done "服务已重启"

  echo ""
  step_done "SSHWeb 更新完成!"
  echo ""
}

# ══════════════════════════════════════════════
# 状态检查
# ══════════════════════════════════════════════

do_status() {
  print_banner

  echo -e "  ${BOLD}安装状态${NC}"
  print_separator

  # 检查安装目录
  if [ -d "${INSTALL_DIR}" ]; then
    step_done "安装目录: ${INSTALL_DIR}"
  else
    step_fail "安装目录不存在"
    echo ""
    return
  fi

  # 检查配置文件
  if [ -f "${INSTALL_DIR}/.env" ]; then
    step_done "配置文件: ${INSTALL_DIR}/.env"
  else
    step_warn "配置文件不存在"
  fi

  # 检查 PM2 状态
  echo ""
  if command -v pm2 &>/dev/null; then
    echo -e "  ${BOLD}PM2 进程状态${NC}"
    print_separator
    pm2 list 2>/dev/null | grep -E "sshweb|id.*name" || step_warn "未检测到 sshweb 进程"
  else
    step_warn "PM2 未安装"
  fi

  # 检查端口
  if [ -f "${INSTALL_DIR}/.env" ]; then
    local port
    port=$(grep "^APP_PORT=" "${INSTALL_DIR}/.env" | cut -d= -f2)
    port=${port:-18080}
    echo ""
    echo -e "  ${BOLD}端口监听${NC}"
    print_separator
    if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
      step_done "端口 ${port} 已监听"
    else
      step_fail "端口 ${port} 未监听"
    fi
  fi

  echo ""
}

# ══════════════════════════════════════════════
# Docker 安装功能
# ══════════════════════════════════════════════

do_docker_install() {
  print_banner
  check_root
  check_os

  # 检查是否已安装
  if command -v docker &>/dev/null && docker ps --format '{{.Names}}' 2>/dev/null | grep -q "sshweb"; then
    echo -e "${YELLOW}  检测到已运行的 SSHWeb Docker 容器${NC}"
    if confirm_action "  是否先卸载旧容器再重新安装?" "y"; then
      do_uninstall_silent
    else
      echo -e "${YELLOW}  已取消安装${NC}"
      return 1
    fi
  fi

  # 检查项目文件
  if [ ! -f "${SCRIPT_DIR}/Dockerfile" ]; then
    echo -e "${RED}错误: 请在项目根目录运行此脚本${NC}"
    exit 1
  fi

  # ──── 交互式配置 ────
  print_separator
  echo -e "${BOLD}${CYAN}  Docker 安装配置${NC} ${DIM}(直接回车使用默认值)${NC}"
  print_separator

  local APP_PORT DB_EXPOSE_PORT DB_NAME DB_USER DB_PASS DB_ROOT_PASS

  read_default "应用对外端口" "18080" "APP_PORT"
  read_default "数据库对外端口" "3307" "DB_EXPOSE_PORT"
  read_default "数据库名称" "sshweb" "DB_NAME"
  read_default "数据库用户" "sshweb" "DB_USER"
  read_default "数据库密码" "sshweb123456" "DB_PASS"
  read_default "数据库 Root 密码" "rootpassword" "DB_ROOT_PASS"

  # 配置确认
  echo ""
  print_separator
  echo -e "${BOLD}${GREEN}  配置确认${NC}"
  print_separator
  echo -e "  应用端口:         ${BOLD}${APP_PORT}${NC}"
  echo -e "  数据库对外端口:   ${BOLD}${DB_EXPOSE_PORT}${NC}"
  echo -e "  数据库名称:       ${BOLD}${DB_NAME}${NC}"
  echo -e "  数据库用户:       ${BOLD}${DB_USER}${NC}"
  echo -e "  数据库密码:       ${BOLD}${DB_PASS}${NC}"
  echo -e "  数据库 Root 密码: ${BOLD}${DB_ROOT_PASS}${NC}"
  print_separator
  echo ""

  if ! confirm_action "  确认开始安装?" "y"; then
    echo -e "  ${YELLOW}已取消安装${NC}"
    return 1
  fi

  # ──── 步骤 1: 安装 Docker ────
  step_info "1/4" "检查并安装 Docker"

  if ! command -v docker &>/dev/null; then
    echo -e "  ${YELLOW}安装 Docker...${NC}"
    curl -fsSL https://get.docker.com | bash
    systemctl enable docker
    systemctl start docker
    step_done "Docker 安装完成: $(docker --version)"
  else
    step_done "Docker 已安装: $(docker --version)"
  fi

  if ! docker compose version &>/dev/null; then
    echo -e "  ${YELLOW}安装 Docker Compose 插件...${NC}"
    apt-get update -y
    apt-get install -y docker-compose-plugin 2>/dev/null || apt-get install -y docker-compose
  fi
  step_done "Docker Compose: $(docker compose version 2>/dev/null | head -1)"

  # ──── 步骤 2: 生成配置 ────
  step_info "2/4" "生成 Docker Compose 配置"

  local JWT_SECRET ENCRYPTION_KEY
  JWT_SECRET=$(openssl rand -base64 32)
  ENCRYPTION_KEY=$(openssl rand -base64 32)

  mkdir -p "${INSTALL_DIR}"
  cp -r "${SCRIPT_DIR}"/* "${INSTALL_DIR}/"
  cd "${INSTALL_DIR}"

  cat > "${INSTALL_DIR}/docker-compose.custom.yml" <<EOF
version: '3.8'

services:
  sshweb:
    build: .
    container_name: sshweb-app
    restart: always
    ports:
      - "${APP_PORT}:18080"
    environment:
      - NODE_ENV=production
      - MYSQL_HOST=db
      - MYSQL_PORT=3306
      - MYSQL_DATABASE=${DB_NAME}
      - MYSQL_USER=${DB_USER}
      - MYSQL_PASSWORD=${DB_PASS}
      - JWT_SECRET=${JWT_SECRET}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
      - SSH_CONNECT_TIMEOUT=10000
      - SSH_EXEC_TIMEOUT=60000
      - ENABLE_DANGEROUS_COMMAND_BLOCK=true
    depends_on:
      db:
        condition: service_healthy
    networks:
      - sshweb-net
    volumes:
      - sshweb-logs:/var/log/sshweb

  db:
    image: mariadb:11
    container_name: sshweb-db
    restart: always
    environment:
      - MYSQL_ROOT_PASSWORD=${DB_ROOT_PASS}
      - MYSQL_DATABASE=${DB_NAME}
      - MYSQL_USER=${DB_USER}
      - MYSQL_PASSWORD=${DB_PASS}
    volumes:
      - sshweb-db-data:/var/lib/mysql
      - ./database/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql
      - ./database/seed.sql:/docker-entrypoint-initdb.d/02-seed.sql
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - sshweb-net
    ports:
      - "${DB_EXPOSE_PORT}:3306"

networks:
  sshweb-net:
    driver: bridge

volumes:
  sshweb-db-data:
  sshweb-logs:
EOF

  cat > "${INSTALL_DIR}/.env.docker" <<EOF
# SSHWeb Docker 安装配置
# 生成时间: $(date)
APP_PORT=${APP_PORT}
DB_EXPOSE_PORT=${DB_EXPOSE_PORT}
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASS=${DB_PASS}
DB_ROOT_PASS=${DB_ROOT_PASS}
JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
EOF

  step_done "Docker Compose 配置已生成"

  # ──── 步骤 3: 构建镜像 ────
  step_info "3/4" "构建 Docker 镜像 (可能需要几分钟)"

  cd "${INSTALL_DIR}"
  docker compose -f docker-compose.custom.yml build --no-cache
  step_done "镜像构建完成"

  # ──── 步骤 4: 启动服务 ────
  step_info "4/4" "启动 Docker 容器"

  docker compose -f docker-compose.custom.yml up -d
  step_done "容器已启动"

  # ──── 安装验证 ────
  echo ""
  echo -e "${BOLD}${YELLOW}  安装验证${NC}"

  sleep 5
  local APP_STATUS DB_STATUS
  APP_STATUS=$(docker ps --filter "name=sshweb-app" --format "{{.Status}}" 2>/dev/null)
  DB_STATUS=$(docker ps --filter "name=sshweb-db" --format "{{.Status}}" 2>/dev/null)

  if echo "$APP_STATUS" | grep -q "Up"; then
    step_done "应用容器: ${APP_STATUS}"
  else
    step_fail "应用容器: 未运行"
    step_warn "请执行 docker logs sshweb-app 查看错误日志"
  fi

  if echo "$DB_STATUS" | grep -q "Up"; then
    step_done "数据库容器: ${DB_STATUS}"
  else
    step_fail "数据库容器: 未运行"
    step_warn "请执行 docker logs sshweb-db 查看错误日志"
  fi

  sleep 3
  local HTTP_CODE
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://127.0.0.1:${APP_PORT}/" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ]; then
    step_done "HTTP 响应: ${HTTP_CODE} 正常"
  elif [ "$HTTP_CODE" != "000" ]; then
    step_warn "HTTP 响应: ${HTTP_CODE} (服务可能仍在启动)"
  else
    step_fail "HTTP 响应: 无响应"
  fi

  # ──── 安装完成提示 ────
  local SERVER_IP
  SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')

  echo ""
  echo -e "${GREEN}"
  echo "  ╔═══════════════════════════════════════════════╗"
  echo "  ║                                               ║"
  echo "  ║       SSHWeb Docker 安装完成!                  ║"
  echo "  ║                                               ║"
  echo "  ╚═══════════════════════════════════════════════╝"
  echo -e "${NC}"
  echo -e "  ${BOLD}访问信息${NC}"
  print_separator
  echo -e "  地址:  ${CYAN}http://${SERVER_IP}:${APP_PORT}${NC}"
  echo -e "  账号:  ${BOLD}admin${NC}"
  echo -e "  密码:  ${BOLD}admin123${NC}"
  echo ""
  echo -e "  ${BOLD}数据库信息${NC}"
  print_separator
  echo -e "  主机:  localhost"
  echo -e "  端口:  ${DB_EXPOSE_PORT}"
  echo -e "  库名:  ${DB_NAME}"
  echo -e "  用户:  ${DB_USER}"
  echo ""
  echo -e "  ${BOLD}路径信息${NC}"
  print_separator
  echo -e "  项目:      ${INSTALL_DIR}"
  echo -e "  Compose:   ${INSTALL_DIR}/docker-compose.custom.yml"
  echo -e "  环境变量:  ${INSTALL_DIR}/.env.docker"
  echo ""
  echo -e "  ${BOLD}常用命令${NC}"
  print_separator
  echo -e "  docker compose -f docker-compose.custom.yml logs -f       # 查看日志"
  echo -e "  docker compose -f docker-compose.custom.yml restart       # 重启服务"
  echo -e "  docker compose -f docker-compose.custom.yml down          # 停止服务"
  echo -e "  docker compose -f docker-compose.custom.yml up -d         # 启动服务"
  echo -e "  docker compose -f docker-compose.custom.yml ps            # 查看状态"
  echo ""
  echo -e "  ${YELLOW}${BOLD}首次登录后请立即修改默认密码!${NC}"
  echo ""
}

# ══════════════════════════════════════════════
# 主菜单
# ══════════════════════════════════════════════

show_menu() {
  print_banner

  echo -e "  ${BOLD}请选择操作:${NC}"
  echo ""
  echo -e "  ${GREEN}1)${NC} 安装 SSHWeb (PM2 模式)"
  echo -e "  ${GREEN}2)${NC} 安装 SSHWeb (Docker 模式)"
  echo -e "  ${GREEN}3)${NC} 卸载 SSHWeb"
  echo -e "  ${GREEN}4)${NC} 更新 SSHWeb"
  echo -e "  ${GREEN}5)${NC} 查看状态"
  echo -e "  ${RED}0)${NC} 退出"
  echo ""
  read -p "  请输入选项 [0-5]: " choice

  case "$choice" in
    1) do_install ;;
    2) bash "${SCRIPT_DIR}/docker-install.sh" install ;;
    3) do_uninstall ;;
    4) do_update ;;
    5) do_status ;;
    0) echo -e "  ${YELLOW}已退出${NC}"; exit 0 ;;
    *) echo -e "  ${RED}无效选项${NC}"; show_menu ;;
  esac
}

# ──── 入口 ────
case "${1}" in
  install)    do_install ;;
  docker)     bash "${SCRIPT_DIR}/docker-install.sh" install ;;
  uninstall)  do_uninstall ;;
  update)     do_update ;;
  status)     do_status ;;
  *)
    if [ -n "$1" ]; then
      echo -e "${RED}未知参数: $1${NC}"
      echo -e "用法: bash $0 [install|docker|uninstall|update|status]"
      echo -e "      bash $0              # 交互式菜单"
      exit 1
    fi
    show_menu
  ;;
esac
