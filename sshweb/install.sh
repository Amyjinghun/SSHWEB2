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

echo -e "${BLUE}"
echo "============================================"
echo "  SSHWeb 服务器群控面板 - 安装脚本"
echo "  适用于 Debian 11/12 系统"
echo "============================================"
echo -e "${NC}"

# 检查 root 权限
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}请使用 root 权限运行此脚本${NC}"
  exit 1
fi

echo -e "${YELLOW}[1/8] 更新系统并安装依赖...${NC}"
apt-get update -y
apt-get install -y curl wget git unzip mariadb-server nginx nodejs npm

echo -e "${YELLOW}[2/8] 配置 MariaDB 数据库...${NC}"
# 启动 MariaDB
systemctl enable mariadb
systemctl start mariadb

# 创建数据库和用户
mysql -u root <<EOF
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
EOF

echo -e "${GREEN}数据库创建完成${NC}"

echo -e "${YELLOW}[3/8] 部署项目文件...${NC}"
# 创建目录
mkdir -p ${INSTALL_DIR}
mkdir -p ${LOG_DIR}

# 复制项目文件（假设脚本在项目目录中运行）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "${SCRIPT_DIR}/server/package.json" ]; then
  cp -r ${SCRIPT_DIR}/* ${INSTALL_DIR}/
else
  echo -e "${RED}请在项目根目录运行此脚本${NC}"
  exit 1
fi

cd ${INSTALL_DIR}

echo -e "${YELLOW}[4/8] 初始化数据库...${NC}"
mysql -u root ${DB_NAME} < ${INSTALL_DIR}/database/schema.sql
mysql -u root ${DB_NAME} < ${INSTALL_DIR}/database/seed.sql

echo -e "${YELLOW}[5/8] 安装后端依赖并构建前端...${NC}"
# 安装后端依赖
cd ${INSTALL_DIR}/server
npm install --production

# 安装前端依赖并构建
cd ${INSTALL_DIR}/client
npm install
npm run build

echo -e "${YELLOW}[6/8] 生成配置文件...${NC}"
# 生成随机密钥
JWT_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -base64 32)

cat > ${INSTALL_DIR}/.env <<EOF
APP_NAME=SSHWeb
APP_PORT=3000
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
EOF

# 复制 .env 到 server 目录
cp ${INSTALL_DIR}/.env ${INSTALL_DIR}/server/.env

echo -e "${YELLOW}[7/8] 安装 PM2 并启动服务...${NC}"
npm install -g pm2

cd ${INSTALL_DIR}
# 更新 ecosystem.config.js 中的路径
sed -i "s|cwd: '/opt/sshweb'|cwd: '${INSTALL_DIR}'|g" ${INSTALL_DIR}/ecosystem.config.js
pm2 start ${INSTALL_DIR}/ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root

echo -e "${YELLOW}[8/8] 配置 Nginx 反向代理...${NC}"
cat > /etc/nginx/sites-available/sshweb <<'EOF'
server {
    listen 80;
    server_name _;

    client_max_body_size 100M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
EOF

ln -sf /etc/nginx/sites-available/sshweb /etc/nginx/sites-enabled/sshweb
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

echo -e "${GREEN}"
echo "============================================"
echo "  SSHWeb 安装完成！"
echo "============================================"
echo ""
echo "  访问地址: http://$(hostname -I | awk '{print $1}')"
echo "  默认账号: admin"
echo "  默认密码: admin123"
echo ""
echo "  项目目录: ${INSTALL_DIR}"
echo "  日志目录: ${LOG_DIR}"
echo "  配置文件: ${INSTALL_DIR}/.env"
echo ""
echo "  常用命令:"
echo "    pm2 status          # 查看服务状态"
echo "    pm2 logs sshweb     # 查看日志"
echo "    pm2 restart sshweb  # 重启服务"
echo "    pm2 stop sshweb     # 停止服务"
echo "============================================"
echo -e "${NC}"
