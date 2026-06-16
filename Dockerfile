FROM node:20-slim

LABEL maintainer="SSHWeb"
LABEL description="SSHWeb WebSSH operations panel"

RUN apt-get update && apt-get install -y \
    mariadb-client \
    openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server/package.json ./server/
RUN cd server && npm install --omit=dev

COPY client/package.json client/package-lock.json* ./client/
RUN cd client && npm install
COPY client/ ./client/
RUN cd client && npm run build

COPY server/ ./server/
COPY database/ ./database/
COPY ecosystem.config.js ./

RUN mkdir -p /var/log/sshweb

RUN echo "APP_NAME=SSHWeb\n\
APP_PORT=18080\n\
NODE_ENV=production\n\
MYSQL_HOST=db\n\
MYSQL_PORT=3306\n\
MYSQL_DATABASE=sshweb\n\
MYSQL_USER=sshweb\n\
MYSQL_PASSWORD=$(openssl rand -base64 32)\n\
JWT_SECRET=$(openssl rand -base64 32)\n\
JWT_EXPIRES_IN=7d\n\
ENCRYPTION_KEY=$(openssl rand -base64 32)\n\
SSH_CONNECT_TIMEOUT=10000\n\
SSH_EXEC_TIMEOUT=60000\n\
ENABLE_DANGEROUS_COMMAND_BLOCK=true\n\
DANGEROUS_COMMAND_ACTION=block\n\
ALLOW_QUERY_TOKEN=false\n\
ALLOW_PLAIN_CREDENTIAL_EXPORT=false" > /app/server/.env

EXPOSE 18080

WORKDIR /app/server

CMD ["node", "src/app.js"]
