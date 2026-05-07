const express = require('express');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const groups = await db.query('SELECT g.*, (SELECT COUNT(*) FROM servers WHERE group_id = g.id) as server_count FROM server_groups g ORDER BY g.sort_order, g.id');
    res.json({ code: 0, data: groups });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, sort_order } = req.body;
    if (!name) return res.json({ code: 400, message: '分组名称不能为空' });
    const id = await db.insert('INSERT INTO server_groups (name, sort_order) VALUES (?, ?)', [name, sort_order || 0]);
    res.json({ code: 0, message: '分组创建成功', data: { id } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, sort_order } = req.body;
    await db.update('UPDATE server_groups SET name=COALESCE(?,name), sort_order=COALESCE(?,sort_order) WHERE id=?', [name || null, sort_order ?? null, req.params.id]);
    res.json({ code: 0, message: '更新成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.update('UPDATE servers SET group_id = NULL WHERE group_id = ?', [req.params.id]);
    await db.remove('DELETE FROM server_groups WHERE id = ?', [req.params.id]);
    res.json({ code: 0, message: '分组已删除' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

module.exports = router;
