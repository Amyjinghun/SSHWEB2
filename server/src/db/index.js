const mysql = require('mysql2/promise');
const config = require('../config');

const pool = mysql.createPool(config.mysql);

// 生产环境下，mysql2 错误的 message 含表名/字段名/约束名等敏感信息，
// 在此统一脱敏并落日志，避免经由各路由的 catch 直接返回给前端。
function wrapDbError(err) {
  if (!err) return err;
  const isDbError = err.code || err.errno || err.sqlState;
  if (config.isProduction && isDbError) {
    console.error('[DB ERROR]', err.code || '', '-', err.message, err.sql ? `\nSQL: ${err.sql}` : '');
    return new Error('数据库操作失败，请稍后重试或联系管理员');
  }
  return err;
}

async function ignoreDuplicateColumn(sql) {
  try {
    await pool.execute(sql);
  } catch (err) {
    // ER_DUP_FIELDNAME: column already exists. ER_NO_SUCH_TABLE may happen before initial schema import.
    if (err.code !== 'ER_DUP_FIELDNAME' && err.code !== 'ER_NO_SUCH_TABLE') throw err;
  }
}

async function ensureSchema() {
  await ignoreDuplicateColumn('ALTER TABLE users ADD COLUMN token_version INT NOT NULL DEFAULT 0 AFTER status');
  await ignoreDuplicateColumn("ALTER TABLE scheduled_tasks ADD COLUMN target_type ENUM('server','server_list','group') NOT NULL DEFAULT 'server' AFTER name");
  await ignoreDuplicateColumn('ALTER TABLE scheduled_tasks ADD COLUMN server_ids JSON NULL AFTER server_id');
  await ignoreDuplicateColumn('ALTER TABLE scheduled_tasks ADD COLUMN group_id BIGINT NULL AFTER server_ids');
  // 主页实时监控面板所需的缓存列（避免每 5s 关联 server_metrics 取最新行）
  await ignoreDuplicateColumn('ALTER TABLE servers ADD COLUMN uptime VARCHAR(100) NULL AFTER disk_usage');
  await ignoreDuplicateColumn('ALTER TABLE servers ADD COLUMN load_avg VARCHAR(100) NULL AFTER uptime');
  await ignoreDuplicateColumn('ALTER TABLE servers ADD COLUMN mem_total_mb BIGINT NULL AFTER load_avg');
  await ignoreDuplicateColumn('ALTER TABLE servers ADD COLUMN mem_used_mb BIGINT NULL AFTER mem_total_mb');
  await ignoreDuplicateColumn('ALTER TABLE servers ADD COLUMN disk_total_mb BIGINT NULL AFTER mem_used_mb');
  await ignoreDuplicateColumn('ALTER TABLE servers ADD COLUMN disk_used_mb BIGINT NULL AFTER disk_total_mb');
  await ignoreDuplicateColumn('ALTER TABLE servers ADD COLUMN network_rx_bytes BIGINT NULL AFTER disk_used_mb');
  await ignoreDuplicateColumn('ALTER TABLE servers ADD COLUMN network_tx_bytes BIGINT NULL AFTER network_rx_bytes');
  // 监控卡片扩展：动态网络指标 + 静态系统信息（低频采集，每 6 小时一次）
  await ignoreDuplicateColumn('ALTER TABLE servers ADD COLUMN tcp_connections INT NULL AFTER network_tx_bytes');
  await ignoreDuplicateColumn('ALTER TABLE servers ADD COLUMN udp_connections INT NULL AFTER tcp_connections');
  await ignoreDuplicateColumn('ALTER TABLE servers ADD COLUMN system_info JSON NULL AFTER udp_connections');
  await ignoreDuplicateColumn('ALTER TABLE servers ADD COLUMN static_info_updated_at DATETIME NULL AFTER system_info');
  await ignoreDuplicateColumn('ALTER TABLE server_metrics ADD COLUMN network_rx_bytes BIGINT NULL AFTER disk_usage');
  await ignoreDuplicateColumn('ALTER TABLE server_metrics ADD COLUMN network_tx_bytes BIGINT NULL AFTER network_rx_bytes');
  // 规则引擎 agent：alert_rules 绑定命令模板动作，alert_logs 记录动作结果与 LLM 诊断
  await ignoreDuplicateColumn('ALTER TABLE alert_rules ADD COLUMN action_ids JSON NULL COMMENT "命令模板 ID 数组，命中时在目标服务器执行" AFTER notify_channels');
  await ignoreDuplicateColumn('ALTER TABLE alert_logs ADD COLUMN action_results TEXT NULL COMMENT "动作执行结果 JSON" AFTER notify_result');
  await ignoreDuplicateColumn('ALTER TABLE alert_logs ADD COLUMN diagnosis MEDIUMTEXT NULL COMMENT "LLM 诊断结果（可选）" AFTER action_results');
}

async function query(sql, params) {
  try {
    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (err) {
    throw wrapDbError(err);
  }
}

async function queryOne(sql, params) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function insert(sql, params) {
  try {
    const [result] = await pool.execute(sql, params);
    return result.insertId;
  } catch (err) {
    throw wrapDbError(err);
  }
}

async function update(sql, params) {
  try {
    const [result] = await pool.execute(sql, params);
    return result.affectedRows;
  } catch (err) {
    throw wrapDbError(err);
  }
}

async function remove(sql, params) {
  try {
    const [result] = await pool.execute(sql, params);
    return result.affectedRows;
  } catch (err) {
    throw wrapDbError(err);
  }
}

module.exports = { pool, query, queryOne, insert, update, remove, ensureSchema };
