const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { sha256, handleAgentReport, issueAgentToken } = require('../services/agent');
const { buildInstaller } = require('../services/agent-script');
const { getSettingValue } = require('../services/telegram');

const router = express.Router();

const reportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: (req) => req.ip,
  message: { code: 429, message: 'too many reports' }
});

const installLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { code: 429, message: 'too many requests' }
});

// POST /api/agent/report — agent 指标上报（免 JWT，token 鉴权）
router.post('/report', reportLimiter, (req, res) => {
  handleAgentReport(req, res).catch(() => {
    if (!res.headersSent) res.status(500).json({ code: 500, message: 'report failed' });
  });
});

// GET /api/agent/install.sh?token=...&interval=... — 手动安装：curl -fsSL ... | sh
// token 为一次性明文（安装时生成展示），脚本自包含 agent 与配置
router.get('/install.sh', installLimiter, async (req, res) => {
  try {
    const token = String(req.query.token || '');
    if (!/^[a-f0-9]{64}$/.test(token)) {
      return res.status(400).type('text/plain').send('# invalid token\n');
    }
    const hash = sha256(token);
    const server = await db.queryOne('SELECT id, name FROM servers WHERE agent_token_hash = ?', [hash]);
    if (!server) {
      return res.status(401).type('text/plain').send('# unknown token\n');
    }
    // 面板对 agent 的可达地址：优先系统设置，否则按当前请求推断
    const configured = String(await getSettingValue('agent_panel_url', '') || '').trim().replace(/\/+$/, '');
    const proto = String(req.get('x-forwarded-proto') || req.protocol || 'http');
    const host = req.get('host');
    const panelUrl = configured || `${proto}://${host}`;
    const interval = Math.min(Math.max(parseInt(req.query.interval, 10) || parseInt(await getSettingValue('agent_interval', '5'), 10) || 5, 2), 60);

    const { buildAgentScript } = require('../services/agent-script');
    const installer = buildInstaller(buildAgentScript(), { panelUrl, token, interval });
    res.type('text/x-shellscript').send(installer);
  } catch (err) {
    res.status(500).type('text/plain').send('# internal error\n');
  }
});

module.exports = router;
