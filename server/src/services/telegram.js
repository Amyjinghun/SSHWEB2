const https = require('https');
const db = require('../db');
const config = require('../config');

const DEFAULT_TEMPLATES = {
  alert_template_offline: '🚨 服务器离线告警\n\n服务器：{{server_name}}\nIP：{{host}}\n端口：{{port}}\n失败原因：{{error}}\n备注：{{remark}}\n时间：{{time}}',
  alert_template_cpu: '🚨 CPU占用过高\n\n服务器：{{server_name}}\nIP：{{host}}\n当前CPU：{{cpu_usage}}%\n阈值：{{threshold}}%\n系统：{{os_info}}\n备注：{{remark}}\n时间：{{time}}',
  alert_template_memory: '🚨 内存占用过高\n\n服务器：{{server_name}}\nIP：{{host}}\n当前内存：{{memory_usage}}%\n已用/总量：{{memory_used}}MB / {{memory_total}}MB\n阈值：{{threshold}}%\n系统：{{os_info}}\n备注：{{remark}}\n时间：{{time}}',
  alert_template_disk: '⚠️ 磁盘占用过高\n\n服务器：{{server_name}}\nIP：{{host}}\n根分区磁盘：{{disk_usage}}%\n已用/总量：{{disk_used}}MB / {{disk_total}}MB\n阈值：{{threshold}}%\n系统：{{os_info}}\n备注：{{remark}}\n时间：{{time}}',
  alert_template_expiry: '⏰ 服务器即将到期\n\n服务器：{{server_name}}\nIP：{{host}}\n端口：{{port}}\n用户名：{{username}}\n分组：{{group_name}}\n标签：{{tags}}\n到期时间：{{expires_at}}\n剩余天数：{{days_left}} 天\n备注：{{remark}}\n时间：{{time}}',
  alert_template_expired: '🚨 服务器已到期\n\n服务器：{{server_name}}\nIP：{{host}}\n端口：{{port}}\n用户名：{{username}}\n分组：{{group_name}}\n标签：{{tags}}\n到期时间：{{expires_at}}\n已过期：{{expired_days}} 天\n备注：{{remark}}\n时间：{{time}}'
};

async function getSettings() {
  try {
    const rows = await db.query(
      'SELECT setting_key, setting_value FROM settings WHERE setting_key LIKE ? OR setting_key LIKE ?',
      ['tg_%', 'alert_%']
    );
    const obj = {};
    rows.forEach(r => { obj[r.setting_key] = r.setting_value; });
    return obj;
  } catch {
    return {};
  }
}

async function getSettingValue(key, fallback = '') {
  try {
    const row = await db.queryOne('SELECT setting_value FROM settings WHERE setting_key=?', [key]);
    if (!row || row.setting_value === null || row.setting_value === undefined) return fallback;
    return row.setting_value;
  } catch {
    return fallback;
  }
}

async function getTelegramConfig() {
  const settings = await getSettings();
  const enabled = String(settings.tg_enabled ?? config.telegram.enabled) === 'true';
  const botToken = settings.tg_bot_token || config.telegram.botToken || '';
  const chatId = settings.tg_chat_id || config.telegram.chatId || '';
  return { enabled, botToken, chatId };
}

function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 12000
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(raw);
        reject(new Error(`Telegram HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
      });
    });
    req.on('timeout', () => req.destroy(new Error('Telegram 请求超时')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendTelegramMessageWithConfig(text, tg) {
  if (!tg.enabled) return { skipped: true, message: 'Telegram 未启用' };
  if (!tg.botToken || !tg.chatId) return { skipped: true, message: 'TG_BOT_TOKEN 或 TG_CHAT_ID 未配置' };
  const url = `https://api.telegram.org/bot${tg.botToken}/sendMessage`;
  const payload = {
    chat_id: tg.chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  const result = await postJson(url, payload);
  return { skipped: false, result };
}

async function sendTelegramMessage(text) {
  const tg = await getTelegramConfig();
  return sendTelegramMessageWithConfig(text, tg);
}

async function getAlertNumber(key, fallback) {
  try {
    const row = await db.queryOne('SELECT setting_value FROM settings WHERE setting_key=?', [key]);
    const value = row ? Number(row.setting_value) : NaN;
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

async function getAlertBoolean(key, fallback = true) {
  try {
    const row = await db.queryOne('SELECT setting_value FROM settings WHERE setting_key=?', [key]);
    if (!row) return fallback;
    return String(row.setting_value).toLowerCase() === 'true';
  } catch {
    return fallback;
  }
}

async function recentAlertExists(serverId, title, repeatHours) {
  const row = await db.queryOne(
    'SELECT id FROM alert_logs WHERE server_id <=> ? AND title=? AND created_at > DATE_SUB(NOW(), INTERVAL ? HOUR) LIMIT 1',
    [serverId || null, title, repeatHours]
  );
  return !!row;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeTemplateValue(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '-';
  return String(value);
}

function renderTemplate(template, variables = {}) {
  const data = {
    time: new Date().toLocaleString('zh-CN', { hour12: false }),
    ...variables
  };
  return String(template || '').replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => normalizeTemplateValue(data[key]));
}

async function buildAlertText({ title, content, templateKey, variables }) {
  if (templateKey) {
    const saved = await getSettingValue(templateKey, '');
    const template = saved && String(saved).trim() ? saved : DEFAULT_TEMPLATES[templateKey];
    if (template) return escapeHtml(renderTemplate(template, variables));
  }
  return `🚨 <b>${escapeHtml(title)}</b>\n\n${escapeHtml(content)}\n\n时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`;
}

async function createAndNotifyAlert({ serverId = null, level = 'warning', title, content, templateKey = '', variables = {} }) {
  const repeatHours = await getAlertNumber('alert_repeat_hours', config.alerts.repeatHours);
  if (await recentAlertExists(serverId, title, repeatHours)) {
    return { skipped: true, message: '重复告警已抑制' };
  }
  let notifyResult = '';
  const text = await buildAlertText({ title, content, templateKey, variables });
  try {
    const ret = await sendTelegramMessage(text);
    notifyResult = ret.skipped ? ret.message : 'Telegram 发送成功';
  } catch (err) {
    notifyResult = `Telegram 发送失败：${err.message}`;
  }
  await db.insert(
    'INSERT INTO alert_logs (server_id, level, title, content, status, notify_result) VALUES (?,?,?,?,?,?)',
    [serverId, level, title, content, 'active', notifyResult]
  );
  return { skipped: false, notifyResult };
}

module.exports = {
  sendTelegramMessage,
  sendTelegramMessageWithConfig,
  createAndNotifyAlert,
  getAlertNumber,
  getAlertBoolean,
  DEFAULT_TEMPLATES,
  renderTemplate
};
