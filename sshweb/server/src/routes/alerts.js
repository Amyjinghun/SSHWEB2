const express = require('express');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// 告警规则
router.get('/rules', async (req, res) => {
  try {
    const rules = await db.query('SELECT * FROM alert_rules ORDER BY id DESC');
    rules.forEach(r => { try { r.condition_json = JSON.parse(r.condition_json); } catch {} try { r.notify_channels = JSON.parse(r.notify_channels); } catch {} });
    res.json({ code: 0, data: rules });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

router.post('/rules', async (req, res) => {
  try {
    const { name, type, condition, level, notify_channels, enabled } = req.body;
    if (!name || !type) return res.json({ code: 400, message: '名称和类型为必填项' });
    const id = await db.insert('INSERT INTO alert_rules (name, type, condition_json, level, notify_channels, enabled) VALUES (?,?,?,?,?,?)',
      [name, type, JSON.stringify(condition || {}), level || 'warning', JSON.stringify(notify_channels || []), enabled ?? 1]);
    res.json({ code: 0, message: '告警规则创建成功', data: { id } });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

router.put('/rules/:id', async (req, res) => {
  try {
    const { name, type, condition, level, notify_channels, enabled } = req.body;
    await db.update('UPDATE alert_rules SET name=COALESCE(?,name), type=COALESCE(?,type), condition_json=COALESCE(?,condition_json), level=COALESCE(?,level), notify_channels=COALESCE(?,notify_channels), enabled=COALESCE(?,enabled) WHERE id=?',
      [name || null, type || null, condition ? JSON.stringify(condition) : null, level || null, notify_channels ? JSON.stringify(notify_channels) : null, enabled ?? null, req.params.id]);
    res.json({ code: 0, message: '更新成功' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

router.delete('/rules/:id', async (req, res) => {
  try {
    await db.remove('DELETE FROM alert_rules WHERE id=?', [req.params.id]);
    res.json({ code: 0, message: '已删除' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

// 告警记录
router.get('/logs', async (req, res) => {
  try {
    const { status, level, server_id, page = 1, pageSize = 20 } = req.query;
    let sql = 'SELECT al.*, s.name as server_name FROM alert_logs al LEFT JOIN servers s ON al.server_id = s.id WHERE 1=1';
    const params = [];
    if (status) { sql += ' AND al.status=?'; params.push(status); }
    if (level) { sql += ' AND al.level=?'; params.push(level); }
    if (server_id) { sql += ' AND al.server_id=?'; params.push(server_id); }
    sql += ' ORDER BY al.id DESC LIMIT ? OFFSET ?';
    params.push(parseInt(pageSize), (parseInt(page) - 1) * parseInt(pageSize));
    const logs = await db.query(sql, params);
    res.json({ code: 0, data: logs });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

router.post('/logs/:id/ignore', async (req, res) => {
  try {
    await db.update('UPDATE alert_logs SET status=? WHERE id=?', ['ignored', req.params.id]);
    res.json({ code: 0, message: '已忽略' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

module.exports = router;
