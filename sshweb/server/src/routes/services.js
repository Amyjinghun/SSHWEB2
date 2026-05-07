const express = require('express');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { createSSHConnection, execCommand, shellQuote } = require('../ssh/connection');
const { writeAuditLog } = require('../utils/audit');

const router = express.Router();
router.use(authMiddleware);


function isValidServiceName(name) {
  return /^[a-zA-Z0-9_.@:-]+(\.service)?$/.test(String(name || ''));
}

function normalizeLines(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5000) return 100;
  return n;
}

async function getConn(req) {
  const server_id = req.body.server_id || req.query.server_id;
  if (!server_id) throw new Error('请提供 server_id');
  const server = await db.queryOne('SELECT * FROM servers WHERE id = ?', [server_id]);
  if (!server) throw new Error('服务器不存在');
  return { conn: await createSSHConnection(server), server_id };
}

router.get('/', async (req, res) => {
  try {
    const server_id = req.query.server_id;
    if (!server_id) return res.json({ code: 400, message: '请提供 server_id' });
    const server = await db.queryOne('SELECT * FROM servers WHERE id = ?', [server_id]);
    const conn = await createSSHConnection(server);
    const { out } = await execCommand(conn, "systemctl list-units --type=service --no-pager --no-legend 2>&1");
    conn.end();
    const services = out.split('\n').filter(l => l.trim()).map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        name: parts[0] || '',
        load: parts[1] || '',
        active: parts[2] || '',
        sub: parts[3] || '',
        description: parts.slice(4).join(' ')
      };
    });
    res.json({ code: 0, data: services });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.post('/action', async (req, res) => {
  try {
    const { server_id, service, action } = req.body;
    if (!server_id || !service || !action) return res.json({ code: 400, message: '参数不完整' });
    if (!isValidServiceName(service)) return res.json({ code: 400, message: '服务名称不合法' });
    const allowedActions = ['start', 'stop', 'restart', 'reload', 'enable', 'disable', 'status'];
    if (!allowedActions.includes(action)) return res.json({ code: 400, message: '不支持的操作' });
    const server = await db.queryOne('SELECT * FROM servers WHERE id = ?', [server_id]);
    const conn = await createSSHConnection(server);
    const { out, exitCode } = await execCommand(conn, `systemctl ${action} ${shellQuote(service)} 2>&1`);
    conn.end();
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: `${action}_service`, serverId: server_id, detail: { service } });
    res.json({ code: exitCode === 0 ? 0 : 500, message: exitCode === 0 ? '操作成功' : out, data: { output: out } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.get('/logs', async (req, res) => {
  try {
    const { server_id, service, lines = 100 } = req.query;
    if (!server_id || !service) return res.json({ code: 400, message: '参数不完整' });
    if (!isValidServiceName(service)) return res.json({ code: 400, message: '服务名称不合法' });
    const safeLines = normalizeLines(lines);
    const server = await db.queryOne('SELECT * FROM servers WHERE id = ?', [server_id]);
    const conn = await createSSHConnection(server);
    const { out } = await execCommand(conn, `journalctl -u ${shellQuote(service)} -n ${safeLines} --no-pager 2>&1`);
    conn.end();
    res.json({ code: 0, data: { content: out } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

module.exports = router;
