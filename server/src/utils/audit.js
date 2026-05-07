const db = require('../db');

async function writeAuditLog({ userId, username, action, targetType, targetId, serverId, ip, userAgent, detail, status = 'success', errorMessage }) {
  try {
    await db.insert(
      `INSERT INTO audit_logs (user_id, username, action, target_type, target_id, server_id, ip, user_agent, detail_json, status, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId || null, username || null, action, targetType || null, targetId || null,
        serverId || null, ip || null, userAgent || null,
        detail ? JSON.stringify(detail) : null, status, errorMessage || null
      ]
    );
  } catch (e) {
    console.error('审计日志写入失败:', e.message);
  }
}

module.exports = { writeAuditLog };
