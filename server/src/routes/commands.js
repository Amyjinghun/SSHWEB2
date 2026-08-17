const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { createSSHConnection, execCommand, isDangerousCommand } = require('../ssh/connection');
const { writeAuditLog } = require('../utils/audit');
const { runWithConcurrency } = require('../utils/async');

const router = express.Router();
const commandLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { code: 429, message: '命令操作过于频繁，请稍后再试' }
});
router.use(authMiddleware);

// 命令模板 CRUD
router.get('/templates', async (req, res) => {
  try {
    const { category, keyword } = req.query;
    let sql = 'SELECT * FROM command_templates WHERE 1=1';
    const params = [];
    if (category) { sql += ' AND category = ?'; params.push(category); }
    if (keyword) { sql += ' AND (name LIKE ? OR command LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
    sql += ' ORDER BY id DESC';
    const templates = await db.query(sql, params);
    res.json({ code: 0, data: templates });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.post('/templates', async (req, res) => {
  try {
    const { name, category, command, description, is_dangerous } = req.body;
    if (!name || !command) return res.json({ code: 400, message: '模板名称和命令为必填项' });
    const id = await db.insert('INSERT INTO command_templates (name, category, command, description, is_dangerous) VALUES (?, ?, ?, ?, ?)', [name, category || null, command, description || null, is_dangerous ? 1 : 0]);
    res.json({ code: 0, message: '模板创建成功', data: { id } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.put('/templates/:id', async (req, res) => {
  try {
    const { name, category, command, description, is_dangerous } = req.body;
    await db.update('UPDATE command_templates SET name=COALESCE(?,name), category=COALESCE(?,category), command=COALESCE(?,command), description=COALESCE(?,description), is_dangerous=COALESCE(?,is_dangerous) WHERE id=?', [name || null, category || null, command || null, description || null, is_dangerous ?? null, req.params.id]);
    res.json({ code: 0, message: '更新成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.delete('/templates/:id', async (req, res) => {
  try {
    await db.remove('DELETE FROM command_templates WHERE id = ?', [req.params.id]);
    res.json({ code: 0, message: '模板已删除' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

// 单台服务器执行命令
router.post('/exec', commandLimiter, async (req, res) => {
  try {
    const { server_id, command, timeout } = req.body;
    if (!server_id || !command) return res.json({ code: 400, message: '请选择服务器并输入命令' });
    const settings = await db.queryOne("SELECT setting_value FROM settings WHERE setting_key='enable_dangerous_block'");
    if (settings && settings.setting_value === 'true' && isDangerousCommand(command)) {
      return res.json({ code: 403, message: '该命令被安全策略拦截，属于危险命令' });
    }
    const server = await db.queryOne('SELECT * FROM servers WHERE id = ?', [server_id]);
    if (!server) return res.json({ code: 404, message: '服务器不存在' });
    const logId = await db.insert('INSERT INTO command_logs (user_id, server_id, command, execute_type) VALUES (?, ?, ?, ?)', [req.user.id, server_id, command, 'single']);
    const start = Date.now();
    try {
      const conn = await createSSHConnection(server);
      const result = await execCommand(conn, command, timeout);
      conn.end();
      const duration = Date.now() - start;
      await db.update('UPDATE command_logs SET status=?, exit_code=?, stdout=?, stderr=?, duration_ms=?, finished_at=NOW() WHERE id=?', [
        result.exitCode === 0 ? 'success' : 'failed', result.exitCode, result.stdout, result.stderr, duration, logId
      ]);
      await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'exec_command', serverId: server_id, detail: { command } });
      res.json({ code: 0, data: { id: logId, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, duration } });
    } catch (err) {
      const duration = Date.now() - start;
      await db.update('UPDATE command_logs SET status=?, error_message=?, duration_ms=?, finished_at=NOW() WHERE id=?', ['failed', err.message, duration, logId]);
      res.json({ code: 500, message: err.message });
    }
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

// 批量执行命令
router.post('/batch-exec', commandLimiter, async (req, res) => {
  try {
    const { command, server_ids, name } = req.body;
    if (!command || !server_ids?.length) return res.json({ code: 400, message: '请输入命令并选择服务器' });
    if (isDangerousCommand(command)) {
      const allow = await db.queryOne("SELECT setting_value FROM settings WHERE setting_key='allow_batch_dangerous'");
      if (!allow || allow.setting_value !== 'true') {
        return res.json({ code: 403, message: '批量执行不允许执行危险命令' });
      }
    }
    const taskId = await db.insert(
      'INSERT INTO batch_tasks (user_id, name, command, server_ids, status, total_count) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, name || null, command, JSON.stringify(server_ids), 'running', server_ids.length]
    );
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'batch_exec', detail: { command, serverCount: server_ids.length } });
    res.json({ code: 0, message: '批量任务已创建', data: { taskId } });

    // 异步执行。取消任务时会停止后续服务器执行，并避免最终状态覆盖 cancelled。
    (async () => {
      let success = 0, failed = 0;
      const isCancelled = async () => {
        const task = await db.queryOne('SELECT status FROM batch_tasks WHERE id = ?', [taskId]);
        return !task || task.status === 'cancelled';
      };

      // 有限并发执行（取消后不再领取新任务，进行中的命令自然跑完）
      await runWithConcurrency(server_ids, 5, async (sid) => {
        if (await isCancelled()) return;

        const logId = await db.insert('INSERT INTO command_logs (task_id, user_id, server_id, command, execute_type, status) VALUES (?, ?, ?, ?, ?, ?)', [taskId, req.user.id, sid, command, 'batch', 'running']);
        const start = Date.now();
        let conn;
        try {
          const server = await db.queryOne('SELECT * FROM servers WHERE id = ?', [sid]);
          if (!server) throw new Error('服务器不存在');
          if (await isCancelled()) {
            await db.update('UPDATE command_logs SET status=?, error_message=?, duration_ms=?, finished_at=NOW() WHERE id=?', ['cancelled', '任务已取消，未执行该服务器', Date.now() - start, logId]);
            return;
          }
          conn = await createSSHConnection(server);
          const result = await execCommand(conn, command);
          const duration = Date.now() - start;
          await db.update('UPDATE command_logs SET status=?, exit_code=?, stdout=?, stderr=?, duration_ms=?, finished_at=NOW() WHERE id=?', [
            result.exitCode === 0 ? 'success' : 'failed', result.exitCode, result.stdout, result.stderr, duration, logId
          ]);
          if (result.exitCode === 0) success++; else failed++;
        } catch (err) {
          const duration = Date.now() - start;
          const cancelled = await isCancelled();
          await db.update('UPDATE command_logs SET status=?, error_message=?, duration_ms=?, finished_at=NOW() WHERE id=?', [cancelled ? 'cancelled' : 'failed', cancelled ? '任务已取消' : err.message, duration, logId]);
          if (!cancelled) failed++;
        } finally {
          try { if (conn) conn.end(); } catch {}
        }
      });

      const current = await db.queryOne('SELECT status FROM batch_tasks WHERE id = ?', [taskId]);
      if (current && current.status !== 'cancelled') {
        const status = failed === 0 ? 'success' : (success === 0 ? 'failed' : 'partial_success');
        await db.update('UPDATE batch_tasks SET status=?, success_count=?, failed_count=?, finished_at=NOW() WHERE id=?', [status, success, failed, taskId]);
      } else {
        await db.update('UPDATE batch_tasks SET success_count=?, failed_count=?, finished_at=COALESCE(finished_at, NOW()) WHERE id=?', [success, failed, taskId]);
      }
    })();
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

// 取消批量任务
router.post('/batch-exec/:taskId/cancel', commandLimiter, async (req, res) => {
  try {
    await db.update('UPDATE batch_tasks SET status = ?, finished_at = COALESCE(finished_at, NOW()) WHERE id = ? AND status = ?', ['cancelled', req.params.taskId, 'running']);
    res.json({ code: 0, message: '任务已取消' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

// 查询执行日志
router.get('/logs', async (req, res) => {
  try {
    const { server_id, status, execute_type, keyword, page = 1, pageSize = 20 } = req.query;
    let sql = `SELECT cl.*, s.name as server_name, s.host as server_host FROM command_logs cl LEFT JOIN servers s ON cl.server_id = s.id WHERE 1=1`;
    const params = [];
    if (server_id) { sql += ' AND cl.server_id = ?'; params.push(server_id); }
    if (status) { sql += ' AND cl.status = ?'; params.push(status); }
    if (execute_type) { sql += ' AND cl.execute_type = ?'; params.push(execute_type); }
    if (keyword) { sql += ' AND cl.command LIKE ?'; params.push(`%${keyword}%`); }
    // COUNT 复用与列表一致的 WHERE（含 execute_type 条件），避免过滤参数与占位符错位
    const countSql = sql.replace('SELECT cl.*, s.name as server_name, s.host as server_host', 'SELECT COUNT(*) as total');
    const [{ total }] = await db.query(countSql, [...params]);
    sql += ' ORDER BY cl.id DESC LIMIT ? OFFSET ?';
    params.push(parseInt(pageSize), (parseInt(page) - 1) * parseInt(pageSize));
    const logs = await db.query(sql, params);
    res.json({ code: 0, data: { list: logs, total, page: parseInt(page), pageSize: parseInt(pageSize) } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.get('/logs/:id', async (req, res) => {
  try {
    const log = await db.queryOne('SELECT cl.*, s.name as server_name, s.host as server_host FROM command_logs cl LEFT JOIN servers s ON cl.server_id = s.id WHERE cl.id = ?', [req.params.id]);
    if (!log) return res.json({ code: 404, message: '记录不存在' });
    res.json({ code: 0, data: log });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

// 批量任务列表
router.get('/batch-tasks', async (req, res) => {
  try {
    const tasks = await db.query('SELECT bt.*, u.username FROM batch_tasks bt LEFT JOIN users u ON bt.user_id = u.id ORDER BY bt.id DESC LIMIT 50');
    res.json({ code: 0, data: tasks });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.get('/batch-tasks/:id', async (req, res) => {
  try {
    const task = await db.queryOne('SELECT bt.*, u.username FROM batch_tasks bt LEFT JOIN users u ON bt.user_id = u.id WHERE bt.id = ?', [req.params.id]);
    if (!task) return res.json({ code: 404, message: '任务不存在' });
    const logs = await db.query('SELECT cl.*, s.name as server_name, s.host as server_host FROM command_logs cl LEFT JOIN servers s ON cl.server_id = s.id WHERE cl.task_id = ?', [req.params.id]);
    res.json({ code: 0, data: { ...task, logs } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

module.exports = router;
