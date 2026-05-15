#!/bin/bash
#===============================================
# SSHWeb 服务器群控面板 - Docker 安装脚本
# 用法: bash docker-install.sh
#===============================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════╗"
echo "║    SSHWeb - Docker 安装脚本              ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}错误: 请使用 root 权限运行此脚本${NC}"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ ! -f "${SCRIPT_DIR}/docker-compose.yml" ]; then
  echo -e "${RED}错误: 请在项目根目录运行此脚本${NC}"
  exit 1
fi

# ──── 交互式配置 ────
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}  Docker 安装配置 (直接回车使用默认值)${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# 应用端口
read -p "  应用对外端口 [18080]: " APP_PORT
APP_PORT=${APP_PORT:-18080}

# 数据库端口
read -p "  数据库对外端口 [3307]: " DB_EXPOSE_PORT
DB_EXPOSE_PORT=${DB_EXPOSE_PORT:-3307}

# 数据库名称
read -p "  数据库名称 [sshweb]: " DB_NAME
DB_NAME=${DB_NAME:-sshweb}

# 数据库用户
read -p "  数据库用户 [sshweb]: " DB_USER
DB_USER=${DB_USER:-sshweb}

# 数据库密码
read -p "  数据库密码 [sshweb123456]: " DB_PASS
DB_PASS=${DB_PASS:-sshweb123456}

# 数据库 Root 密码
read -p "  数据库 Root 密码 [rootpassword]: " DB_ROOT_PASS
DB_ROOT_PASS=${DB_ROOT_PASS:-rootpassword}

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  配置摘要:${NC}"
echo -e "    应用端口:       ${APP_PORT}"
echo -e "    数据库对外端口: ${DB_EXPOSE_PORT}"
echo -e "    数据库名称:     ${DB_NAME}"
echo -e "    数据库用户:     ${DB_USER}"
echo -e "    数据库密码:     ${DB_PASS}"
echo -e "    数据库 Root 密码: ${DB_ROOT_PASS}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
read -p "  确认开始安装? (y/n) [y]: " CONFIRM
CONFIRM=${CONFIRM:-y}
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "已取消安装"
  exit 0
fi
echo ""

# ──── 步骤 1: 安装 Docker ────
echo -e "${YELLOW}[1/4] 检查并安装 Docker...${NC}"
if ! command -v docker &> /dev/null; then
  echo -e "${YELLOW}       安装 Docker...${NC}"
  curl -fsSL https://get.docker.com | bash
  systemctl enable docker
  systemctl start docker
  echo -e "${GREEN}       Docker 安装完成${NC}"
else
  echo -e "${GREEN}       Docker 已安装: $(docker --version)${NC}"
fi

if ! docker compose version &> /dev/null; then
  echo -e "${YELLOW}       安装 Docker Compose 插件...${NC}"
  apt-get update -y
  apt-get install -y docker-compose-plugin 2>/dev/null || apt-get install -y docker-compose
fi

# ──── 步骤 2: 生成配置 ────
echo -e "${YELLOW}[2/4] 生成 Docker Compose 配置...${NC}"
JWT_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -base64 32)

# 生成自定义 docker-compose 文件
cat > ${SCRIPT_DIR}/docker-compose.custom.yml <<EOF
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

# 同时生成 .env 文件供参考
cat > ${SCRIPT_DIR}/.env.docker <<EOF
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

# ──── 步骤 3: 构建镜像 ────
echo -e "${YELLOW}[3/4] 构建 Docker 镜像 (可能需要几分钟)...${NC}"
cd ${SCRIPT_DIR}
docker compose -f docker-compose.custom.yml build --no-cache

# ──── 步骤 4: 启动服务 ────
echo -e "${YELLOW}[4/4] 启动 Docker 容器...${NC}"
docker compose -f docker-compose.custom.yml up -d

# ──── 安装验证 ────
echo ""
echo -e "${YELLOW}  正在验证安装...${NC}"

sleep 5
APP_RUNNING=$(docker ps --filter "name=sshweb-app" --format "{{.Status}}" 2>/dev/null)
DB_RUNNING=$(docker ps --filter "name=sshweb-db" --format "{{.Status}}" 2>/dev/null)

if echo "$APP_RUNNING" | grep -q "Up"; then
  echo -e "${GREEN}  ✓ 应用容器: ${APP_RUNNING}${NC}"
else
  echo -e "${RED}  ✗ 应用容器: 未运行${NC}"
fi

if echo "$DB_RUNNING" | grep -q "Up"; then
  echo -e "${GREEN}  ✓ 数据库容器: ${DB_RUNNING}${NC}"
else
  echo -e "${RED}  ✗ 数据库容器: 未运行${NC}"
fi

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://127.0.0.1:${APP_PORT}/ 2>/dev/null || echo "000")
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
echo "║       SSHWeb Docker 安装完成!             ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  访问地址:      http://$(hostname -I | awk '{print $1}'):${APP_PORT}"
echo "  默认账号:      admin"
echo "  默认密码:      admin123"
echo ""
echo "  数据库信息:"
echo "    主机:        localhost"
echo "    端口:        ${DB_EXPOSE_PORT}"
echo "    数据库名:    ${DB_NAME}"
echo "    用户名:      ${DB_USER}"
echo "    密码:        ${DB_PASS}"
echo ""
echo "  配置文件:"
echo "    Compose:     docker-compose.custom.yml"
echo "    环境变量:    .env.docker"
echo ""
echo "  常用命令:"
echo "    docker compose -f docker-compose.custom.yml logs -f       # 查看日志"
echo "    docker compose -f docker-compose.custom.yml restart       # 重启服务"
echo "    docker compose -f docker-compose.custom.yml down          # 停止服务"
echo "    docker compose -f docker-compose.custom.yml up -d         # 启动服务"
echo "    docker compose -f docker-compose.custom.yml ps            # 查看状态"
echo ""
echo -e "  ${YELLOW}首次登录后请立即修改默认密码!${NC}"
echo -e "${NC}"
