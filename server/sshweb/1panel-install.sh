#!/bin/bash
#===============================================
# SSHWeb 服务器群控面板 - 1Panel 环境安装脚本
#
# 前提: 已安装 1Panel 面板，并通过 1Panel 安装了
#       MySQL/MariaDB 数据库和 Nginx
#
# 用法: bash 1panel-install.sh
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
echo "║    SSHWeb - 1Panel 环境安装脚本          ║"
echo "║    适用于已安装 1Panel 的服务器          ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

# 检查 root 权限
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}错误: 请使用 root 权限运行此脚本${NC}"
  exit 1
fi

# 检查项目目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ ! -f "${SCRIPT_DIR}/server/package.json" ]; then
  echo -e "${RED}错误: 请在项目根目录运行此脚本${NC}"
  exit 1
fi

# ──── 1Panel 环境检查 ────
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}  1Panel 环境检查${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [ -d "/opt/1panel" ] || command -v 1pctl &> /dev/null; then
  echo -e "${GREEN}  ✓ 检测到 1Panel 环境${NC}"
else
  echo -e "${YELLOW}  ! 未检测到 1Panel，此脚本适用于 1Panel 环境${NC}"
  echo -e "${YELLOW}    如果您没有使用 1Panel，建议使用 install.sh 一键安装脚本${NC}"
  read -p "  是否继续? (y/n) [n]: " CONTINUE
  CONTINUE=${CONTINUE:-n}
  if [ "$CONTINUE" != "y" ] && [ "$CONTINUE" != "Y" ]; then
    exit 0
  fi
fi

# ──── 数据库配置引导 ────
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}  数据库配置${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${CYAN}  ┌─────────────────────────────────────────────────────┐${NC}"
echo -e "${CYAN}  │  ${YELLOW}1Panel 数据库准备步骤:${NC}"
echo -e "${CYAN}  │${NC}"
echo -e "${CYAN}  │  ${GREEN}1.${NC} 登录 1Panel 管理面板"
echo -e "${CYAN}  │  ${GREEN}2.${NC} 进入 [数据库] → [MySQL] 菜单"
echo -e "${CYAN}  │  ${GREEN}3.${NC} 点击 [创建数据库]"
echo -e "${CYAN}  │     - 数据库名称: sshweb (或自定义)"
echo -e "${CYAN}  │     - 用户名:     sshweb (或自定义)"
echo -e "${CYAN}  │     - 密码:       点击生成或自定义"
echo -e "${CYAN}  │     - 权限:       所有人 (%) 或 本地 (localhost)"
echo -e "${CYAN}  │  ${GREEN}4.${NC} 点击确认创建"
echo -e "${CYAN}  │  ${GREEN}5.${NC} 记录数据库名、用户名、密码，下面需要填写${NC}"
echo -e "${CYAN}  └─────────────────────────────────────────────────────┘${NC}"
echo ""

# 检查 1Panel MySQL 容器
DB_MYSQL_HOST="localhost"
# 1Panel 数据库通常在 Docker 容器中运行
# 如果本机有 Docker 的 MySQL，需要用容器名或 IP 连接
if command -v docker &> /dev/null; then
  MYSQL_CONTAINER=$(docker ps --format '{{.Names}}' | grep -i mysql | head -1)
  if [ -n "$MYSQL_CONTAINER" ]; then
    echo -e "${GREEN}  检测到 1Panel MySQL 容器: ${MYSQL_CONTAINER}${NC}"
    # 获取容器 IP
    CONTAINER_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${MYSQL_CONTAINER} 2>/dev/null || echo "")
    if [ -n "$CONTAINER_IP" ]; then
      echo -e "${GREEN}  容器 IP: ${CONTAINER_IP}${NC}"
      read -p "  使用容器 IP 作为数据库主机? (y/n) [y]: " USE_CONTAINER_IP
      USE_CONTAINER_IP=${USE_CONTAINER_IP:-y}
      if [ "$USE_CONTAINER_IP" = "y" ] || [ "$USE_CONTAINER_IP" = "Y" ]; then
        DB_MYSQL_HOST=${CONTAINER_IP}
      fi
    fi
  fi
fi

echo ""
echo -e "${YELLOW}  请输入在 1Panel 中创建的数据库信息:${NC}"
echo ""

read -p "  数据库主机 [${DB_MYSQL_HOST}]: " INPUT_HOST
DB_MYSQL_HOST=${INPUT_HOST:-$DB_MYSQL_HOST}

read -p "  数据库端口 [3306]: " DB_PORT
DB_PORT=${DB_PORT:-3306}

read -p "  数据库名称 [sshweb]: " DB_NAME
DB_NAME=${DB_NAME:-sshweb}

read -p "  数据库用户 [sshweb]: " DB_USER
DB_USER=${DB_USER:-sshweb}

read -p "  数据库密码: " DB_PASS
if [ -z "$DB_PASS" ]; then
  echo -e "${RED}  错误: 数据库密码不能为空${NC}"
  exit 1
fi

# 测试数据库连接
echo ""
echo -e "${YELLOW}  测试数据库连接...${NC}"
if mysql -h "${DB_MYSQL_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASS}" -e "USE \`${DB_NAME}\`;" 2>/dev/null; then
  echo -e "${GREEN}  ✓ 数据库连接成功${NC}"
else
  echo -e "${RED}  ✗ 数据库连接失败${NC}"
  echo -e "${YELLOW}  请检查:${NC}"
  echo -e "    1. 数据库是否已在 1Panel 中创建"
  echo -e "    2. 数据库用户权限是否正确"
  echo -e "    3. 数据库主机地址是否正确 (容器 IP / localhost)"
  echo -e "    4. 数据库访问权限是否设置为 所有人(%)"
  exit 1
fi

# ──── 应用端口配置 ────
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}  应用配置${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

read -p "  应用监听端口 [18080]: " APP_PORT
APP_PORT=${APP_PORT:-18080}
echo -e "  (${YELLOW}此端口为内部端口，通过 1Panel 反向代理对外访问${NC})"

# ──── 确认安装 ────
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  安装配置确认:${NC}"
echo -e "    应用端口:     ${APP_PORT}"
echo -e "    数据库主机:   ${DB_MYSQL_HOST}"
echo -e "    数据库端口:   ${DB_PORT}"
echo -e "    数据库名称:   ${DB_NAME}"
echo -e "    数据库用户:   ${DB_USER}"
echo -e "    数据库密码:   ${DB_PASS}"
echo -e "    项目目录:     ${INSTALL_DIR}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
read -p "  确认开始安装? (y/n) [y]: " CONFIRM
CONFIRM=${CONFIRM:-y}
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "已取消安装"
  exit 0
fi
echo ""

# ──── 步骤 1: Node.js ────
echo -e "${YELLOW}[1/6] 检查并安装 Node.js...${NC}"
if ! command -v node &> /dev/null; then
  echo -e "${YELLOW}       安装 Node.js 20.x...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo -e "${GREEN}       Node.js $(node -v) / npm $(npm -v)${NC}"

# ──── 步骤 2: 部署文件 ────
echo -e "${YELLOW}[2/6] 部署项目文件...${NC}"
mkdir -p ${INSTALL_DIR}
mkdir -p ${LOG_DIR}
cp -r ${SCRIPT_DIR}/* ${INSTALL_DIR}/
cp -r ${SCRIPT_DIR}/.env.example ${INSTALL_DIR}/.env.example 2>/dev/null || true
cd ${INSTALL_DIR}

# ──── 步骤 3: 初始化数据库表 ────
echo -e "${YELLOW}[3/6] 初始化数据库表结构...${NC}"
TEMP_SCHEMA=$(mktemp)
sed "s/CREATE DATABASE IF NOT EXISTS \`sshweb\`/CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`/g; s/USE \`sshweb\`/USE \`${DB_NAME}\`/g" \
  ${INSTALL_DIR}/database/schema.sql > ${TEMP_SCHEMA}

TEMP_SEED=$(mktemp)
sed "s/USE \`sshweb\`/USE \`${DB_NAME}\`/g" \
  ${INSTALL_DIR}/database/seed.sql > ${TEMP_SEED}

mysql -h "${DB_MYSQL_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASS}" < ${TEMP_SCHEMA}
mysql -h "${DB_MYSQL_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASS}" < ${TEMP_SEED}
rm -f ${TEMP_SCHEMA} ${TEMP_SEED}
echo -e "${GREEN}       数据库表结构初始化完成${NC}"

# ──── 步骤 4: 构建 ────
echo -e "${YELLOW}[4/6] 安装后端依赖并构建前端...${NC}"
cd ${INSTALL_DIR}/server
npm install --production

cd ${INSTALL_DIR}/client
npm install
npm run build

# ──── 步骤 5: 生成配置文件 ────
echo -e "${YELLOW}[5/6] 生成配置文件...${NC}"
JWT_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -base64 32)

cat > ${INSTALL_DIR}/.env <<EOF
APP_NAME=SSHWeb
APP_PORT=3000
NODE_ENV=production

MYSQL_HOST=${DB_MYSQL_HOST}
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

# ──── 步骤 6: PM2 启动 ────
echo -e "${YELLOW}[6/6] 安装 PM2 并启动服务...${NC}"
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

sleep 2
PM2_STATUS=$(pm2 jlist 2>/dev/null | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ "$PM2_STATUS" = "online" ]; then
  echo -e "${GREEN}  ✓ 服务进程: 运行中 (online)${NC}"
else
  echo -e "${RED}  ✗ 服务进程: ${PM2_STATUS:-未检测到}${NC}"
  echo -e "${YELLOW}    请执行 pm2 logs sshweb 查看错误日志${NC}"
fi

sleep 2
if ss -tlnp 2>/dev/null | grep -q ":${APP_PORT} " || netstat -tlnp 2>/dev/null | grep -q ":${APP_PORT} "; then
  echo -e "${GREEN}  ✓ 端口监听: ${APP_PORT} 已就绪${NC}"
else
  echo -e "${RED}  ✗ 端口监听: ${APP_PORT} 未检测到${NC}"
fi

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
echo "╔══════════════════════════════════════════╗"
echo "║       SSHWeb 1Panel 安装完成!             ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  访问地址:  http://$(hostname -I | awk '{print $1}'):${APP_PORT}"
echo "  默认账号:  admin"
echo "  默认密码:  admin123"
echo ""
echo "  项目目录:  ${INSTALL_DIR}"
echo "  日志目录:  ${LOG_DIR}"
echo "  配置文件:  ${INSTALL_DIR}/.env"
echo ""
echo "  ─── 1Panel Nginx 反向代理配置 ───"
echo ""
echo "  如需通过 1Panel 配置域名访问，请在 1Panel 中:"
echo "    1. 进入 [网站] → [创建网站]"
echo "    2. 选择 [反向代理]"
echo "    3. 代理地址填写: http://127.0.0.1:${APP_PORT}"
echo "    4. 配置域名和 SSL 证书"
echo ""
echo "  常用命令:"
echo "    pm2 status          # 查看服务状态"
echo "    pm2 logs sshweb     # 查看日志"
echo "    pm2 restart sshweb  # 重启服务"
echo "    pm2 stop sshweb     # 停止服务"
echo ""
echo -e "  ${YELLOW}首次登录后请立即修改默认密码!${NC}"
echo -e "${NC}"
