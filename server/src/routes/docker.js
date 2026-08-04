// Docker 管理：通过 SSH 在目标服务器上执行 docker 命令
// 不需要额外依赖，复用现有 SSH 连接能力
const express = require('express');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { createSSHConnection, execCommand, shellQuote } = require('../ssh/connection');
const { writeAuditLog } = require('../utils/audit');

const router = express.Router();
router.use(authMiddleware);

// 安全辅助：容器 ID 只允许十六进制 + 镜像名只允许安全字符
function safeId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 128);
}

// 获取服务器 + SSH 连接
async function getServerConn(serverId) {
  const server = await db.queryOne('SELECT * FROM servers WHERE id = ?', [serverId]);
  if (!server) throw new Error('服务器不存在');
  const conn = await createSSHConnection(server);
  return { server, conn };
}

// Docker 信息
router.post('/info', async (req, res) => {
  let conn;
  try {
    const { server, conn: c } = await getServerConn(req.body.server_id);
    conn = c;
    const { out, exitCode } = await execCommand(conn, `docker info --format '{{json .}}' 2>&1`);
    conn.end(); conn = null;
    if (exitCode !== 0) return res.json({ code: 500, message: 'Docker 未安装或未运行' });
    let info = {};
    try { info = JSON.parse(out.trim()); } catch {}
    res.json({ code: 0, data: info });
  } catch (err) {
    try { if (conn) conn.end(); } catch {}
    res.json({ code: 500, message: err.message });
  }
});

// 容器列表
router.post('/containers', async (req, res) => {
  let conn;
  try {
    const { conn: c } = await getServerConn(req.body.server_id);
    conn = c;
    const { out, exitCode } = await execCommand(conn, `docker ps -a --format '{{json .}}' 2>&1`);
    conn.end(); conn = null;
    if (exitCode !== 0) return res.json({ code: 500, message: out });
    const containers = out.trim().split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    res.json({ code: 0, data: containers });
  } catch (err) {
    try { if (conn) conn.end(); } catch {}
    res.json({ code: 500, message: err.message });
  }
});

// 容器操作（start/stop/restart/rm/pause/unpause）
router.post('/containers/:id/action', async (req, res) => {
  let conn;
  try {
    const id = safeId(req.params.id);
    const action = String(req.body.action || '');
    const valid = ['start', 'stop', 'restart', 'rm', 'pause', 'unpause'];
    if (!valid.includes(action)) return res.json({ code: 400, message: '无效操作' });
    const { conn: c } = await getServerConn(req.body.server_id);
    conn = c;
    const flag = action === 'rm' ? '-f' : '';
    const { out, exitCode } = await execCommand(conn, `docker ${action} ${flag} ${safeId(id)} 2>&1`);
    conn.end(); conn = null;
    if (exitCode !== 0) return res.json({ code: 500, message: out });
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'docker_' + action, serverId: req.body.server_id, detail: { container: id } });
    res.json({ code: 0, message: '操作成功' });
  } catch (err) {
    try { if (conn) conn.end(); } catch {}
    res.json({ code: 500, message: err.message });
  }
});

// 容器日志
router.post('/containers/:id/logs', async (req, res) => {
  let conn;
  try {
    const id = safeId(req.params.id);
    const tail = Math.min(Number(req.body.tail) || 200, 2000);
    const { conn: c } = await getServerConn(req.body.server_id);
    conn = c;
    const { out, exitCode } = await execCommand(conn, `docker logs --tail ${tail} ${id} 2>&1`, 15000);
    conn.end(); conn = null;
    res.json({ code: 0, data: out });
  } catch (err) {
    try { if (conn) conn.end(); } catch {}
    res.json({ code: 500, message: err.message });
  }
});

// 镜像列表
router.post('/images', async (req, res) => {
  let conn;
  try {
    const { conn: c } = await getServerConn(req.body.server_id);
    conn = c;
    const { out, exitCode } = await execCommand(conn, `docker images --format '{{json .}}' 2>&1`);
    conn.end(); conn = null;
    if (exitCode !== 0) return res.json({ code: 500, message: out });
    const images = out.trim().split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    res.json({ code: 0, data: images });
  } catch (err) {
    try { if (conn) conn.end(); } catch {}
    res.json({ code: 500, message: err.message });
  }
});

// 删除镜像
router.post('/images/:id/delete', async (req, res) => {
  let conn;
  try {
    const id = safeId(req.params.id);
    const { conn: c } = await getServerConn(req.body.server_id);
    conn = c;
    const { out, exitCode } = await execCommand(conn, `docker rmi -f ${id} 2>&1`);
    conn.end(); conn = null;
    if (exitCode !== 0) return res.json({ code: 500, message: out });
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'docker_rmi', serverId: req.body.server_id, detail: { image: id } });
    res.json({ code: 0, message: '镜像已删除' });
  } catch (err) {
    try { if (conn) conn.end(); } catch {}
    res.json({ code: 500, message: err.message });
  }
});

// 网络列表
router.post('/networks', async (req, res) => {
  let conn;
  try {
    const { conn: c } = await getServerConn(req.body.server_id);
    conn = c;
    const { out, exitCode } = await execCommand(conn, `docker network ls --format '{{json .}}' 2>&1`);
    conn.end(); conn = null;
    if (exitCode !== 0) return res.json({ code: 500, message: out });
    const networks = out.trim().split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    res.json({ code: 0, data: networks });
  } catch (err) {
    try { if (conn) conn.end(); } catch {}
    res.json({ code: 500, message: err.message });
  }
});

// 卷列表
router.post('/volumes', async (req, res) => {
  let conn;
  try {
    const { conn: c } = await getServerConn(req.body.server_id);
    conn = c;
    const { out, exitCode } = await execCommand(conn, `docker volume ls --format '{{json .}}' 2>&1`);
    conn.end(); conn = null;
    if (exitCode !== 0) return res.json({ code: 500, message: out });
    const volumes = out.trim().split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    res.json({ code: 0, data: volumes });
  } catch (err) {
    try { if (conn) conn.end(); } catch {}
    res.json({ code: 500, message: err.message });
  }
});

// 系统清理（prune）
router.post('/prune', async (req, res) => {
  let conn;
  try {
    const { type = 'all' } = req.body;
    const validTypes = ['all', 'container', 'image', 'volume', 'network'];
    if (!validTypes.includes(type)) return res.json({ code: 400, message: '无效类型' });
    const { conn: c } = await getServerConn(req.body.server_id);
    conn = c;
    let cmd = type === 'all' ? 'docker system prune -af 2>&1' : `docker ${type} prune -f 2>&1`;
    const { out, exitCode } = await execCommand(conn, cmd, 30000);
    conn.end(); conn = null;
    if (exitCode !== 0) return res.json({ code: 500, message: out });
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'docker_prune', serverId: req.body.server_id, detail: { type } });
    res.json({ code: 0, message: '清理完成', data: out });
  } catch (err) {
    try { if (conn) conn.end(); } catch {}
    res.json({ code: 500, message: err.message });
  }
});

// 容器 stats（实时资源占用）
router.post('/containers/:id/stats', async (req, res) => {
  let conn;
  try {
    const id = safeId(req.params.id);
    const { conn: c } = await getServerConn(req.body.server_id);
    conn = c;
    const { out, exitCode } = await execCommand(conn, `docker stats --no-stream --format '{{json .}}' ${id} 2>&1`);
    conn.end(); conn = null;
    if (exitCode !== 0) return res.json({ code: 500, message: out });
    let stats = {};
    try { stats = JSON.parse(out.trim()); } catch {}
    res.json({ code: 0, data: stats });
  } catch (err) {
    try { if (conn) conn.end(); } catch {}
    res.json({ code: 500, message: err.message });
  }
});

module.exports = router;
