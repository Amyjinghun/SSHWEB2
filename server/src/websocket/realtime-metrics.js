const jwt = require('jsonwebtoken');
const config = require('../config');
const { normalizeSSHConfig, formatSSHError } = require('../ssh/connection');
const { collectServerMetrics } = require('../scheduler');
const { createSSHConnection } = require('../ssh/connection');
const { agentEvents, isAgentFreshAsync, getAgentInterval } = require('../services/agent');
const db = require('../db');

function setupRealtimeMetrics(io) {
  const nsp = io.of('/metrics');

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

  nsp.on('connection', (socket) => {
    let conn = null;
    let timer = null;
    let lastNet = null;
    // agent 订阅模式：不开 SSH，直接转发 agent 推送
    let agentMode = false;
    let agentHandler = null;
    let agentWatchdog = null;

    function clearAgentMode() {
      agentMode = false;
      if (agentHandler) {
        try { agentEvents.off('metrics', agentHandler); } catch {}
        agentHandler = null;
      }
      if (agentWatchdog) { clearInterval(agentWatchdog); agentWatchdog = null; }
    }

    async function closeAll() {
      clearAgentMode();
      if (timer) { clearInterval(timer); timer = null; }
      try { if (conn) conn.end(); } catch {}
      conn = null;
      lastNet = null;
    }

    socket.on('start', async (serverId) => {
      await closeAll();
      if (!serverId) return socket.emit('error', '缺少 serverId');

      try {
        const server = await db.queryOne('SELECT * FROM servers WHERE id = ?', [serverId]);
        if (!server) return socket.emit('error', '服务器不存在');

        // Agent 在线 → 订阅模式：转发 agent 上报，超过 3 个周期没推送才提示中断
        if (await isAgentFreshAsync(server)) {
          agentMode = true;
          socket.emit('connected', { via: 'agent' });
          let lastPush = Date.now();
          agentHandler = (payload) => { lastPush = Date.now(); socket.emit('metrics', payload); };
          agentEvents.on(`metrics:${serverId}`, agentHandler);
          const staleMs = Math.max((await getAgentInterval()) * 3 * 1000, 30000);
          agentWatchdog = setInterval(() => {
            if (Date.now() - lastPush > staleMs) {
              socket.emit('error', 'Agent 推送中断，请重新打开实时监控');
              closeAll();
            }
          }, 5000);
          return;
        }

        const connectConfig = normalizeSSHConfig(server);
        conn = await createSSHConnection(server);

        socket.emit('connected', { via: 'ssh' });

        const collect = async () => {
          try {
            if (!conn) return;
            const m = await collectServerMetrics(conn);
            const now = Date.now();
            let netRxRate = 0;
            let netTxRate = 0;
            if (lastNet && now > lastNet.timestamp) {
              const elapsed = (now - lastNet.timestamp) / 1000;
              netRxRate = Math.max(0, (m.netRxBytes - lastNet.rx) / elapsed);
              netTxRate = Math.max(0, (m.netTxBytes - lastNet.tx) / elapsed);
            }
            lastNet = { rx: m.netRxBytes, tx: m.netTxBytes, timestamp: now };
            socket.emit('metrics', {
              cpu: m.cpu,
              mem_usage: m.memUsage,
              mem_used: m.memUsed,
              mem_total: m.memTotal,
              disk_usage: m.diskUsage,
              disk_used: m.diskUsed,
              disk_total: m.diskTotal,
              net_rx_bytes: m.netRxBytes,
              net_tx_bytes: m.netTxBytes,
              net_rx_rate: netRxRate,
              net_tx_rate: netTxRate,
              load_avg: m.loadAvg,
              uptime: m.uptime,
              timestamp: now
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
