const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const config = require('./config');
const { setupSSHTerminal } = require('./websocket/ssh');
const { setupLogTail } = require('./websocket/log-tail');
const { setupRealtimeMetrics } = require('./websocket/realtime-metrics');
const { setupMonitorGrid } = require('./websocket/monitor-grid');
const { startSchedulers } = require('./scheduler');
const db = require('./db');

// 进程级兜底：任何未被路由 catch 的异步拒绝/同步异常都记录下来，
// uncaughtException 时进程状态未知，退出交由 PM2 重启。
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
  process.exit(1);
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: config.cors });

app.set('trust proxy', 1);

app.use(cors(config.cors));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静态文件服务
const distPath = path.join(__dirname, '../../client/dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// API 路由
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/servers', require('./routes/servers'));
app.use('/api/server-groups', require('./routes/groups'));
app.use('/api/commands', require('./routes/commands'));
app.use('/api/files', require('./routes/files'));
app.use('/api/services', require('./routes/services'));
app.use('/api/processes', require('./routes/processes'));
app.use('/api/scheduled-tasks', require('./routes/tasks'));
app.use('/api/backups', require('./routes/backups'));
app.use('/api/certificates', require('./routes/certificates'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/audit-logs', require('./routes/audit'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/dashboard', require('./routes/dashboard'));

// SPA fallback
app.get('*', (req, res) => {
  // 未匹配的 /api/* 一律返回 JSON 404，避免把 index.html 当 API 响应返回
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ code: 404, message: 'API not found' });
  }
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ code: 404, message: 'API not found' });
  }
});

// 全局错误处理中间件：捕获任何 next(err) 或未被路由处理的异常。
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('[UNHANDLED ERROR]', err);
  const message = config.isProduction ? '服务器内部错误' : (err.message || '服务器内部错误');
  res.status(500).json({ code: 500, message });
});

// WebSocket SSH 终端
setupSSHTerminal(io);
setupLogTail(io);
setupRealtimeMetrics(io);
setupMonitorGrid(io);

async function bootstrap() {
  await db.ensureSchema();

  // 清理上次进程中断时遗留的"运行中"批量任务，避免它们永远卡在该状态
  try {
    await db.update("UPDATE batch_tasks SET status='failed', finished_at=COALESCE(finished_at, NOW()) WHERE status='running'");
  } catch (err) {
    console.error('[BOOTSTRAP] 清理遗留批量任务失败:', err.message);
  }

  // 启动定时任务
  startSchedulers();

  server.listen(config.port, () => {
    console.log(`========================================`);
    console.log(`  SSHWeb 服务器群控面板已启动`);
    console.log(`  访问地址: http://0.0.0.0:${config.port}`);
    console.log(`  环境: ${config.env}`);
    console.log(`========================================`);
  });
}

bootstrap().catch((err) => {
  console.error('服务启动失败:', err);
  process.exit(1);
});
