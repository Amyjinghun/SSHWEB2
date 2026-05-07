#!/bin/bash
#===============================================
# SSHWeb 服务器群控面板 - Debian 安装脚本
# 用法: bash install.sh
#===============================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

INSTALL_DIR="/opt/sshweb"
LOG_DIR="/var/log/sshweb"
DB_NAME="sshweb"
DB_USER="sshweb"
DB_PASS="sshweb123456"
NODE_MIN_MAJOR=18
WEB_PORT=80
APP_PORT=${APP_PORT:-3000}

info() { echo -e "${YELLOW}$1${NC}"; }
ok() { echo -e "${GREEN}$1${NC}"; }
err() { echo -e "${RED}$1${NC}"; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

node_major() {
  node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1
}

install_nodejs() {
  local major=""
  if need_cmd node; then
    major="$(node_major)"
  fi

  if [ -n "$major" ] && [ "$major" -ge "$NODE_MIN_MAJOR" ] && need_cmd npm; then
    ok "[✓] Node.js $(node -v)，npm $(npm -v)"
    return 0
  fi

  info "检测到 Node.js/npm 不满足要求，正在安装 Node.js ${NODE_MIN_MAJOR}.x..."

  # 避免 Debian 自带 npm 与 NodeSource nodejs 冲突
  apt-get remove -y npm nodejs-legacy libnode72 2>/dev/null || true

  curl -fsSL https://deb.nodesource.com/setup_${NODE_MIN_MAJOR}.x | bash -
  apt-get install -y nodejs

  if ! need_cmd node || ! need_cmd npm; then
    err "Node.js/npm 安装失败，请检查 NodeSource 源或网络环境"
    exit 1
  fi

  ok "[✓] Node.js $(node -v)，npm $(npm -v)"
}

install_mariadb() {
  if dpkg -s mariadb-server >/dev/null 2>&1 || dpkg -s default-mysql-server >/dev/null 2>&1 || dpkg -s mysql-server >/dev/null 2>&1; then
    ok "[✓] MySQL/MariaDB 已安装"
    return 0
  fi

  info "MySQL/MariaDB 未安装，正在安装 MariaDB..."
  apt-get install -y mariadb-server
}

echo -e "${BLUE}"
echo "============================================"
echo "  SSHWeb 服务器群控面板 - 安装脚本"
echo "  适用于 Debian 11/12 系统"
echo "============================================"
echo -e "${NC}"

if [ "$EUID" -ne 0 ]; then
  err "请使用 root 权限运行此脚本"
  exit 1
fi


info "[0/8] 安装参数配置..."
read -rp "请输入Web访问端口 [80]: " INPUT_WEB_PORT
WEB_PORT="${INPUT_WEB_PORT:-80}"
if ! [[ "$WEB_PORT" =~ ^[0-9]+$ ]] || [ "$WEB_PORT" -lt 1 ] || [ "$WEB_PORT" -gt 65535 ]; then
  err "Web访问端口必须是 1-65535 的数字"
  exit 1
fi

# Node 后端只监听本机，由 Nginx 对外代理。避免与 Web 访问端口冲突。
APP_PORT=${APP_PORT}
if [ "$WEB_PORT" = "3000" ]; then
  APP_PORT=3001
fi

ok "[✓] Web访问端口: ${WEB_PORT}，后端内部端口: ${APP_PORT}"
ok "[✓] Telegram 通知请安装完成后在 Web 后台：安全中心 -> 告警通知（系统设置里的通知告警配置也保留） 中配置"


info "[1/8] 更新系统并安装基础依赖..."
apt-get update -y
# 注意：不要 apt install npm。NodeSource 的 nodejs 包自带 npm，Debian npm 会与其冲突。
apt-get install -y curl wget git unzip ca-certificates gnupg openssl nginx
install_nodejs
install_mariadb

info "[2/8] 配置 MariaDB 数据库..."
systemctl enable mariadb >/dev/null 2>&1 || systemctl enable mysql >/dev/null 2>&1 || true
systemctl start mariadb >/dev/null 2>&1 || systemctl start mysql >/dev/null 2>&1 || true

mysql -u root <<SQLDB
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
ALTER USER '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'127.0.0.1';
FLUSH PRIVILEGES;
SQLDB

ok "数据库创建完成"

info "[3/8] 部署项目文件..."
mkdir -p "${INSTALL_DIR}" "${LOG_DIR}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "${SCRIPT_DIR}/server/package.json" ]; then
  if need_cmd rsync; then
    rsync -a --delete --exclude node_modules --exclude dist --exclude .git "${SCRIPT_DIR}/" "${INSTALL_DIR}/"
  else
    rm -rf "${INSTALL_DIR:?}"/*
    cp -a "${SCRIPT_DIR}/"* "${INSTALL_DIR}/"
  fi
else
  err "请在项目根目录运行此脚本"
  exit 1
fi

cd "${INSTALL_DIR}"

info "[4/8] 初始化数据库..."
mysql -u root "${DB_NAME}" < "${INSTALL_DIR}/database/schema.sql"
mysql -u root "${DB_NAME}" < "${INSTALL_DIR}/database/seed.sql"

# 兼容旧库升级：补充服务器到期字段和索引
mysql -u root "${DB_NAME}" <<'SQLMIG'
SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'servers' AND COLUMN_NAME = 'expires_at');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE servers ADD COLUMN expires_at DATE NULL COMMENT ''服务器到期日期'' AFTER last_connected_at', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'servers' AND INDEX_NAME = 'idx_expires_at');
SET @sql := IF(@idx_exists = 0, 'ALTER TABLE servers ADD INDEX idx_expires_at (expires_at)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SQLMIG

# 初始化 Telegram 与告警默认配置。实际 Bot Token / Chat ID 请在 Web 后台配置。
mysql -u root "${DB_NAME}" <<'SQLSET'
INSERT IGNORE INTO settings (setting_key, setting_value, description) VALUES
('tg_enabled', 'false', '是否启用Telegram通知'),
('tg_bot_token', '', 'Telegram Bot Token'),
('tg_chat_id', '', 'Telegram Chat ID'),
('alert_enable_offline', 'true', '启用服务器离线告警'),
('alert_enable_cpu', 'true', '启用CPU使用率告警'),
('alert_enable_memory', 'true', '启用内存使用率告警'),
('alert_enable_disk', 'false', '启用磁盘使用率告警'),
('alert_enable_expiry', 'true', '启用服务器到期提醒'),
('alert_cpu_threshold', '90', 'CPU使用率告警阈值百分比'),
('alert_memory_threshold', '90', '内存使用率告警阈值百分比'),
('alert_disk_threshold', '90', '磁盘使用率告警阈值百分比'),
('alert_server_expiry_days', '2', '服务器到期提前提醒天数'),
('alert_repeat_hours', '12', '相同告警重复提醒间隔小时'),
('alert_template_offline', '', '服务器离线通知模板'),
('alert_template_cpu', '', 'CPU告警通知模板'),
('alert_template_memory', '', '内存告警通知模板'),
('alert_template_disk', '', '磁盘告警通知模板'),
('alert_template_expiry', '', '服务器即将到期通知模板'),
('alert_template_expired', '', '服务器已到期通知模板'),
('server_monitor_concurrency', '5', '服务器状态检测并发数');
UPDATE settings SET setting_value='2' WHERE setting_key='alert_server_expiry_days' AND setting_value IN ('', '7');
SQLSET


info "[5/8] 安装后端依赖并构建前端..."
cd "${INSTALL_DIR}/server"
npm install --omit=dev

cd "${INSTALL_DIR}/client"
npm install
npm run build

info "[6/8] 生成配置文件..."
JWT_SECRET="$(openssl rand -base64 32)"
ENCRYPTION_KEY="$(openssl rand -base64 32)"

cat > "${INSTALL_DIR}/.env" <<ENVFILE
APP_NAME=SSHWeb
APP_PORT=${APP_PORT}
NODE_ENV=production
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_DATABASE=${DB_NAME}
MYSQL_USER=${DB_USER}
MYSQL_PASSWORD=${DB_PASS}
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=7d
ENCRYPTION_KEY=${ENCRYPTION_KEY}
SSH_CONNECT_TIMEOUT=10000
SSH_EXEC_TIMEOUT=60000
ENABLE_DANGEROUS_COMMAND_BLOCK=true
ENVFILE

cp "${INSTALL_DIR}/.env" "${INSTALL_DIR}/server/.env"

info "[7/8] 安装 PM2 并启动服务..."
npm install -g pm2

cd "${INSTALL_DIR}"
if [ -f "${INSTALL_DIR}/ecosystem.config.js" ]; then
  sed -i "s|cwd: '/opt/sshweb'|cwd: '${INSTALL_DIR}'|g" "${INSTALL_DIR}/ecosystem.config.js" || true
  pm2 delete sshweb >/dev/null 2>&1 || true
  pm2 start "${INSTALL_DIR}/ecosystem.config.js"
else
  pm2 delete sshweb >/dev/null 2>&1 || true
  pm2 start "${INSTALL_DIR}/server/src/app.js" --name sshweb --cwd "${INSTALL_DIR}"
fi
pm2 save
pm2 startup systemd -u root --hp /root || true

info "[8/8] 配置 Nginx 反向代理..."
cat > /etc/nginx/sites-available/sshweb <<NGINXCONF
server {
    listen ${WEB_PORT};
    server_name _;

    client_max_body_size 100M;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400;
    }
}
NGINXCONF

ln -sf /etc/nginx/sites-available/sshweb /etc/nginx/sites-enabled/sshweb
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

ok ""
ok "============================================"
ok "  SSHWeb 安装完成！"
ok "============================================"
echo ""
if [ "${WEB_PORT}" = "80" ]; then
  echo "  访问地址: http://$(hostname -I | awk '{print $1}')"
else
  echo "  访问地址: http://$(hostname -I | awk '{print $1}'):${WEB_PORT}"
fi
echo "  默认账号: admin"
echo "  默认密码: admin123"
echo ""
echo "  项目目录: ${INSTALL_DIR}"
echo "  日志目录: ${LOG_DIR}"
echo "  配置文件: ${INSTALL_DIR}/.env"
echo "  Telegram通知: 请登录后台 安全中心 -> 告警通知（系统设置里的通知告警配置也保留） 配置"
echo ""
echo "  常用命令:"
echo "    pm2 status          # 查看服务状态"
echo "    pm2 logs sshweb     # 查看日志"
echo "    pm2 restart sshweb  # 重启服务"
echo "    pm2 stop sshweb     # 停止服务"
ok "============================================"
