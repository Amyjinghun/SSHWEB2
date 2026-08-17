const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');

const router = express.Router();

const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { code: 429, message: 'Too many monitor requests, please try again later' }
});

async function getPublicMonitorSettings() {
  const rows = await db.query(
    "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('public_monitor_enabled', 'public_monitor_key')"
  );
  const settings = {
    public_monitor_enabled: 'false',
    public_monitor_key: ''
  };
  rows.forEach(row => {
    settings[row.setting_key] = row.setting_value || '';
  });
  return settings;
}

function pct(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100, Math.round(n * 10) / 10);
}

// 登录页展示信息：仅暴露系统名称/登录标题两个非敏感键，无需登录即可访问
router.get('/site-info', publicLimiter, async (req, res) => {
  try {
    const rows = await db.query(
      "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('system_name', 'login_title')"
    );
    const data = { system_name: 'SSHWeb', login_title: 'Linux 服务器群控 WebSSH 运维管理系统' };
    rows.forEach(row => { if (row.setting_value) data[row.setting_key] = row.setting_value; });
    res.json({ code: 0, data });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.get('/monitor/:shareKey', publicLimiter, async (req, res) => {
  try {
    const settings = await getPublicMonitorSettings();
    const expectedKey = String(settings.public_monitor_key || '').trim();
    const shareKey = String(req.params.shareKey || '').trim();

    if (settings.public_monitor_enabled !== 'true') {
      return res.json({ code: 403, message: '公开监控未开启' });
    }
    if (!expectedKey || shareKey !== expectedKey) {
      return res.json({ code: 403, message: '公开监控链接无效' });
    }

    const servers = await db.query(`
      SELECT
        s.name, s.status, s.os_info, s.cpu_usage, s.memory_usage, s.disk_usage,
        s.uptime, s.load_avg, s.mem_total_mb, s.mem_used_mb, s.disk_total_mb, s.disk_used_mb,
        s.network_rx_bytes, s.network_tx_bytes,
        s.tcp_connections, s.udp_connections, s.system_info, s.expires_at,
        g.name AS group_name
      FROM servers s
      LEFT JOIN server_groups g ON s.group_id = g.id
      ORDER BY FIELD(s.status, 'online', 'unknown', 'offline'), s.name ASC
    `);

    // 公开页只暴露非敏感的系统信息：隐去公网 IP / DNS / 地理位置 / 运营商
    const SAFE_SYSTEM_KEYS = ['kernel', 'arch', 'cpu_cores', 'cpu_model', 'tcp_congestion'];
    servers.forEach(server => {
      let info = server.system_info;
      if (typeof info === 'string') { try { info = JSON.parse(info); } catch { info = {}; } }
      if (!info || typeof info !== 'object') info = {};
      server.system_info = SAFE_SYSTEM_KEYS.reduce((acc, k) => {
        if (info[k] !== undefined && info[k] !== '' && info[k] !== '-') acc[k] = info[k];
        return acc;
      }, {});
    });

    const online = servers.filter(server => server.status === 'online');
    const critical = servers.filter(server =>
      server.status === 'online' &&
      (pct(server.cpu_usage) >= 90 || pct(server.memory_usage) >= 90 || pct(server.disk_usage) >= 90)
    );

    res.json({
      code: 0,
      data: {
        generated_at: new Date().toISOString(),
        summary: {
          total: servers.length,
          online: online.length,
          offline: servers.filter(server => server.status === 'offline').length,
          unknown: servers.filter(server => server.status === 'unknown').length,
          critical: critical.length
        },
        servers
      }
    });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

module.exports = router;
