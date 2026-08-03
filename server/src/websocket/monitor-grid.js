const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

// 主页实时监控面板：每 PUSH_INTERVAL_MS 推送一次 servers 表缓存的最新快照。
// 数据新鲜度由调度器（scheduler）的采集间隔决定（≥60s），这里只做廉价的 DB 读取，
// 不对每台服务器开 SSH 长连接，保证大规模服务器群也能扩展。
const PUSH_INTERVAL_MS = 5000;

function setupMonitorGrid(io) {
  const nsp = io.of('/monitor');

  nsp.use(async (socket, next) => {
    const queryToken = config.security.allowQueryToken ? socket.handshake.query?.token : '';
    const token = socket.handshake.auth?.token || queryToken;
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

  async function snapshot() {
    return db.query(
      `SELECT s.id, s.name, s.host, s.status, s.cpu_usage, s.memory_usage, s.disk_usage,
              s.os_info, s.uptime, s.load_avg, s.mem_total_mb, s.mem_used_mb, s.disk_total_mb, s.disk_used_mb,
              s.network_rx_bytes, s.network_tx_bytes,
              s.tcp_connections, s.udp_connections, s.system_info, s.expires_at,
              s.last_connected_at, s.group_id, g.name AS group_name
       FROM servers s
       LEFT JOIN server_groups g ON s.group_id = g.id
       ORDER BY (s.status = 'online') DESC, s.id ASC`
    );
  }

  nsp.on('connection', async (socket) => {
    const push = async () => {
      try {
        socket.emit('snapshot', await snapshot());
      } catch (err) {
        // 单次推送失败不影响后续，调度器/DB 错误已在 db 层落日志
      }
    };

    await push();
    const timer = setInterval(push, PUSH_INTERVAL_MS);
    socket.on('disconnect', () => clearInterval(timer));
  });
}

module.exports = { setupMonitorGrid };
