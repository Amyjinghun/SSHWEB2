const express = require('express');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { createSSHConnection, execCommand } = require('../ssh/connection');
const { writeAuditLog } = require('../utils/audit');

const router = express.Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const { server_id } = req.query;
    if (!server_id) return res.json({ code: 400, message: '请提供 server_id' });
    const server = await db.queryOne('SELECT * FROM servers WHERE id = ?', [server_id]);
    const conn = await createSSHConnection(server);
    const { out } = await execCommand(conn, 'ps aux --sort=-%cpu | head -100');
    conn.end();
    const lines = out.split('\n').filter(l => l.trim());
    const headers = lines[0]?.split(/\s+/) || [];
    const processes = lines.slice(1).map(line => {
      const p = line.split(/\s+/);
      return { user: p[0], pid: p[1], cpu: p[2], mem: p[3], vsz: p[4], rss: p[5], stat: p[7] || '', start: p[8] || '', command: p.slice(10).join(' ') };
    });
    res.json({ code: 0, data: processes });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.post('/:pid/kill', async (req, res) => {
  try {
    const { server_id } = req.body;
    const pid = Number(req.params.pid);
    if (!Number.isInteger(pid) || pid <= 0) return res.json({ code: 400, message: 'PID 不合法' });
    if (!server_id) return res.json({ code: 400, message: '请提供 server_id' });
    const server = await db.queryOne('SELECT * FROM servers WHERE id = ?', [server_id]);
    const conn = await createSSHConnection(server);
    const { exitCode, out } = await execCommand(conn, `kill ${pid} 2>&1`);
    conn.end();
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'kill_process', serverId: server_id, detail: { pid } });
    res.json({ code: exitCode === 0 ? 0 : 500, message: exitCode === 0 ? '进程已终止' : out });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.post('/:pid/force-kill', async (req, res) => {
  try {
    const { server_id } = req.body;
    const pid = Number(req.params.pid);
    if (!Number.isInteger(pid) || pid <= 0) return res.json({ code: 400, message: 'PID 不合法' });
    if (!server_id) return res.json({ code: 400, message: '请提供 server_id' });
    const server = await db.queryOne('SELECT * FROM servers WHERE id = ?', [server_id]);
    const conn = await createSSHConnection(server);
    const { exitCode, out } = await execCommand(conn, `kill -9 ${pid} 2>&1`);
    conn.end();
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'force_kill_process', serverId: server_id, detail: { pid } });
    res.json({ code: exitCode === 0 ? 0 : 500, message: exitCode === 0 ? '进程已强制终止' : out });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

module.exports = router;
