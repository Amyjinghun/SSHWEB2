const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

// SSH 连接诊断日志：每个阶段都带时间戳写入文件，方便排查卡在哪一步。
const LOG_FILE = path.join(__dirname, '..', '..', 'logs', 'ssh-connect.log');

// 诊断会话存储：测试连接接口用 diagALS.run(steps, ...) 包裹整段逻辑，
// 期间所有 logSSH 调用会同时把步骤收集到 steps 数组，随接口返回给前端展示。
const diagALS = new AsyncLocalStorage();

function append(line) {
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // 简单轮转：超过 10MB 清空重写，避免长期运行无限增长
    try {
      const stat = fs.statSync(LOG_FILE);
      if (stat.size > 10 * 1024 * 1024) fs.writeFileSync(LOG_FILE, '');
    } catch {}
    fs.appendFileSync(LOG_FILE, line);
  } catch (e) {
    // 日志写入失败不影响主流程
  }
}

// tag: 标识（如 服务器ID@host:port），step: 阶段名，detail: 详情
function logSSH(tag, step, detail = '') {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${tag}] ${step}${detail ? ' | ' + detail : ''}`;
  append(line + '\n');
  console.log(`[ssh-diag] ${line}`);
  const steps = diagALS.getStore();
  if (steps) steps.push({ time: ts, tag: String(tag), step, detail: detail || '' });
}

module.exports = { logSSH, diagALS };
