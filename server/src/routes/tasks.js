const express = require('express');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { createSSHConnection, execCommand, isDangerousCommand } = require('../ssh/connection');
const { writeAuditLog } = require('../utils/audit');

const router = express.Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const { server_id, enabled } = req.query;
    let sql = 'SELECT st.*, s.name as server_name FROM scheduled_tasks st LEFT JOIN servers s ON st.server_id = s.id WHERE 1=1';
    const params = [];
    if (server_id) { sql += ' AND st.server_id = ?'; params.push(server_id); }
    if (enabled !== undefined) { sql += ' AND st.enabled = ?'; params.push(enabled); }
    sql += ' ORDER BY st.id DESC';
    const tasks = await db.query(sql, params);
    res.json({ code: 0, data: tasks });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, server_id, command, cron_expr, enabled, remark } = req.body;
    if (!name || !command || !cron_expr) return res.json({ code: 400, message: '名称、命令和cron表达式为必填项' });
    if (isDangerousCommand(command)) return res.json({ code: 403, message: '计划任务不允许保存危险命令' });
    const id = await db.insert('INSERT INTO scheduled_tasks (name, server_id, command, cron_expr, enabled, remark) VALUES (?, ?, ?, ?, ?, ?)', [name, server_id || null, command, cron_expr, enabled ?? 1, remark || null]);
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'create_scheduled_task', targetType: 'scheduled_task', targetId: id });
    res.json({ code: 0, message: '计划任务创建成功', data: { id } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, server_id, command, cron_expr, enabled, remark } = req.body;
    if (command !== undefined && isDangerousCommand(command)) return res.json({ code: 403, message: '计划任务不允许保存危险命令' });
    await db.update('UPDATE scheduled_tasks SET name=COALESCE(?,name), server_id=COALESCE(?,server_id), command=COALESCE(?,command), cron_expr=COALESCE(?,cron_expr), enabled=COALESCE(?,enabled), remark=COALESCE(?,remark) WHERE id=?', [name || null, server_id || null, command || null, cron_expr || null, enabled ?? null, remark || null, req.params.id]);
    res.json({ code: 0, message: '更新成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.remove('DELETE FROM scheduled_tasks WHERE id = ?', [req.params.id]);
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'delete_scheduled_task', targetType: 'scheduled_task', targetId: req.params.id });
    res.json({ code: 0, message: '任务已删除' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.post('/:id/enable', async (req, res) => {
  try {
    await db.update('UPDATE scheduled_tasks SET enabled = 1 WHERE id = ?', [req.params.id]);
    res.json({ code: 0, message: '已启用' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

router.post('/:id/disable', async (req, res) => {
  try {
    await db.update('UPDATE scheduled_tasks SET enabled = 0 WHERE id = ?', [req.params.id]);
    res.json({ code: 0, message: '已禁用' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

router.post('/:id/run', async (req, res) => {
  try {
    const task = await db.queryOne('SELECT st.*, s.* FROM scheduled_tasks st LEFT JOIN servers s ON st.server_id = s.id WHERE st.id = ?', [req.params.id]);
    if (!task) return res.json({ code: 404, message: '任务不存在' });
    if (isDangerousCommand(task.command)) return res.json({ code: 403, message: '该计划任务命令被安全策略拦截' });
    if (task.server_id) {
      const conn = await createSSHConnection(task);
      const result = await execCommand(conn, task.command);
      conn.end();
      await db.update('UPDATE scheduled_tasks SET last_run_at = NOW() WHERE id = ?', [req.params.id]);
      res.json({ code: 0, message: '执行完成', data: { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr } });
    } else {
      res.json({ code: 400, message: '该任务未关联服务器' });
    }
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

module.exports = router;
