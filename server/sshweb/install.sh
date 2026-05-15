#!/bin/bash
#===============================================
# SSHWeb 服务器群控面板 - 一键安装脚本
# 支持 Debian 11/12 / Ubuntu 20.04+
# 用法: bash install.sh
#===============================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

INSTALL_DIR="/opt/sshweb"
LOG_DIR="/var/log/sshweb"

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════╗"
echo "║    SSHWeb 服务器群控面板 - 一键安装      ║"
echo "║    适用于 Debian/Ubuntu 系统             ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

# 检查 root 权限
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}错误: 请使用 root 权限运行此脚本${NC}"
  exit 1
fi

# 检查是否在项目目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ ! -f "${SCRIPT_DIR}/server/package.json" ]; then
  echo -e "${RED}错误: 请在项目根目录运行此脚本${NC}"
  exit 1
fi

# ──── 交互式配置 ────
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}  安装配置 (直接回车使用默认值)${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# 应用端口
read -p "  应用端口 [18080]: " APP_PORT
APP_PORT=${APP_PORT:-18080}

# 是否使用已有数据库
read -p "  是否使用已有的 MySQL/MariaDB? (y/n) [n]: " USE_EXISTING_DB
USE_EXISTING_DB=${USE_EXISTING_DB:-n}

# 数据库配置
if [ "$USE_EXISTING_DB" = "y" ] || [ "$USE_EXISTING_DB" = "Y" ]; then
  read -p "  数据库主机 [localhost]: " DB_HOST
  DB_HOST=${DB_HOST:-localhost}
  read -p "  数据库端口 [3306]: " DB_PORT
  DB_PORT=${DB_PORT:-3306}
else
  DB_HOST="localhost"
  DB_PORT="3306"
fi

read -p "  数据库名称 [sshweb]: " DB_NAME
DB_NAME=${DB_NAME:-sshweb}

read -p "  数据库用户 [sshweb]: " DB_USER
DB_USER=${DB_USER:-sshweb}

read -p "  数据库密码 [sshweb123456]: " DB_PASS
DB_PASS=${DB_PASS:-sshweb123456}

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  配置摘要:${NC}"
echo -e "    应用端口:     ${APP_PORT}"
echo -e "    数据库主机:   ${DB_HOST}"
echo -e "    数据库端口:   ${DB_PORT}"
echo -e "    数据库名称:   ${DB_NAME}"
echo -e "    数据库用户:   ${DB_USER}"
echo -e "    数据库密码:   ${DB_PASS}"
echo -e "    使用已有数据库: ${USE_EXISTING_DB}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
read -p "  确认开始安装? (y/n) [y]: " CONFIRM
CONFIRM=${CONFIRM:-y}
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "已取消安装"
  exit 0
fi
echo ""

# ──── 步骤 1: 系统依赖 ────
echo -e "${YELLOW}[1/7] 安装系统依赖...${NC}"
apt-get update -y
apt-get install -y curl wget git unzip mariadb-client openssl

# Node.js
if ! command -v node &> /dev/null; then
  echo -e "${YELLOW}       安装 Node.js 20.x...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo -e "${GREEN}       Node.js $(node -v) / npm $(npm -v)${NC}"

# ──── 步骤 2: 数据库 ────
echo -e "${YELLOW}[2/7] 配置数据库...${NC}"
if [ "$USE_EXISTING_DB" = "y" ] || [ "$USE_EXISTING_DB" = "Y" ]; then
  echo -e "${YELLOW}       使用已有数据库，跳过安装 MariaDB${NC}"
  if mysql -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASS}" -e "USE \`${DB_NAME}\`;" 2>/dev/null; then
    echo -e "${GREEN}       数据库连接成功${NC}"
  else
    echo -e "${RED}       数据库连接失败，请检查配置${NC}"
    exit 1
  fi
else
  if ! command -v mysql &> /dev/null && ! command -v mariadb &> /dev/null; then
    echo -e "${YELLOW}       安装 MariaDB...${NC}"
    apt-get install -y mariadb-server
  fi
  systemctl enable mariadb
  systemctl start mariadb

  mysql -u root <<EOF
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
EOF
  echo -e "${GREEN}       MariaDB 已配置${NC}"
fi

# ──── 步骤 3: 部署文件 ────
echo -e "${YELLOW}[3/7] 部署项目文件...${NC}"
mkdir -p ${INSTALL_DIR}
mkdir -p ${LOG_DIR}
cp -r ${SCRIPT_DIR}/* ${INSTALL_DIR}/
cp -r ${SCRIPT_DIR}/.env.example ${INSTALL_DIR}/.env.example 2>/dev/null || true
cd ${INSTALL_DIR}

# ──── 步骤 4: 初始化数据库 ────
echo -e "${YELLOW}[4/7] 初始化数据库表结构...${NC}"
TEMP_SCHEMA=$(mktemp)
sed "s/CREATE DATABASE IF NOT EXISTS \`sshweb\`/CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`/g; s/USE \`sshweb\`/USE \`${DB_NAME}\`/g" \
  ${INSTALL_DIR}/database/schema.sql > ${TEMP_SCHEMA}

TEMP_SEED=$(mktemp)
sed "s/USE \`sshweb\`/USE \`${DB_NAME}\`/g" \
  ${INSTALL_DIR}/database/seed.sql > ${TEMP_SEED}

mysql -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASS}" < ${TEMP_SCHEMA}
mysql -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASS}" < ${TEMP_SEED}
rm -f ${TEMP_SCHEMA} ${TEMP_SEED}
echo -e "${GREEN}       数据库初始化完成${NC}"

# ──── 步骤 5: 安装依赖 & 构建 ────
echo -e "${YELLOW}[5/7] 安装后端依赖并构建前端...${NC}"
cd ${INSTALL_DIR}/server
npm install --production

cd ${INSTALL_DIR}/client
npm install
npm run build

# ──── 步骤 6: 生成配置文件 ────
echo -e "${YELLOW}[6/7] 生成配置文件...${NC}"
JWT_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -base64 32)

cat > ${INSTALL_DIR}/.env <<EOF
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

cp ${INSTALL_DIR}/.env ${INSTALL_DIR}/server/.env

# ──── 步骤 7: PM2 启动 ────
echo -e "${YELLOW}[7/7] 安装 PM2 并启动服务...${NC}"
if ! command -v pm2 &> /dev/null; then
  npm install -g pm2
fi

sed -i "s|cwd: '/opt/sshweb'|cwd: '${INSTALL_DIR}'|g" ${INSTALL_DIR}/ecosystem.config.js
pm2 start ${INSTALL_DIR}/ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

# ──── 安装验证 ────
echo ""
echo -e "${YELLOW}  正在验证安装...${NC}"

# 检查 PM2 进程状态
sleep 2
PM2_STATUS=$(pm2 jlist 2>/dev/null | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ "$PM2_STATUS" = "online" ]; then
  echo -e "${GREEN}  ✓ 服务进程: 运行中 (online)${NC}"
else
  echo -e "${RED}  ✗ 服务进程: ${PM2_STATUS:-未检测到}${NC}"
  echo -e "${YELLOW}    请执行 pm2 logs sshweb 查看错误日志${NC}"
fi

# 检查端口监听
sleep 2
if ss -tlnp 2>/dev/null | grep -q ":${APP_PORT} " || netstat -tlnp 2>/dev/null | grep -q ":${APP_PORT} "; then
  echo -e "${GREEN}  ✓ 端口监听: ${APP_PORT} 已就绪${NC}"
else
  echo -e "${RED}  ✗ 端口监听: ${APP_PORT} 未检测到${NC}"
fi

# HTTP 请求测试
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:${APP_PORT}/ 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ]; then
  echo -e "${GREEN}  ✓ HTTP 响应: ${HTTP_CODE} 正常${NC}"
elif [ "$HTTP_CODE" != "000" ]; then
  echo -e "${YELLOW}  ! HTTP 响应: ${HTTP_CODE} (前端可能仍在加载)${NC}"
else
  echo -e "${RED}  ✗ HTTP 响应: 无响应${NC}"
fi

echo ""
echo -e "${GREEN}"
echo "╔══════════════════════════════════════════════╗"
echo "║           SSHWeb 一键安装完成!                ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "  访问地址:  http://$(hostname -I | awk '{print $1}'):${APP_PORT}"
echo "  默认账号:  admin"
echo "  默认密码:  admin123"
echo ""
echo "  项目目录:  ${INSTALL_DIR}"
echo "  日志目录:  ${LOG_DIR}"
echo "  配置文件:  ${INSTALL_DIR}/.env"
echo ""
echo "  常用命令:"
echo "    pm2 status          # 查看服务状态"
echo "    pm2 logs sshweb     # 查看日志"
echo "    pm2 restart sshweb  # 重启服务"
echo "    pm2 stop sshweb     # 停止服务"
echo ""
echo -e "  ${YELLOW}首次登录后请立即修改默认密码!${NC}"
echo -e "${NC}"
