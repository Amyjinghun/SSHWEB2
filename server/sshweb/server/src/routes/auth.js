const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const config = require('../config');
const { authMiddleware } = require('../middleware/auth');
const { writeAuditLog } = require('../utils/audit');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { code: 429, message: '登录尝试过于频繁，请15分钟后再试' }
});

const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { code: 429, message: '密码操作过于频繁，请稍后再试' }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.json({ code: 400, message: '请输入用户名和密码' });
    }
    const user = await db.queryOne('SELECT * FROM users WHERE username = ? AND status = 1', [username]);
    if (!user) {
      await writeAuditLog({ username, action: 'login', ip: req.ip, userAgent: req.get('User-Agent'), status: 'failed', errorMessage: '用户不存在或已禁用' });
      return res.json({ code: 401, message: '用户名或密码错误' });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await writeAuditLog({ userId: user.id, username, action: 'login', ip: req.ip, userAgent: req.get('User-Agent'), status: 'failed', errorMessage: '密码错误' });
      return res.json({ code: 401, message: '用户名或密码错误' });
    }
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role, tokenVersion: user.token_version || 0 }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    await writeAuditLog({ userId: user.id, username, action: 'login', ip: req.ip, userAgent: req.get('User-Agent') });
    res.json({ code: 0, message: '登录成功', data: { token, user: { id: user.id, username: user.username, role: user.role } } });
  } catch (err) {
    res.json({ code: 500, message: '服务器错误: ' + err.message });
  }
});

router.post('/logout', authMiddleware, async (req, res) => {
  await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'logout', ip: req.ip, userAgent: req.get('User-Agent') });
  res.json({ code: 0, message: '已退出登录' });
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await db.queryOne('SELECT id, username, role, last_login_at FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.json({ code: 404, message: '用户不存在' });
    res.json({ code: 0, data: user });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.post('/change-password', passwordLimiter, authMiddleware, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.json({ code: 400, message: '请输入旧密码和新密码' });
    if (newPassword.length < 6) return res.json({ code: 400, message: '新密码至少6位' });
    const user = await db.queryOne('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.json({ code: 404, message: '用户不存在' });
    const valid = await bcrypt.compare(oldPassword, user.password_hash);
    if (!valid) return res.json({ code: 400, message: '旧密码错误' });
    const hash = await bcrypt.hash(newPassword, 10);
    await db.update('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [hash, req.user.id]);
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'change_password', ip: req.ip });
    res.json({ code: 0, message: '密码修改成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

module.exports = router;
