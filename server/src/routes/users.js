const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { writeAuditLog } = require('../utils/audit');

const router = express.Router();

const VALID_ROLES = ['superadmin', 'admin'];
function isValidRole(role) {
  return VALID_ROLES.includes(String(role || '').trim());
}
const userLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { code: 429, message: '用户敏感操作过于频繁，请稍后再试' }
});
router.use(authMiddleware);

router.get('/', roleMiddleware('superadmin', 'admin'), async (req, res) => {
  try {
    const users = await db.query('SELECT id, username, role, status, last_login_at, created_at FROM users ORDER BY id');
    res.json({ code: 0, data: users });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.post('/', userLimiter, roleMiddleware('superadmin'), async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) return res.json({ code: 400, message: '请输入用户名和密码' });
    if (!isValidRole(role)) return res.json({ code: 400, message: '用户角色不合法' });
    const exists = await db.queryOne('SELECT id FROM users WHERE username = ?', [username]);
    if (exists) return res.json({ code: 400, message: '用户名已存在' });
    const hash = await bcrypt.hash(password, 10);
    const id = await db.insert('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [username, hash, role || 'admin']);
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'create_user', targetType: 'user', targetId: id, detail: { username, role } });
    res.json({ code: 0, message: '用户创建成功', data: { id } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.put('/:id', roleMiddleware('superadmin'), async (req, res) => {
  try {
    const { username, role, status } = req.body;
    if (role !== undefined && !isValidRole(role)) return res.json({ code: 400, message: '用户角色不合法' });
    if (username) {
      const exists = await db.queryOne('SELECT id FROM users WHERE username = ? AND id != ?', [username, req.params.id]);
      if (exists) return res.json({ code: 400, message: '用户名已存在' });
    }
    await db.update('UPDATE users SET username=COALESCE(?,username), role=COALESCE(?,role), status=COALESCE(?,status) WHERE id=?', [username || null, role || null, status ?? null, req.params.id]);
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'update_user', targetType: 'user', targetId: req.params.id });
    res.json({ code: 0, message: '更新成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.delete('/:id', roleMiddleware('superadmin'), async (req, res) => {
  try {
    if (req.params.id == req.user.id) return res.json({ code: 400, message: '不能删除自己' });
    await db.remove('DELETE FROM users WHERE id = ?', [req.params.id]);
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'delete_user', targetType: 'user', targetId: req.params.id });
    res.json({ code: 0, message: '用户已删除' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.post('/:id/reset-password', userLimiter, roleMiddleware('superadmin'), async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.json({ code: 400, message: '密码至少6位' });
    const hash = await bcrypt.hash(newPassword, 10);
    await db.update('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [hash, req.params.id]);
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'reset_password', targetType: 'user', targetId: req.params.id });
    res.json({ code: 0, message: '密码已重置' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

module.exports = router;
