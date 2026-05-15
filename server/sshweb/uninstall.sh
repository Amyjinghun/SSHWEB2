#!/bin/bash
#===============================================
# SSHWeb 服务器群控面板 - 统一卸载脚本
# 支持: 一键安装 / 1Panel安装 / Docker安装
# 用法: bash uninstall.sh
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

echo -e "${RED}"
echo "╔══════════════════════════════════════════╗"
echo "║         SSHWeb 卸载脚本                   ║"
echo "║     警告: 此操作将完全删除 SSHWeb!        ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}错误: 请使用 root 权限运行此脚本${NC}"
  exit 1
fi

# ──── 检测安装方式 ────
INSTALL_TYPE="unknown"
HAS_PM2=false
HAS_DOCKER=false

if [ -d "${INSTALL_DIR}" ]; then
  if [ -f "${INSTALL_DIR}/docker-compose.custom.yml" ] || [ -f "${INSTALL_DIR}/docker-compose.yml" ]; then
    # 检查是否有运行中的 Docker 容器
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "sshweb"; then
      HAS_DOCKER=true
    fi
  fi
  if command -v pm2 &> /dev/null && pm2 list 2>/dev/null | grep -q "sshweb"; then
    HAS_PM2=true
  fi

  if $HAS_DOCKER; then
    INSTALL_TYPE="docker"
  elif $HAS_PM2; then
    INSTALL_TYPE="pm2"
  fi
fi

echo -e "${YELLOW}  检测到安装方式: ${INSTALL_TYPE}${NC}"
echo ""

# ──── 确认卸载 ────
echo -e "${RED}  ┌───────────────────────────────────────────┐${NC}"
echo -e "${RED}  │  即将执行以下操作:                         │${NC}"
echo -e "${RED}  │  • 停止并删除 SSHWeb 服务                   │${NC}"
echo -e "${RED}  │  • 删除项目文件 (${INSTALL_DIR})${NC}"
echo -e "${RED}  │  • 删除日志文件 (${LOG_DIR})${NC}"
echo -e "${RED}  │  • 删除 Nginx 配置                         │${NC}"
echo -e "${RED}  └───────────────────────────────────────────┘${NC}"
echo ""
read -p "  确定要完全卸载 SSHWeb 吗? (输入 YES 确认): " confirm
if [ "$confirm" != "YES" ]; then
  echo "已取消卸载"
  exit 0
fi

# 是否删除数据库
DROP_DB=false
read -p "  是否同时删除数据库? (输入 YES 确认删除数据库): " drop_db_confirm
if [ "$drop_db_confirm" = "YES" ]; then
  DROP_DB=true

  if [ "$INSTALL_TYPE" = "docker" ]; then
    echo ""
    echo -e "${YELLOW}  Docker 安装模式 - 将删除数据库容器和数据卷${NC}"
  else
    read -p "  数据库名称 [sshweb]: " DB_NAME
    DB_NAME=${DB_NAME:-sshweb}
    read -p "  数据库用户 [sshweb]: " DB_USER
    DB_USER=${DB_USER:-sshweb}
  fi
fi

echo ""

# ──── 步骤 1: 停止服务 ────
echo -e "${YELLOW}[1/5] 停止 SSHWeb 服务...${NC}"

# 停止 PM2
if $HAS_PM2; then
  echo -e "${YELLOW}       停止 PM2 进程...${NC}"
  pm2 stop sshweb 2>/dev/null || true
  pm2 delete sshweb 2>/dev/null || true
  pm2 save 2>/dev/null || true
  echo -e "${GREEN}       PM2 进程已停止${NC}"
fi

# 停止 Docker
if $HAS_DOCKER; then
  echo -e "${YELLOW}       停止 Docker 容器...${NC}"
  cd ${INSTALL_DIR}
  if [ -f "docker-compose.custom.yml" ]; then
    docker compose -f docker-compose.custom.yml down 2>/dev/null || true
  else
    docker compose down 2>/dev/null || docker-compose down 2>/dev/null || true
  fi
  echo -e "${GREEN}       Docker 容器已停止${NC}"
fi

if [ "$INSTALL_TYPE" = "unknown" ]; then
  echo -e "${YELLOW}       未检测到运行中的服务，跳过${NC}"
fi

# ──── 步骤 2: 删除项目文件 ────
echo -e "${YELLOW}[2/5] 删除项目文件...${NC}"
rm -rf ${INSTALL_DIR}
rm -rf ${LOG_DIR}
echo -e "${GREEN}       项目文件已删除${NC}"

# ──── 步骤 3: 删除数据库 ────
echo -e "${YELLOW}[3/5] 处理数据库...${NC}"
if $DROP_DB; then
  if [ "$INSTALL_TYPE" = "docker" ]; then
    # 删除 Docker 数据卷
    docker volume rm sshweb-db-data 2>/dev/null || true
    echo -e "${GREEN}       Docker 数据库数据卷已删除${NC}"
  else
    # 删除本地数据库
    if command -v mysql &> /dev/null || command -v mariadb &> /dev/null; then
      mysql -u root <<EOF 2>/dev/null || true
DROP DATABASE IF EXISTS \`${DB_NAME}\`;
DROP USER IF EXISTS '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
EOF
      echo -e "${GREEN}       数据库已删除${NC}"
    else
      echo -e "${YELLOW}       未找到 MySQL/MariaDB 客户端，请手动删除数据库${NC}"
    fi
  fi
else
  echo -e "${YELLOW}       保留数据库${NC}"
fi

# ──── 步骤 4: 删除 Nginx 配置 ────
echo -e "${YELLOW}[4/5] 清理 Nginx 配置...${NC}"
if [ -f /etc/nginx/sites-enabled/sshweb ] || [ -f /etc/nginx/sites-available/sshweb ]; then
  rm -f /etc/nginx/sites-enabled/sshweb
  rm -f /etc/nginx/sites-available/sshweb
  nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
  echo -e "${GREEN}       Nginx 配置已清理${NC}"
else
  echo -e "${YELLOW}       未检测到 Nginx 配置，跳过${NC}"
fi

# ──── 步骤 5: 清理 PM2 ────
echo -e "${YELLOW}[5/5] 清理残留...${NC}"
if command -v pm2 &> /dev/null; then
  pm2 save 2>/dev/null || true
fi

# 清理 Docker 数据卷
if $HAS_DOCKER; then
  docker volume rm sshweb-logs 2>/dev/null || true
fi

echo ""
echo -e "${GREEN}"
echo "╔══════════════════════════════════════════╗"
echo "║         SSHWeb 已完全卸载!                ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  以下组件未被卸载 (如需卸载请手动执行):"
echo ""
echo "  # 卸载 Node.js"
echo "  apt-get remove -y nodejs npm"
echo ""
echo "  # 卸载 MariaDB (会删除所有数据库)"
echo "  apt-get remove -y mariadb-server"
echo "  rm -rf /var/lib/mysql"
echo ""
echo "  # 卸载 Docker (会删除所有容器和镜像)"
echo "  apt-get remove -y docker-ce docker-ce-cli docker-compose-plugin"
echo "  rm -rf /var/lib/docker"
echo ""
echo "  # 卸载 PM2"
echo "  npm uninstall -g pm2"
echo ""
echo "  # 卸载 Nginx"
echo "  apt-get remove -y nginx"
echo -e "${NC}"
