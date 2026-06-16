const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

function allowsQueryToken(req) {
  if (!config.security.allowQueryToken) return false;
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  return [
    '/api/files/download',
    '/api/servers/export',
    '/api/servers/import/template'
  ].includes(path);
}

function getToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  // 仅下载/导出这类 window.open 场景允许短暂兼容 query token，避免全局 URL token 泄漏面过大。
  if (allowsQueryToken(req)) return req.query?.token || req.body?.token || '';
  return req.body?.token || '';
}

async function authMiddleware(req, res, next) {
  const token = getToken(req);
  if (!token) {
    return res.status(401).json({ code: 401, message: '未提供认证令牌' });
  }
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const user = await db.queryOne('SELECT id, username, role, status, token_version FROM users WHERE id = ?', [decoded.id]);
    if (!user || Number(user.status) !== 1 || Number(user.token_version || 0) !== Number(decoded.tokenVersion)) {
      return res.status(401).json({ code: 401, message: '登录状态已失效，请重新登录' });
    }
    req.user = { id: user.id, username: user.username, role: user.role, tokenVersion: user.token_version || 0 };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ code: 401, message: '令牌已过期，请重新登录' });
    }
    return res.status(401).json({ code: 401, message: '无效的认证令牌' });
  }
}

function roleMiddleware(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ code: 401, message: '未认证' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ code: 403, message: '权限不足' });
    }
    next();
  };
}

module.exports = { authMiddleware, roleMiddleware };
