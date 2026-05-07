#!/bin/bash
#===============================================
# SSHWeb Docker 版安装脚本
# 用法: bash docker-install.sh
#===============================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "============================================"
echo "  SSHWeb Docker 版安装脚本"
echo "============================================"
echo -e "${NC}"

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}请使用 root 权限运行此脚本${NC}"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo -e "${YELLOW}[1/4] 安装 Docker 和 Docker Compose...${NC}"
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | bash
  systemctl enable docker
  systemctl start docker
  echo -e "${GREEN}Docker 安装完成${NC}"
else
  echo -e "${GREEN}Docker 已安装${NC}"
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
  apt-get install -y docker-compose-plugin 2>/dev/null || apt-get install -y docker-compose
fi

echo -e "${YELLOW}[2/4] 生成随机密钥...${NC}"
export JWT_SECRET=$(openssl rand -base64 32)
export ENCRYPTION_KEY=$(openssl rand -base64 32)

echo -e "${YELLOW}[3/4] 构建 Docker 镜像...${NC}"
cd ${SCRIPT_DIR}
docker compose build --no-cache 2>/dev/null || docker-compose build --no-cache

echo -e "${YELLOW}[4/4] 启动服务...${NC}"
docker compose up -d 2>/dev/null || docker-compose up -d

echo -e "${GREEN}"
echo "============================================"
echo "  SSHWeb Docker 版安装完成！"
echo "============================================"
echo ""
echo "  访问地址: http://$(hostname -I | awk '{print $1}'):3000"
echo "  默认账号: admin"
echo "  默认密码: admin123"
echo ""
echo "  常用命令:"
echo "    docker compose logs -f        # 查看日志"
echo "    docker compose restart        # 重启服务"
echo "    docker compose down           # 停止服务"
echo "    docker compose up -d          # 启动服务"
echo "============================================"
echo -e "${NC}"
