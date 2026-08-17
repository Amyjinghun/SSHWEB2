const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { writeAuditLog } = require('../utils/audit');
const { sendTelegramMessageWithConfig } = require('../services/telegram');
const { cleanupOldData } = require('../services/cleanup');

const router = express.Router();
const settingsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { code: 429, message: 'Too many settings operations, please try again later' }
});

const DEFAULT_SETTINGS = {
  system_name: 'SSHWeb',
  login_title: 'Linux 服务器群控 WebSSH 运维管理系统',
  terminal_theme: 'dark',
  terminal_font_size: '13',
  enable_dangerous_block: 'true',
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
  server_monitor_mode: 'realtime',
  server_check_interval: '10',
  server_monitor_concurrency: '5',
  ip_query_provider: 'ipinfo',
  public_monitor_enabled: 'false',
  public_monitor_key: '',
  cleanup_audit_days: '90',
  cleanup_command_log_days: '90',
  cleanup_alert_days: '90'
};

const ALLOWED_SETTING_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));

router.use(authMiddleware);

// 设置含 tg_bot_token / public_monitor_key 等敏感值，读取与写入同样仅限管理员
router.get('/', roleMiddleware('superadmin', 'admin'), async (req, res) => {
  try {
    const settings = await db.query('SELECT setting_key, setting_value FROM settings');
    const obj = { ...DEFAULT_SETTINGS };
    // 只回传白名单内的键：历史残留的废弃设置（如 jwt_expires_in）不再透出，
    // 否则前端会把它们原样 PUT 回来导致保存报错
    settings.forEach(s => { if (ALLOWED_SETTING_KEYS.has(s.setting_key)) obj[s.setting_key] = s.setting_value; });
    const hasMonitorMode = settings.some(s => s.setting_key === 'server_monitor_mode');
    if (!hasMonitorMode && Number(obj.server_check_interval) >= 120) obj.server_monitor_mode = 'normal';
    res.json({ code: 0, data: obj });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.put('/', settingsLimiter, roleMiddleware('superadmin', 'admin'), async (req, res) => {
  try {
    for (const key of Object.keys(req.body || {})) {
      if (!ALLOWED_SETTING_KEYS.has(key)) {
        return res.json({ code: 400, message: `Invalid setting key: ${key}` });
      }
    }
    for (const [key, value] of Object.entries(req.body || {})) {
      await db.update(
        'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)',
        [key, String(value)]
      );
    }
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'update_settings', detail: req.body });
    res.json({ code: 0, message: 'Settings updated' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.post('/test-telegram', settingsLimiter, roleMiddleware('superadmin', 'admin'), async (req, res) => {
  try {
    const saved = await db.query('SELECT setting_key, setting_value FROM settings WHERE setting_key IN (?, ?, ?)', ['tg_enabled', 'tg_bot_token', 'tg_chat_id']);
    const current = { tg_enabled: DEFAULT_SETTINGS.tg_enabled, tg_bot_token: DEFAULT_SETTINGS.tg_bot_token, tg_chat_id: DEFAULT_SETTINGS.tg_chat_id };
    saved.forEach(s => { current[s.setting_key] = s.setting_value || ''; });

    const botToken = req.body && req.body.tg_bot_token !== undefined ? String(req.body.tg_bot_token || '') : current.tg_bot_token;
    const chatId = req.body && req.body.tg_chat_id !== undefined ? String(req.body.tg_chat_id || '') : current.tg_chat_id;
    const ret = await sendTelegramMessageWithConfig('SSHWeb Telegram notification test succeeded', {
      enabled: true,
      botToken,
      chatId
    });

    res.json({ code: 0, message: ret.skipped ? ret.message : 'Telegram test message sent' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.post('/cleanup', roleMiddleware('superadmin'), async (req, res) => {
  try {
    const { audit_days = 90, command_log_days = 90, alert_days = 90 } = req.body;
    const results = await cleanupOldData({ audit_days, command_log_days, alert_days });
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'data_cleanup', detail: { audit_days, command_log_days, alert_days, results } });
    res.json({ code: 0, message: 'Cleanup complete', data: results });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

module.exports = router;
