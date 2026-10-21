const db = require('../db');
const { cleanupRecordings } = require('./term-record');

// 数据清理：手动清理接口与每日定时任务共用，返回各表删除条数
async function cleanupOldData({ audit_days = 90, command_log_days = 90, alert_days = 90, termlog_days = 30 } = {}) {
  const results = {};
  results.audit_logs = await db.remove('DELETE FROM audit_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [audit_days]);
  results.command_logs = await db.remove('DELETE FROM command_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [command_log_days]);
  results.alert_logs = await db.remove('DELETE FROM alert_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [alert_days]);
  try {
    results.term_recordings = await cleanupRecordings(termlog_days);
  } catch {
    results.term_recordings = 0;
  }
  return results;
}

module.exports = { cleanupOldData };
