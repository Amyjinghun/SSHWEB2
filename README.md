# SSHWeb - Linux 服务器群控 WebSSH 运维面板

一个基于 Node.js + Vue 3 的轻量级 Linux 服务器群控运维管理系统，集 WebSSH 终端、实时监控、批量操作、文件管理、告警通知于一体。

## 功能特性

### 服务器管理
- 服务器添加/编辑/删除，支持密码和私钥两种认证方式
- 服务器分组、标签管理
- 在线状态自动检测，状态变更记录
- 服务器到期日期管理，一键续费（1-12个月）
- CSV/JSON 批量导入导出服务器配置

### WebSSH 终端
- 浏览器直接连接服务器 SSH，支持多终端标签页
- 终端主题和字体大小可配置
- 快速执行命令，批量命令并发执行
- 命令模板库（100+ 常用命令），执行历史记录

### 实时监控
- 服务器 CPU、内存、磁盘实时采集（默认每 120 秒）
- WebSocket 实时数据推送，动态曲线展示
- 历史趋势图表（1小时/6小时/24小时/7天）
- 监控明细表格，支持时间范围筛选

### 文件管理
- SFTP 在线浏览、上传、下载、编辑远程文件
- 批量文件分发（源服务器 → 多台目标服务器）
- 文件操作日志记录

### 运维工具
- systemd 服务管理（启动/停止/重启/状态）
- 进程查看和管理
- 计划任务（Cron）管理和执行
- 实时日志查看（WebSocket 流式推送）

### 备份管理
- MySQL/MariaDB 数据库定时备份与恢复
- 配置文件定时备份与版本管理

### 安全中心
- SSL 证书到期自动检测
- 告警规则引擎（CPU/内存/磁盘/离线/到期）
- Telegram Bot 告警推送（支持自定义模板、进度条、HTML 格式化）
- 告警通知渠道配置，重复告警抑制
- 完整操作审计日志

### 系统管理
- 用户管理，角色权限控制
- 系统设置（检测间隔、超时、终端、安全策略等）
- 首页仪表盘，服务器概览

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + Vite + Element Plus + ECharts + xterm.js + Socket.IO |
| 后端 | Node.js + Express + Socket.IO + ssh2 + node-cron |
| 数据库 | MySQL / MariaDB |
| 部署 | PM2 / Docker |

## 安装部署

### 方式一：Debian/Ubuntu 一键安装

```bash
git clone <repo-url> && cd SSHWEB2
bash setup.sh install
```

安装过程支持自定义：
- 应用端口（默认 18080）
- 数据库地址（支持远程数据库，自动判断本地/远程）
- 数据库名、用户、密码

本地数据库自动安装 MariaDB，远程数据库仅测试连接。安装完成后自动启动 PM2 守护进程。

其他命令：

```bash
bash setup.sh              # 交互式菜单
bash setup.sh install      # PM2 模式安装
bash setup.sh docker       # Docker 模式安装
bash setup.sh uninstall    # 卸载
bash setup.sh update       # 更新
bash setup.sh status       # 查看状态
```

### 方式二：Docker 部署

```bash
git clone <repo-url> && cd SSHWEB2
bash setup.sh docker
```

安装过程支持自定义：
- 应用端口（默认 18080）
- 数据库对外端口（默认 3307）
- 数据库名、用户、密码、Root 密码

自动安装 Docker 和 Compose 插件，构建镜像并启动容器。

### 方式三：手动安装

```bash
# 1. 安装 Node.js 18+ 和 MySQL/MariaDB
# 2. 导入数据库
mysql -u root -p < database/schema.sql
mysql -u root -p < database/seed.sql

# 3. 配置环境变量
cd server
cp .env.example .env
# 编辑 .env 配置数据库连接、JWT密钥、加密密钥

# 4. 安装依赖并启动
npm install
npm start

# 5. 构建前端
cd ../client
npm install
npm run build
# 将 dist 目录放在 server 能访问的位置
```

## 默认账号

| 项目 | 值 |
|------|-----|
| 管理员账号 | admin |
| 管理员密码 | admin123 |
| 应用端口 | 18080 |

**首次登录后请立即修改默认密码。**

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `APP_PORT` | 应用端口 | 18080 |
| `JWT_SECRET` | JWT 签名密钥 | 开发用默认值 |
| `ENCRYPTION_KEY` | SSH 凭据加密密钥 | 开发用默认值 |
| `MYSQL_HOST` | 数据库地址 | localhost |
| `MYSQL_PORT` | 数据库端口 | 3306 |
| `MYSQL_DATABASE` | 数据库名 | sshweb |
| `MYSQL_USER` | 数据库用户 | sshweb |
| `MYSQL_PASSWORD` | 数据库密码 | sshweb123456 |
| `TG_ENABLED` | 启用 Telegram 通知 | false |
| `TG_BOT_TOKEN` | Telegram Bot Token | - |
| `TG_CHAT_ID` | Telegram Chat ID | - |

> 生产环境必须设置 `JWT_SECRET`、`ENCRYPTION_KEY`、`MYSQL_PASSWORD`，否则无法启动。

## 常用管理命令

```bash
# PM2 管理
pm2 status              # 查看状态
pm2 logs sshweb         # 查看日志
pm2 restart sshweb      # 重启服务
pm2 stop sshweb         # 停止服务

# Docker 管理
docker compose logs -f  # 查看日志
docker compose restart  # 重启
docker compose down     # 停止
docker compose up -d    # 启动
```

## 项目结构

```
SSHWEB2/
├── client/                    # 前端 Vue 3 项目
│   └── src/
│       ├── api/               # Axios 请求封装
│       ├── layouts/           # 页面布局（侧边栏+头部）
│       ├── router/            # Vue Router 路由配置
│       ├── stores/            # Pinia 状态管理
│       ├── styles/            # 全局样式
│       └── views/             # 页面组件
│           ├── servers/       # 服务器列表、表单、分组
│           ├── terminal/      # WebSSH、批量命令、模板、历史
│           ├── files/         # 文件管理、文件分发
│           ├── services/      # 服务管理、进程管理
│           ├── monitor/       # 资源监控、状态记录
│           ├── logs/          # 实时日志查看
│           ├── tasks/         # 计划任务
│           ├── backups/       # 数据库备份、配置备份
│           ├── security/      # 证书、告警、通知、审计
│           └── system/        # 用户管理、系统设置
├── server/                    # 后端 Node.js 项目
│   └── src/
│       ├── app.js             # Express 入口，注册路由和 WebSocket
│       ├── config/            # 环境变量配置
│       ├── db/                # MySQL 连接池
│       ├── middleware/        # JWT 认证中间件
│       ├── routes/            # API 路由（15 个模块）
│       ├── scheduler/         # 定时任务（状态检测、指标采集、告警）
│       ├── services/          # Telegram 通知、告警服务
│       ├── ssh/               # SSH 连接和命令执行
│       ├── utils/             # 工具函数（加密、审计）
│       └── websocket/         # WebSocket（SSH 终端、日志流、实时指标）
├── database/                  # 数据库脚本
│   ├── schema.sql             # 表结构（16 张表）
│   └── seed.sql               # 初始数据（管理员、分组、命令模板、设置）
├── setup.sh                   # Debian 统一安装/卸载脚本
├── docker-install.sh          # Docker 安装脚本
├── Dockerfile                 # Docker 镜像
└── docker-compose.yml         # Docker Compose 配置
```

## 许可证

MIT License
