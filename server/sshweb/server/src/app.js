const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const config = require('./config');
const { setupSSHTerminal } = require('./websocket/ssh');
const { startSchedulers } = require('./scheduler');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.set('trust proxy', 1);

app.use(cors());
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
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ code: 404, message: 'API not found' });
  }
});

// WebSocket SSH 终端
setupSSHTerminal(io);

async function bootstrap() {
  await db.ensureSchema();

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
