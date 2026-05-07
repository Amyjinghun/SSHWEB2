#!/bin/bash
#===============================================
# SSHWeb 服务器群控面板 - 卸载脚本
# 用法: bash uninstall.sh
# 注意: 此操作将完全删除 SSHWeb 及其数据！
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

echo -e "${RED}"
echo "============================================"
echo "  SSHWeb 卸载脚本"
echo "  警告: 此操作将完全删除 SSHWeb！"
echo "============================================"
echo -e "${NC}"

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}请使用 root 权限运行此脚本${NC}"
  exit 1
fi

# 确认卸载
read -p "确定要完全卸载 SSHWeb 吗？(输入 YES 确认): " confirm
if [ "$confirm" != "YES" ]; then
  echo "已取消卸载"
  exit 0
fi

read -p "是否同时删除数据库？(输入 YES 确认删除数据库): " drop_db

echo -e "${YELLOW}[1/5] 停止 SSHWeb 服务...${NC}"
if command -v pm2 &> /dev/null; then
  pm2 stop sshweb 2>/dev/null || true
  pm2 delete sshweb 2>/dev/null || true
  pm2 save 2>/dev/null || true
fi

# 检查是否为 Docker 安装
if [ -f "docker-compose.yml" ] || [ -f "${INSTALL_DIR}/docker-compose.yml" ]; then
  echo -e "${YELLOW}检测到 Docker 安装，停止容器...${NC}"
  docker compose down -v 2>/dev/null || docker-compose down -v 2>/dev/null || true
fi

echo -e "${YELLOW}[2/5] 删除项目文件...${NC}"
rm -rf ${INSTALL_DIR}
rm -rf ${LOG_DIR}

echo -e "${YELLOW}[3/5] 删除数据库...${NC}"
if [ "$drop_db" = "YES" ]; then
  mysql -u root <<EOF 2>/dev/null || true
DROP DATABASE IF EXISTS \`${DB_NAME}\`;
DROP USER IF EXISTS '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
EOF
  echo -e "${GREEN}数据库已删除${NC}"
else
  echo -e "${YELLOW}保留数据库${NC}"
fi

echo -e "${YELLOW}[4/5] 删除 Nginx 配置...${NC}"
rm -f /etc/nginx/sites-enabled/sshweb
rm -f /etc/nginx/sites-available/sshweb
nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true

echo -e "${YELLOW}[5/5] 清理 PM2...${NC}"
if command -v pm2 &> /dev/null; then
  pm2 save 2>/dev/null || true
fi

echo -e "${GREEN}"
echo "============================================"
echo "  SSHWeb 已完全卸载！"
echo "============================================"
echo ""
echo "  如需同时卸载 Node.js / MariaDB / Docker"
echo "  请手动执行以下命令:"
echo ""
echo "  # 卸载 Node.js"
echo "  apt-get remove -y nodejs npm"
echo ""
echo "  # 卸载 MariaDB (会删除所有数据库)"
echo "  apt-get remove -y mariadb-server"
echo "  rm -rf /var/lib/mysql"
echo ""
echo "  # 卸载 Docker"
echo "  apt-get remove -y docker-ce docker-ce-cli docker-compose-plugin"
echo "  rm -rf /var/lib/docker"
echo "============================================"
echo -e "${NC}"
