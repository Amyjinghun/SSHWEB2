# SSHWeb - Linux 服务器群控 WebSSH 运维面板

一个基于 Node.js + Vue 3 的轻量级 Linux 服务器群控 WebSSH 运维管理系统。

## 功能特性

- **WebSSH 终端** - 浏览器直接连接服务器 SSH，支持多终端标签页
- **批量命令执行** - 多台服务器并发执行命令，实时显示结果
- **服务器集中管理** - 添加/分组/标签/在线状态监控
- **文件管理** - 通过 SFTP 浏览、上传、下载、编辑文件
- **服务管理** - 管理 systemd 服务（启动/停止/重启）
- **进程管理** - 查看/结束服务器进程
- **计划任务** - Crontab 管理，定时执行命令
- **数据库备份** - MySQL/MariaDB 定时备份与恢复
- **配置备份** - 配置文件定时备份与版本管理
- **证书监控** - SSL 证书到期自动检测
- **告警中心** - 多种告警规则和通知渠道
- **审计日志** - 完整操作审计记录

## 技术栈

- **前端**: Vue 3 + Vite + Element Plus + xterm.js + ECharts
- **后端**: Node.js + Express + Socket.IO + ssh2
- **数据库**: MySQL / MariaDB

## 快速安装

### 方式一: 脚本安装 (Debian 11/12)

```bash
# 克隆或下载项目
git clone <repo> && cd sshweb

# 运行安装脚本
chmod +x install.sh
bash install.sh
```

安装完成后访问 `http://服务器IP`，默认账号 `admin` / `admin123`

### 方式二: Docker 安装

```bash
cd sshweb

# 运行 Docker 安装脚本
chmod +x docker-install.sh
bash docker-install.sh

# 或手动启动
docker compose up -d
```

访问 `http://服务器IP:3000`

### 方式三: 手动安装

```bash
# 1. 安装依赖
apt install -y nodejs npm mariadb-server nginx

# 2. 创建数据库
mysql -u root < database/schema.sql
mysql -u root < database/seed.sql

# 3. 安装后端依赖
cd server && npm install --production

# 4. 构建前端
cd ../client && npm install && npm run build

# 5. 配置环境变量
cp ../.env.example ../server/.env
# 编辑 .env 填写数据库和密钥

# 6. 启动
cd ../server && node src/app.js
```

## 卸载

```bash
# 脚本安装的卸载
chmod +x uninstall.sh
bash uninstall.sh

# Docker 版卸载
docker compose down -v
```

## 默认配置

| 配置项 | 默认值 |
|--------|--------|
| 数据库名 | sshweb |
| 数据库用户 | sshweb |
| 数据库密码 | sshweb123456 |
| 应用端口 | 3000 |
| 管理员账号 | admin |
| 管理员密码 | admin123 |

**首次登录后请立即修改默认密码！**

## 目录结构

```
sshweb/
├── client/          # 前端 Vue 3 项目
│   └── src/views/   # 页面组件
├── server/          # 后端 Node.js 项目
│   └── src/
│       ├── routes/  # API 路由
│       ├── ssh/     # SSH 连接管理
│       ├── websocket/ # WebSocket SSH 终端
│       └── scheduler/ # 定时任务调度
├── database/        # 数据库初始化脚本
├── install.sh       # Debian 安装脚本
├── docker-install.sh # Docker 安装脚本
├── uninstall.sh     # 卸载脚本
├── Dockerfile       # Docker 镜像
└── docker-compose.yml # Docker Compose 配置
```

## 常用管理命令

```bash
# PM2 管理 (脚本安装)
pm2 status          # 查看状态
pm2 logs sshweb     # 查看日志
pm2 restart sshweb  # 重启服务
pm2 stop sshweb     # 停止服务

# Docker 管理
docker compose logs -f     # 查看日志
docker compose restart     # 重启
docker compose down        # 停止
docker compose up -d       # 启动
```

## 许可证

MIT License
