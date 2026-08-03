// 规则引擎 agent：在每轮采集后评估 alert_rules，命中时发通知 + 执行白名单动作 + 可选 LLM 诊断。
// 与 scheduler 里硬编码的 4 条规则并存，由 settings.alert_rule_engine_enabled 总开关控制（默认关）。
// 动作只能引用 command_templates.id（白名单），执行前再过 isDangerousCommand 双保险，全程写 audit_logs。

const https = require('https');
const db = require('../db');
const config = require('../config');
const { createSSHConnection, execCommand, isDangerousCommand } = require('../ssh/connection');
const { createAndNotifyAlert, getAlertBoolean, getSettingValue } = require('./telegram');
const { writeAuditLog } = require('../utils/audit');

const MAX_OUT_LEN = 500; // 动作 stdout/stderr 截断长度，避免 action_results 过大

// --- 条件评估（单条件：metric op threshold）---

const OPERATORS = {
  '>=': (a, t) => a >= t,
  '>':  (a, t) => a > t,
  '<=': (a, t) => a <= t,
  '<':  (a, t) => a < t,
  '==': (a, t) => a === t,
  '!=': (a, t) => a !== t
};

function pickMetricValue(metrics, server, metric) {
  // 优先用采集到的实时指标，回退到 servers 表缓存的快照
  switch (metric) {
    case 'cpu_usage':    return metrics?.cpu ?? server?.cpu_usage;
    case 'memory_usage': return metrics?.memUsage ?? server?.memory_usage;
    case 'disk_usage':   return metrics?.diskUsage ?? server?.disk_usage;
    case 'status':       return server?.status || 'unknown';
    default:             return null;
  }
}

function ruleMatches(rule, server, metrics) {
  let cond = rule.condition_json;
  if (typeof cond === 'string') { try { cond = JSON.parse(cond); } catch { return false; } }
  if (!cond || !cond.metric || !OPERATORS[cond.operator]) return false;

  const actual = pickMetricValue(metrics, server, cond.metric);
  if (actual === null || actual === undefined) return false;

  const op = OPERATORS[cond.operator];
  // status（字符串）只在 == / != 下比较；数值指标用所有算子
  if (cond.metric === 'status') {
    return cond.operator === '==' ? String(actual) === String(cond.threshold)
         : cond.operator === '!=' ? String(actual) !== String(cond.threshold)
         : false;
  }
  const a = Number(actual);
  const t = Number(cond.threshold);
  if (!Number.isFinite(a) || !Number.isFinite(t)) return false;
  return op(a, t);
}

// --- 动作执行（白名单：只能跑 command_templates 里的命令）---

function parseActionIds(rule) {
  let ids = rule.action_ids;
  if (typeof ids === 'string') { try { ids = JSON.parse(ids); } catch { return []; } }
  return Array.isArray(ids) ? ids.map(Number).filter(Boolean) : [];
}

function truncate(s, len = MAX_OUT_LEN) {
  const str = String(s ?? '');
  return str.length > len ? str.slice(0, len) + '…' : str;
}

async function executeActions(actionIds, server) {
  const results = [];
  for (const id of actionIds) {
    const start = Date.now();
    let tpl;
    try {
      tpl = await db.queryOne('SELECT * FROM command_templates WHERE id = ?', [id]);
    } catch (err) {
      results.push({ template_id: id, status: 'failed', error: `查询模板失败: ${err.message}`, duration_ms: Date.now() - start });
      continue;
    }
    if (!tpl) {
      results.push({ template_id: id, status: 'not_found', error: '命令模板不存在' });
      continue;
    }
    // 双保险：模板被标红 或 命中危险模式，一律拦截
    if (tpl.is_dangerous || isDangerousCommand(tpl.command)) {
      results.push({ template_id: id, template_name: tpl.name, command: tpl.command, status: 'blocked', error: '危险命令已被安全策略拦截' });
      continue;
    }
    let conn;
    try {
      conn = await createSSHConnection(server);
      const r = await execCommand(conn, tpl.command);
      results.push({
        template_id: id, template_name: tpl.name, command: tpl.command,
        status: r.exitCode === 0 ? 'success' : 'failed',
        exit_code: r.exitCode, stdout: truncate(r.stdout), stderr: truncate(r.stderr),
        duration_ms: Date.now() - start
      });
    } catch (err) {
      results.push({ template_id: id, template_name: tpl.name, command: tpl.command, status: 'failed', error: err.message, duration_ms: Date.now() - start });
    } finally {
      try { if (conn) conn.end(); } catch {}
    }
  }
  return results;
}

// --- LLM 诊断顾问（可选，异步不阻塞主流程）---

const DIAG_SCRIPT = `echo '=== TOP CPU 进程 ==='
ps -eo pid,pcpu,pmem,comm --sort=-pcpu 2>/dev/null | head -6 || ps aux | head -6
echo '=== TOP 内存进程 ==='
ps -eo pid,pcpu,pmem,comm --sort=-pmem 2>/dev/null | head -6 || ps aux | sort -k4 -rn | head -6
echo '=== OOM/内存相关 ==='
dmesg -T 2>/dev/null | grep -iE 'oom|killed process|out of memory' | tail -5 || echo '无权限或无 OOM 记录'
echo '=== 系统负载 ==='
uptime 2>/dev/null || cat /proc/loadavg`;

function buildDiagnosisPrompt(server, metrics, rule, diagContext) {
  return [
    '你是运维诊断助手。一台服务器触发了告警，基于以下信息给出简短诊断和处置建议（中文，300字内）。',
    '',
    `服务器：${server.name} (${server.host})`,
    `系统：${server.os_info || '-'}`,
    `当前指标：CPU ${metrics?.cpu ?? '-'}% / 内存 ${metrics?.memUsage ?? '-'}% / 磁盘 ${metrics?.diskUsage ?? '-'}% / 负载 ${metrics?.loadAvg || server.load_avg || '-'}`,
    `触发的规则：${rule.name}（${rule.type}）`,
    '',
    '以下是服务器实时的进程和系统信息：',
    '',
    diagContext,
    '',
    '请给出：',
    '1. 可能的原因（2-3 条）',
    '2. 建议的处置步骤（2-3 条）'
  ].join('\n');
}

async function callClaude(prompt) {
  const baseUrl = await getSettingValue('llm_base_url', config.llm.baseUrl);
  const apiKey = await getSettingValue('llm_api_key', config.llm.apiKey);
  const model = await getSettingValue('llm_model', config.llm.model);
  if (!apiKey) throw new Error('未配置 LLM API Key');

  const body = JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] });
  const u = new URL(`${baseUrl}/v1/messages`);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body)
      },
      timeout: 30000
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`LLM HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
        }
        try {
          const json = JSON.parse(raw);
          const text = json.content?.map?.(b => b.text).filter(Boolean).join('\n') || '';
          resolve(text || '（LLM 未返回内容）');
        } catch (err) { reject(new Error(`LLM 响应解析失败: ${err.message}`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('LLM 请求超时')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function runDiagnosis(rule, server, metrics, alertLogId) {
  // 拉诊断上下文（top 进程 + OOM 记录 + 负载），失败不阻断诊断
  let diagContext = '（无法获取诊断上下文）';
  let conn;
  try {
    conn = await createSSHConnection(server);
    const { out } = await execCommand(conn, DIAG_SCRIPT, 15000);
    diagContext = truncate(out, 2000);
  } catch (err) {
    diagContext = `（获取诊断上下文失败：${err.message}）`;
  } finally {
    try { if (conn) conn.end(); } catch {}
  }

  try {
    const text = await callClaude(buildDiagnosisPrompt(server, metrics, rule, diagContext));
    await db.update('UPDATE alert_logs SET diagnosis = ? WHERE id = ?', [text, alertLogId]);
  } catch (err) {
    console.error(`[规则引擎] LLM 诊断失败 [规则${rule.id}/告警${alertLogId}]:`, err.message);
    await db.update('UPDATE alert_logs SET diagnosis = ? WHERE id = ?', [`诊断失败：${err.message}`, alertLogId]);
  }
}

// --- 主入口 ---

async function evaluateServer(server, metrics) {
  try {
    const enabled = await getAlertBoolean('alert_rule_engine_enabled', false);
    if (!enabled) return { evaluated: 0, triggered: 0 };

    const rules = await db.query('SELECT id, name, type, condition_json, level, action_ids FROM alert_rules WHERE enabled = 1');
    if (!rules.length) return { evaluated: 0, triggered: 0 };

    let triggered = 0;
    for (const rule of rules) {
      if (!ruleMatches(rule, server, metrics)) continue;
      triggered++;
      await handleTriggered(rule, server, metrics);
    }
    return { evaluated: rules.length, triggered };
  } catch (err) {
    console.error(`[规则引擎] 评估失败 [服务器${server.id}]:`, err.message);
    return { evaluated: 0, triggered: 0, error: err.message };
  }
}

async function handleTriggered(rule, server, metrics) {
  let cond = rule.condition_json;
  if (typeof cond === 'string') { try { cond = JSON.parse(cond); } catch { cond = {}; } }

  const title = `[规则] ${rule.name}：${server.name || server.host}`;
  const content = `服务器：${server.name || server.host}\nIP：${server.host}\n规则：${rule.name}（${rule.type}）\n条件：${cond.metric || '?'} ${cond.operator || '?'} ${cond.threshold ?? '?'}\n当前值：${pickMetricValue(metrics, server, cond.metric) ?? '-'}`;

  const alert = await createAndNotifyAlert({
    serverId: server.id,
    ruleId: rule.id,
    level: rule.level || 'warning',
    title,
    content
  });
  if (alert.skipped) return; // 重复告警已被 recentAlertExists 抑制

  const actionIds = parseActionIds(rule);
  let actionStatus = 'success';
  if (actionIds.length) {
    const actionResults = await executeActions(actionIds, server);
    await db.update('UPDATE alert_logs SET action_results = ? WHERE id = ?', [JSON.stringify(actionResults), alert.alertLogId]);
    actionStatus = actionResults.every(r => r.status === 'success') ? 'success' : 'failed';
  }

  await writeAuditLog({
    username: 'alert-agent',
    action: 'rule_triggered',
    targetType: 'alert',
    targetId: alert.alertLogId,
    serverId: server.id,
    detail: { rule_id: rule.id, rule_name: rule.name, action_count: actionIds.length },
    status: actionStatus
  });

  // LLM 诊断异步执行，不阻塞采集循环
  if (await getAlertBoolean('llm_enabled', config.llm.enabled)) {
    runDiagnosis(rule, server, metrics, alert.alertLogId).catch(() => {});
  }
}

module.exports = { evaluateServer, ruleMatches };
