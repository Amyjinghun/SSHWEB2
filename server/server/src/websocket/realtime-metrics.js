const jwt = require('jsonwebtoken');
const config = require('../config');
const { normalizeSSHConfig, formatSSHError } = require('../ssh/connection');
const { collectServerMetrics } = require('../scheduler');
const { createSSHConnection } = require('../ssh/connection');
const db = require('../db');

function setupRealtimeMetrics(io) {
  const nsp = io.of('/metrics');

  nsp.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('未提供认证令牌'));
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      const user = await db.queryOne('SELECT id, username, role, status, token_version FROM users WHERE id = ?', [decoded.id]);
      if (!user || Number(user.status) !== 1 || Number(user.token_version || 0) !== Number(decoded.tokenVersion)) {
        return next(new Error('登录状态已失效'));
      }
      socket.user = { id: user.id, username: user.username };
      next();
    } catch (err) {
      next(new Error('认证失败'));
    }
  });

  nsp.on('connection', (socket) => {
    let conn = null;
    let timer = null;

    async function closeAll() {
      if (timer) { clearInterval(timer); timer = null; }
      try { if (conn) conn.end(); } catch {}
      conn = null;
    }

    socket.on('start', async (serverId) => {
      await closeAll();
      if (!serverId) return socket.emit('error', '缺少 serverId');

      try {
        const server = await db.queryOne('SELECT * FROM servers WHERE id = ?', [serverId]);
        if (!server) return socket.emit('error', '服务器不存在');

        const connectConfig = normalizeSSHConfig(server);
        conn = await createSSHConnection(server);

        socket.emit('connected');

        const collect = async () => {
          try {
            if (!conn) return;
            const m = await collectServerMetrics(conn);
            socket.emit('metrics', {
              cpu: m.cpu,
              mem_usage: m.memUsage,
              mem_used: m.memUsed,
              mem_total: m.memTotal,
              disk_usage: m.diskUsage,
              disk_used: m.diskUsed,
              disk_total: m.diskTotal,
              load_avg: m.loadAvg,
              uptime: m.uptime,
              timestamp: Date.now()
            });
          } catch (err) {
            socket.emit('error', '采集失败: ' + err.message);
            await closeAll();
          }
        };

        await collect();
        timer = setInterval(collect, 3000);
      } catch (err) {
        socket.emit('error', formatSSHError(err));
      }
    });

    socket.on('stop', closeAll);
    socket.on('disconnect', closeAll);
  });
}

module.exports = { setupRealtimeMetrics };
