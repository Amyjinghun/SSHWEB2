// 本机文件浏览：列出面板所在服务器上的文件/目录
// 用于文件分发时选择本机文件上传到远程服务器
const express = require('express');
const fs = require('fs');
const path = require('path');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { createSSHConnection } = require('../ssh/connection');
const { writeAuditLog } = require('../utils/audit');
const db = require('../db');

const router = express.Router();
// 本机文件可触达面板全盘（含 .env 等敏感文件），仅管理员可用
router.use(authMiddleware, roleMiddleware('superadmin', 'admin'));

function getSftp(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => err ? reject(err) : resolve(sftp));
  });
}

// 列出目录内容
router.get('/list', (req, res) => {
  const requested = String(req.query.path || '/');
  try {
    const resolved = path.resolve(requested);
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return res.json({ code: 400, message: '不是目录' });

    const items = fs.readdirSync(resolved, { withFileTypes: true }).map(d => {
      const fullPath = path.join(resolved, d.name);
      let size = 0;
      let mtime = '';
      try {
        const s = fs.statSync(fullPath);
        size = s.size;
        mtime = s.mtime.toISOString();
      } catch {}
      return { name: d.name, path: fullPath, isDir: d.isDirectory(), isFile: d.isFile(), size, mtime };
    });
    items.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
    res.json({ code: 0, data: { path: resolved, parent: path.dirname(resolved), items } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

// 下载本机文件（用于分发到远程服务器）
router.get('/download', (req, res) => {
  const filePath = String(req.query.path || '');
  if (!filePath) return res.json({ code: 400, message: '缺少 path' });
  try {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) return res.json({ code: 404, message: '文件不存在' });
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) return res.json({ code: 400, message: '不能下载目录' });
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(path.basename(resolved))}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    fs.createReadStream(resolved).pipe(res);
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

// 从本机分发文件到远程服务器（SFTP 上传）
router.post('/distribute', async (req, res) => {
  try {
    const { local_path, target_path, target_servers } = req.body;
    if (!local_path || !target_path || !target_servers?.length) {
      return res.json({ code: 400, message: '参数不完整' });
    }
    const resolved = path.resolve(local_path);
    if (!fs.existsSync(resolved)) return res.json({ code: 404, message: '本机文件不存在' });
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) return res.json({ code: 400, message: '不能分发目录' });

    const results = [];
    for (const sid of target_servers) {
      const server = await db.queryOne('SELECT id, name, host FROM servers WHERE id = ?', [sid]);
      if (!server) { results.push({ server_name: '-', host: '-', success: false, message: '服务器不存在' }); continue; }
      let conn;
      try {
        conn = await createSSHConnection(await db.queryOne('SELECT * FROM servers WHERE id = ?', [sid]));
        const sftp = await getSftp(conn);
        // 确保目标目录存在
        const targetDir = path.posix.dirname(target_path);
        await new Promise(resolve => { sftp.mkdir(targetDir, () => resolve()); });
        // 上传
        await new Promise((resolve, reject) => {
          const rs = fs.createReadStream(resolved);
          const ws = sftp.createWriteStream(target_path);
          ws.on('close', resolve);
          ws.on('error', reject);
          rs.on('error', reject);
          rs.pipe(ws);
        });
        conn.end(); conn = null;
        results.push({ server_name: server.name, host: server.host, success: true, message: '上传成功' });
      } catch (err) {
        try { if (conn) conn.end(); } catch {}
        results.push({ server_name: server.name, host: server.host, success: false, message: err.message });
      }
    }
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'local_file_distribute', detail: { local_path, target_path, count: target_servers.length } });
    res.json({ code: 0, message: '分发完成', data: { results } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

module.exports = router;
