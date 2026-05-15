const express = require('express');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const { action, username, server_id, status, start_date, end_date, page = 1, pageSize = 20 } = req.query;
    let sql = 'SELECT al.*, s.name as server_name FROM audit_logs al LEFT JOIN servers s ON al.server_id = s.id WHERE 1=1';
    const params = [];
    if (action) { sql += ' AND al.action=?'; params.push(action); }
    if (username) { sql += ' AND al.username=?'; params.push(username); }
    if (server_id) { sql += ' AND al.server_id=?'; params.push(server_id); }
    if (status) { sql += ' AND al.status=?'; params.push(status); }
    if (start_date) { sql += ' AND al.created_at>=?'; params.push(start_date); }
    if (end_date) { sql += ' AND al.created_at<=?'; params.push(end_date); }
    const countSql = sql.replace('SELECT al.*, s.name as server_name', 'SELECT COUNT(*) as total');
    const [{ total }] = await db.query(countSql, [...params]);
    sql += ' ORDER BY al.id DESC LIMIT ? OFFSET ?';
    params.push(parseInt(pageSize), (parseInt(page) - 1) * parseInt(pageSize));
    const logs = await db.query(sql, params);
    res.json({ code: 0, data: { list: logs, total, page: parseInt(page), pageSize: parseInt(pageSize) } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

module.exports = router;
