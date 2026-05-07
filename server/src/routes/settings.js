const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { writeAuditLog } = require('../utils/audit');
const { sendTelegramMessageWithConfig } = require('../services/telegram');

const router = express.Router();
const settingsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { code: 429, message: '设置操作过于频繁，请稍后再试' }
});
const DEFAULT_SETTINGS = {
  system_name: 'SSHWeb 服务器群控面板',
  login_title: 'Linux 服务器群控管理系统',
  default_page_size: '20',
  terminal_theme: 'dark',
  terminal_font_size: '14',
  ssh_connect_timeout: '10000',
  command_exec_timeout: '60000',
  login_fail_limit: '5',
  login_lock_time: '300',
  jwt_expires_in: '7d',
  enable_dangerous_block: 'true',
  dangerous_action: 'confirm',
  record_terminal_log: 'false',
  allow_batch_dangerous: 'false',
  tg_enabled: 'false',
  tg_bot_token: '',
  tg_chat_id: '',
  alert_enable_offline: 'true',
  alert_enable_cpu: 'true',
  alert_enable_memory: 'true',
  alert_enable_disk: 'false',
  alert_cpu_threshold: '90',
  alert_memory_threshold: '90',
  alert_disk_threshold: '90',
  alert_enable_expiry: 'true',
  alert_server_expiry_days: '2',
  alert_repeat_hours: '12',
  alert_template_offline: '',
  alert_template_cpu: '',
  alert_template_memory: '',
  alert_template_disk: '',
  alert_template_expiry: '',
  alert_template_expired: '',
  server_check_interval: '180',
  server_monitor_concurrency: '5'
};

const ALLOWED_SETTING_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));

router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const settings = await db.query('SELECT setting_key, setting_value FROM settings');
    const obj = { ...DEFAULT_SETTINGS };
    settings.forEach(s => { obj[s.setting_key] = s.setting_value; });
    res.json({ code: 0, data: obj });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

router.put('/', settingsLimiter, roleMiddleware('superadmin', 'admin'), async (req, res) => {
  try {
    for (const key of Object.keys(req.body || {})) {
      if (!ALLOWED_SETTING_KEYS.has(key)) {
        return res.json({ code: 400, message: `非法设置项: ${key}` });
      }
    }
    for (const [key, value] of Object.entries(req.body)) {
      await db.update('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)', [key, String(value)]);
    }
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'update_settings', detail: req.body });
    res.json({ code: 0, message: '设置已更新' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

router.post('/test-telegram', settingsLimiter, roleMiddleware('superadmin', 'admin'), async (req, res) => {
  try {
    const saved = await db.query('SELECT setting_key, setting_value FROM settings WHERE setting_key IN (?, ?, ?)', ['tg_enabled', 'tg_bot_token', 'tg_chat_id']);
    const current = { tg_enabled: DEFAULT_SETTINGS.tg_enabled, tg_bot_token: DEFAULT_SETTINGS.tg_bot_token, tg_chat_id: DEFAULT_SETTINGS.tg_chat_id };
    saved.forEach(s => { current[s.setting_key] = s.setting_value || ''; });

    const botToken = req.body && req.body.tg_bot_token !== undefined ? String(req.body.tg_bot_token || '') : current.tg_bot_token;
    const chatId = req.body && req.body.tg_chat_id !== undefined ? String(req.body.tg_chat_id || '') : current.tg_chat_id;
    const ret = await sendTelegramMessageWithConfig('✅ SSHWeb Telegram 通知测试成功', {
      enabled: true,
      botToken,
      chatId
    });

    res.json({ code: 0, message: ret.skipped ? ret.message : 'Telegram 测试消息已发送' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

router.post('/cleanup', roleMiddleware('superadmin'), async (req, res) => {
  try {
    const { audit_days = 90, command_log_days = 90, alert_days = 90 } = req.body;
    const results = {};
    const r1 = await db.remove('DELETE FROM audit_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [audit_days]);
    results.audit_logs = r1;
    const r2 = await db.remove('DELETE FROM command_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [command_log_days]);
    results.command_logs = r2;
    const r3 = await db.remove('DELETE FROM alert_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [alert_days]);
    results.alert_logs = r3;
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'data_cleanup', detail: { audit_days, command_log_days, alert_days, results } });
    res.json({ code: 0, message: '清理完成', data: results });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

module.exports = router;
