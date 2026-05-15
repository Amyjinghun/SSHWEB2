const express = require('express');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { createSSHConnection, execCommand, isDangerousCommand } = require('../ssh/connection');
const { writeAuditLog } = require('../utils/audit');

const router = express.Router();
router.use(authMiddleware);

function parseIdList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(Number).filter(Boolean);
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(Number).filter(Boolean) : [];
  } catch {
    return String(value).split(',').map(v => Number(v.trim())).filter(Boolean);
  }
}

function normalizeTarget(body = {}) {
  const targetType = body.target_type || (body.group_id ? 'group' : (body.server_ids?.length ? 'server_list' : 'server'));
  const serverIds = parseIdList(body.server_ids);
  const serverId = body.server_id ? Number(body.server_id) : null;
  const groupId = body.group_id ? Number(body.group_id) : null;

  if (targetType === 'server') {
    if (!serverId) throw new Error('请选择目标服务器');
    return { targetType, serverId, serverIds: [], groupId: null };
  }
  if (targetType === 'server_list') {
    if (!serverIds.length) throw new Error('请至少勾选一台服务器');
    return { targetType, serverId: null, serverIds, groupId: null };
  }
  if (targetType === 'group') {
    if (!groupId) throw new Error('请选择服务器分组');
    return { targetType, serverId: null, serverIds: [], groupId };
  }
  throw new Error('目标类型不正确');
}

async function getTargetServers(task) {
  const type = task.target_type || (task.server_id ? 'server' : 'server_list');
  if (type === 'group') {
    return db.query('SELECT * FROM servers WHERE group_id = ? ORDER BY id ASC', [task.group_id]);
  }
  if (type === 'server_list') {
    const ids = parseIdList(task.server_ids);
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    return db.query(`SELECT * FROM servers WHERE id IN (${placeholders}) ORDER BY id ASC`, ids);
  }
  if (!task.server_id) return [];
  return db.query('SELECT * FROM servers WHERE id = ?', [task.server_id]);
}

async function runCommandOnServers(task, servers) {
  const results = [];
  for (const server of servers) {
    const start = Date.now();
    let conn;
    try {
      conn = await createSSHConnection(server);
      const result = await execCommand(conn, task.command);
      results.push({
        server_id: server.id,
        server_name: server.name,
        host: server.host,
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        duration: Date.now() - start
      });
    } catch (err) {
      results.push({ server_id: server.id, server_name: server.name, host: server.host, success: false, message: err.message, duration: Date.now() - start });
    } finally {
      try { if (conn) conn.end(); } catch {}
    }
  }
  return results;
}

router.get('/', async (req, res) => {
  try {
    const { server_id, enabled } = req.query;
    let sql = `SELECT st.*, s.name as server_name, g.name as group_name,
      CASE
        WHEN st.target_type = 'group' THEN (SELECT COUNT(*) FROM servers WHERE group_id = st.group_id)
        WHEN st.target_type = 'server_list' THEN JSON_LENGTH(st.server_ids)
        WHEN st.server_id IS NOT NULL THEN 1
        ELSE 0
      END AS target_count
      FROM scheduled_tasks st
      LEFT JOIN servers s ON st.server_id = s.id
      LEFT JOIN server_groups g ON st.group_id = g.id
      WHERE 1=1`;
    const params = [];
    if (server_id) { sql += ' AND (st.server_id = ? OR JSON_CONTAINS(st.server_ids, JSON_ARRAY(CAST(? AS UNSIGNED))))'; params.push(server_id, server_id); }
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
    const { name, command, cron_expr, enabled, remark } = req.body;
    if (!name || !command || !cron_expr) return res.json({ code: 400, message: '名称、命令和cron表达式为必填项' });
    if (isDangerousCommand(command)) return res.json({ code: 403, message: '计划任务不允许保存危险命令' });
    const target = normalizeTarget(req.body);
    const id = await db.insert(
      'INSERT INTO scheduled_tasks (name, target_type, server_id, server_ids, group_id, command, cron_expr, enabled, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, target.targetType, target.serverId, JSON.stringify(target.serverIds), target.groupId, command, cron_expr, enabled ?? 1, remark || null]
    );
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'create_scheduled_task', targetType: 'scheduled_task', targetId: id });
    res.json({ code: 0, message: '计划任务创建成功', data: { id } });
  } catch (err) {
    res.json({ code: err.message.includes('请选择') || err.message.includes('勾选') ? 400 : 500, message: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, command, cron_expr, enabled, remark } = req.body;
    if (command !== undefined && isDangerousCommand(command)) return res.json({ code: 403, message: '计划任务不允许保存危险命令' });
    const target = normalizeTarget(req.body);
    await db.update(
      'UPDATE scheduled_tasks SET name=COALESCE(?,name), target_type=?, server_id=?, server_ids=?, group_id=?, command=COALESCE(?,command), cron_expr=COALESCE(?,cron_expr), enabled=COALESCE(?,enabled), remark=? WHERE id=?',
      [name || null, target.targetType, target.serverId, JSON.stringify(target.serverIds), target.groupId, command || null, cron_expr || null, enabled ?? null, remark || null, req.params.id]
    );
    res.json({ code: 0, message: '更新成功' });
  } catch (err) {
    res.json({ code: err.message.includes('请选择') || err.message.includes('勾选') ? 400 : 500, message: err.message });
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
    const task = await db.queryOne('SELECT * FROM scheduled_tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.json({ code: 404, message: '任务不存在' });
    if (isDangerousCommand(task.command)) return res.json({ code: 403, message: '该计划任务命令被安全策略拦截' });
    const servers = await getTargetServers(task);
    if (!servers.length) return res.json({ code: 400, message: '未找到可执行的目标服务器' });
    const results = await runCommandOnServers(task, servers);
    await db.update('UPDATE scheduled_tasks SET last_run_at = NOW() WHERE id = ?', [req.params.id]);
    const success = results.filter(r => r.success).length;
    const failed = results.length - success;
    res.json({ code: 0, message: '执行完成', data: { total: results.length, success, failed, results } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

module.exports = router;
