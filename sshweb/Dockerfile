FROM node:20-slim

LABEL maintainer="SSHWeb"
LABEL description="Linux 服务器群控 WebSSH 运维面板"

# 安装依赖
RUN apt-get update && apt-get install -y \
    mariadb-client \
    openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制后端并安装依赖
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --production

# 复制前端并安装依赖并构建
COPY client/package.json client/package-lock.json* ./client/
RUN cd client && npm install
COPY client/ ./client/
RUN cd client && npm run build

# 复制后端代码
COPY server/ ./server/

# 复制数据库文件
COPY database/ ./database/

# 复制配置文件
COPY ecosystem.config.js ./

# 创建日志目录
RUN mkdir -p /var/log/sshweb

# 生成默认 .env
RUN echo "APP_NAME=SSHWeb\n\
APP_PORT=18080\n\
NODE_ENV=production\n\
MYSQL_HOST=db\n\
MYSQL_PORT=3306\n\
MYSQL_DATABASE=sshweb\n\
MYSQL_USER=sshweb\n\
MYSQL_PASSWORD=sshweb123456\n\
JWT_SECRET=$(openssl rand -base64 32)\n\
JWT_EXPIRES_IN=7d\n\
ENCRYPTION_KEY=$(openssl rand -base64 32)\n\
SSH_CONNECT_TIMEOUT=10000\n\
SSH_EXEC_TIMEOUT=60000\n\
ENABLE_DANGEROUS_COMMAND_BLOCK=true" > /app/server/.env

EXPOSE 18080

WORKDIR /app/server

CMD ["node", "src/app.js"]
