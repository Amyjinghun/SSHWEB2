const https = require('https');
const db = require('../db');
const config = require('../config');

function progressBar(percent) {
  const filled = Math.round(percent / 5);
  return '▓'.repeat(filled) + '░'.repeat(20 - filled);
}

const DEFAULT_TEMPLATES = {
  alert_template_offline: `🚨 <b>服务器离线告警</b>

━━━━━━━━━━━━━━━━━━
🖥 <b>服务器</b>：{{server_name}}
🌐 <b>IP地址</b>：<code>{{host}}:{{port}}</code>
❌ <b>失败原因</b>：{{error}}
📝 <b>备注</b>：{{remark}}
━━━━━━━━━━━━━━━━━━
🕐 {{time}}`,

  alert_template_cpu: `🔴 <b>CPU 占用过高告警</b>

━━━━━━━━━━━━━━━━━━
🖥 <b>服务器</b>：{{server_name}}
🌐 <b>IP地址</b>：<code>{{host}}</code>
🖥 <b>系统</b>：{{os_info}}
━━━━━━━━━━━━━━━━━━
🔥 <b>CPU 使用率</b>：<code>{{cpu_usage}}%</code>
<code>{{bar:cpu_usage}}</code>
⚠️ <b>告警阈值</b>：{{threshold}}%
📝 <b>备注</b>：{{remark}}
━━━━━━━━━━━━━━━━━━
🕐 {{time}}`,

  alert_template_memory: `🟠 <b>内存占用过高告警</b>

━━━━━━━━━━━━━━━━━━
🖥 <b>服务器</b>：{{server_name}}
🌐 <b>IP地址</b>：<code>{{host}}</code>
🖥 <b>系统</b>：{{os_info}}
━━━━━━━━━━━━━━━━━━
💾 <b>内存使用率</b>：<code>{{memory_usage}}%</code>  ({{memory_used}} MB / {{memory_total}} MB)
<code>{{bar:memory_usage}}</code>
⚠️ <b>告警阈值</b>：{{threshold}}%
📝 <b>备注</b>：{{remark}}
━━━━━━━━━━━━━━━━━━
🕐 {{time}}`,

  alert_template_disk: `🟡 <b>磁盘占用过高告警</b>

━━━━━━━━━━━━━━━━━━
🖥 <b>服务器</b>：{{server_name}}
🌐 <b>IP地址</b>：<code>{{host}}</code>
🖥 <b>系统</b>：{{os_info}}
━━━━━━━━━━━━━━━━━━
💿 <b>磁盘使用率</b>：<code>{{disk_usage}}%</code>  ({{disk_used}} MB / {{disk_total}} MB)
<code>{{bar:disk_usage}}</code>
⚠️ <b>告警阈值</b>：{{threshold}}%
📝 <b>备注</b>：{{remark}}
━━━━━━━━━━━━━━━━━━
🕐 {{time}}`,

  alert_template_expiry: `⏰ <b>服务器即将到期提醒</b>

┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
🖥 <b>服务器</b>：{{server_name}}
🌐 <b>IP地址</b>：<code>{{host}}:{{port}}</code>
👤 <b>用户名</b>：{{username}}
📂 <b>分组</b>：{{group_name}}
🏷 <b>标签</b>：{{tags}}
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─

📅 <b>到期时间</b>：<code>{{expires_at}}</code>
⏳ <b>剩余天数</b>：🔥 <b>{{days_left}} 天</b>
📝 <b>备注</b>：{{remark}}

💡 <i>请及时续费，避免服务器业务中断</i>
━━━━━━━━━━━━━━━━━━
🕐 {{time}}`,

  alert_template_expired: `🚨 <b>服务器已到期通知</b>

┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
🖥 <b>服务器</b>：{{server_name}}
🌐 <b>IP地址</b>：<code>{{host}}:{{port}}</code>
👤 <b>用户名</b>：{{username}}
📂 <b>分组</b>：{{group_name}}
🏷 <b>标签</b>：{{tags}}
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─

📅 <b>到期时间</b>：<code>{{expires_at}}</code>
⏳ <b>已过期</b>：❌ <b>{{expired_days}} 天</b>
📝 <b>备注</b>：{{remark}}

⚠️ <i>该服务器已过期，相关业务可能已受影响，请尽快处理！</i>
━━━━━━━━━━━━━━━━━━
🕐 {{time}}`
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
  if (Array.isArray(value)) return value.length ? escapeHtml(value.join(', ')) : '-';
  return escapeHtml(String(value));
}

function renderTemplate(template, variables = {}) {
  const data = {
    time: new Date().toLocaleString('zh-CN', { hour12: false }),
    ...variables
  };
  let text = String(template || '').replace(/{{\s*bar:([a-zA-Z0-9_]+)\s*}}/g, (_, key) => {
    const val = parseFloat(data[key]);
    return Number.isFinite(val) ? progressBar(val) : progressBar(0);
  });
  text = text.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => normalizeTemplateValue(data[key]));
  return text;
}

async function buildAlertText({ title, content, templateKey, variables }) {
  if (templateKey) {
    const saved = await getSettingValue(templateKey, '');
    const template = saved && String(saved).trim() ? saved : DEFAULT_TEMPLATES[templateKey];
    if (template) return renderTemplate(template, variables);
  }
  return `🚨 <b>${escapeHtml(title)}</b>\n\n${escapeHtml(content)}\n\n时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`;
}

async function createAndNotifyAlert({ serverId = null, level = 'warning', title, content, templateKey = '', variables = {}, ruleId = null }) {
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
  const alertLogId = await db.insert(
    'INSERT INTO alert_logs (server_id, rule_id, level, title, content, status, notify_result) VALUES (?,?,?,?,?,?,?)',
    [serverId, ruleId, level, title, content, 'active', notifyResult]
  );
  return { skipped: false, notifyResult, alertLogId };
}

module.exports = {
  sendTelegramMessage,
  sendTelegramMessageWithConfig,
  createAndNotifyAlert,
  getAlertNumber,
  getAlertBoolean,
  getSettingValue,
  DEFAULT_TEMPLATES,
  renderTemplate
};
