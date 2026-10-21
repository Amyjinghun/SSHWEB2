const express = require('express');
const fs = require('fs');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { listRecordings, readRecording, deleteRecording } = require('../services/term-record');

const router = express.Router();
router.use(authMiddleware);

const MAX_REPLAY_SIZE = 100 * 1024 * 1024;

// GET /api/term-logs?username=&serverId=&page=&pageSize=
router.get('/', async (req, res) => {
  try {
    let items = await listRecordings();
    // 非管理员只能看自己的录制
    if (req.user.role !== 'superadmin' && req.user.role !== 'admin') {
      items = items.filter(i => Number(i.userId) === Number(req.user.id));
    }
    const username = String(req.query.username || '').trim().toLowerCase();
    if (username) items = items.filter(i => (i.username || '').toLowerCase().includes(username));
    const serverId = Number(req.query.serverId || 0);
    if (serverId) items = items.filter(i => Number(i.serverId) === serverId);

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100);
    const total = items.length;
    const list = items.slice((page - 1) * pageSize, page * pageSize).map(({ file, ...rest }) => rest);
    res.json({ code: 0, data: { list, total, page, pageSize } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

// GET /api/term-logs/:id/content — 回放数据（头部 + 输出事件数组）
router.get('/:id/content', async (req, res) => {
  try {
    const found = await readRecording(String(req.params.id || ''));
    if (!found) return res.json({ code: 404, message: '录制不存在' });
    const stat = fs.statSync(found.file);
    if (stat.size > MAX_REPLAY_SIZE) return res.json({ code: 413, message: '录制文件过大，无法回放' });
    const raw = fs.readFileSync(found.file, 'utf8');
    const nl = raw.indexOf('\n');
    const events = [];
    for (const line of raw.slice(nl + 1).split('\n')) {
      if (!line) continue;
      try {
        const arr = JSON.parse(line);
        if (Array.isArray(arr) && arr[1] === 'o') events.push([arr[0], arr[2]]);
      } catch {}
    }
    const meta = found.header.sshweb || {};
    res.json({
      code: 0,
      data: {
        id: String(req.params.id),
        width: found.header.width || 120,
        height: found.header.height || 32,
        username: meta.username || '未知',
        serverName: meta.serverName || '',
        host: meta.host || '',
        startedAt: (found.header.timestamp || 0) * 1000,
        duration: events.length ? events[events.length - 1][0] : 0,
        events
      }
    });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

// DELETE /api/term-logs/:id — 仅管理员
router.delete('/:id', roleMiddleware('superadmin', 'admin'), async (req, res) => {
  try {
    const ok = await deleteRecording(String(req.params.id || ''));
    if (!ok) return res.json({ code: 404, message: '录制不存在' });
    res.json({ code: 0, message: '已删除' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

module.exports = router;
