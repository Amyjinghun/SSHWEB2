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

## 安装方式

### 方式一: 1Panel 安装 (推荐)

适用于已安装 [1Panel](https://1panel.cn) 面板的服务器。

```bash
# 1. 先在 1Panel 中安装 MySQL/MariaDB 数据库
#    进入 [数据库] → [创建数据库]，记录数据库名、用户名、密码

# 2. 克隆项目
git clone <repo> && cd sshweb

# 3. 运行 1Panel 安装脚本
chmod +x 1panel-install.sh
bash 1panel-install.sh
```

安装过程会自动：
- 检测 1Panel MySQL 容器并获取连接地址
- 交互式配置数据库连接信息和端口
- 测试数据库连接
- 初始化数据库表结构和默认数据
- 安装 Node.js 依赖并构建前端
- 使用 PM2 启动后台服务

安装完成后在 1Panel 中配置反向代理即可通过域名访问：
1. 进入 [网站] → [创建网站] → [反向代理]
2. 代理地址填写 `http://127.0.0.1:3000`
3. 配置域名和 SSL 证书

### 方式二: 一键安装

适用于全新 Debian/Ubuntu 服务器，自动安装所有依赖。

```bash
# 克隆项目
git clone <repo> && cd sshweb

# 运行一键安装脚本
chmod +x install.sh
bash install.sh
```

安装过程支持自定义配置：
- **应用端口** - 默认 3000
- **数据库主机** - 默认 localhost
- **数据库端口** - 默认 3306
- **数据库名称** - 默认 sshweb
- **数据库用户** - 默认 sshweb
- **数据库密码** - 默认 sshweb123456
- 可选择使用已有数据库或自动安装 MariaDB

脚本会自动安装 Node.js、MariaDB、Nginx、PM2，并完成所有配置。

### 方式三: Docker 安装

适用于 Docker 环境，一键容器化部署。

```bash
# 克隆项目
git clone <repo> && cd sshweb

# 运行 Docker 安装脚本
chmod +x docker-install.sh
bash docker-install.sh
```

安装过程支持自定义配置：
- **应用端口** - 默认 3000
- **数据库对外端口** - 默认 3307
- **数据库名称** - 默认 sshweb
- **数据库用户** - 默认 sshweb
- **数据库密码** - 默认 sshweb123456
- **数据库 Root 密码** - 默认 rootpassword

或者手动配置 Docker Compose：

```bash
# 创建环境变量文件
cat > .env.docker <<EOF
APP_PORT=3000
DB_EXPOSE_PORT=3307
DB_NAME=sshweb
DB_USER=sshweb
DB_PASS=your_password
DB_ROOT_PASS=your_root_password
JWT_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -base64 32)
EOF

# 启动
docker compose up -d
```

## 卸载

```bash
chmod +x uninstall.sh
bash uninstall.sh
```

卸载脚本会自动检测安装方式 (PM2/Docker)，并：
- 停止并删除服务/容器
- 删除项目文件和日志
- 可选删除数据库
- 清理 Nginx 配置

> 输入 `YES` 确认卸载，过程中会询问是否删除数据库。

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
├── client/              # 前端 Vue 3 项目
│   └── src/views/       # 页面组件
├── server/              # 后端 Node.js 项目
│   └── src/
│       ├── routes/      # API 路由
│       ├── ssh/         # SSH 连接管理
│       ├── websocket/   # WebSocket SSH 终端
│       └── scheduler/   # 定时任务调度
├── database/            # 数据库初始化脚本
├── 1panel-install.sh    # 1Panel 安装脚本
├── install.sh           # 一键安装脚本
├── docker-install.sh    # Docker 安装脚本
├── uninstall.sh         # 统一卸载脚本
├── Dockerfile           # Docker 镜像
└── docker-compose.yml   # Docker Compose 配置
```

## 常用管理命令

```bash
# PM2 管理 (一键安装 / 1Panel 安装)
pm2 status          # 查看状态
pm2 logs sshweb     # 查看日志
pm2 restart sshweb  # 重启服务
pm2 stop sshweb     # 停止服务

# Docker 管理
docker compose logs -f                        # 查看日志
docker compose restart                        # 重启
docker compose down                           # 停止
docker compose up -d                          # 启动

# 使用自定义 compose 文件 (docker-install.sh 生成)
docker compose -f docker-compose.custom.yml logs -f
docker compose -f docker-compose.custom.yml restart
docker compose -f docker-compose.custom.yml down
docker compose -f docker-compose.custom.yml up -d
```

## 许可证

MIT License
