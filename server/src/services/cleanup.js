const db = require('../db');

// 数据清理：手动清理接口与每日定时任务共用，返回各表删除条数
async function cleanupOldData({ audit_days = 90, command_log_days = 90, alert_days = 90 } = {}) {
  const results = {};
  results.audit_logs = await db.remove('DELETE FROM audit_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [audit_days]);
  results.command_logs = await db.remove('DELETE FROM command_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [command_log_days]);
  results.alert_logs = await db.remove('DELETE FROM alert_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [alert_days]);
  return results;
}

module.exports = { cleanupOldData };
