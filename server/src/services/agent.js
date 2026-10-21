// 监控 Agent 服务：token 管理、上报处理、新鲜度判定、实时事件分发。
// agent.js 不 require scheduler（scheduler 反向依赖本模块），告警评估走 metric-alerts。
const crypto = require('crypto');
const { EventEmitter } = require('events');
const db = require('../db');
const { checkMetricAlerts } = require('./metric-alerts');
const { getSettingValue } = require('./telegram');
const ruleEngine = require('./rule-engine');

// 实时指标事件：agent 每次上报 emit('metrics:<serverId>', payload)，/metrics 命名空间订阅
const agentEvents = new EventEmitter();
agentEvents.setMaxListeners(100);

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function generateAgentToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 常数时间比较，避免逐字节短路泄露哈希前缀
function tokenHashEquals(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

async function getAgentInterval() {
  const v = parseInt(await getSettingValue('agent_interval', '5'), 10);
  return Number.isFinite(v) ? Math.min(Math.max(v, 2), 60) : 5;
}

// 新鲜窗口 = max(interval × 3, 45s)：错过 1-2 个上报周期仍视为在线，避免抖动
async function isAgentFreshAsync(server) {
  if (!server || !server.agent_last_report_at) return false;
  const interval = await getAgentInterval();
  const staleMs = Math.max(interval * 3, 45) * 1000;
  const last = new Date(server.agent_last_report_at).getTime();
  return Number.isFinite(last) && (Date.now() - last) < staleMs;
}

// 同步版：调度器批量检查时用缓存间隔（每 60s 刷新一次，避免每台服务器查一次 settings）
let cachedInterval = { value: 5, ts: 0 };
function isAgentFresh(server) {
  if (!server || !server.agent_last_report_at) return false;
  if (Date.now() - cachedInterval.ts > 60000) {
    getAgentInterval().then(v => { cachedInterval = { value: v, ts: Date.now() }; }).catch(() => {});
  }
  const staleMs = Math.max(cachedInterval.value * 3, 45) * 1000;
  const last = new Date(server.agent_last_report_at).getTime();
  return Number.isFinite(last) && (Date.now() - last) < staleMs;
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampPercent(v) {
  return Math.min(Math.max(num(v, 0), 0), 100);
}

// 上报 body（form-encoded k=v）→ 指标对象，键名与 COLLECT_SCRIPT 输出一致
function parseReportBody(body) {
  const cpu = clampPercent(body.CPU_USAGE);
  const memTotal = num(body.MEM_TOTAL_MB);
  const memUsed = num(body.MEM_USED_MB);
  const diskTotal = num(body.DISK_TOTAL_MB);
  const diskUsed = num(body.DISK_USED_MB);
  return {
    cpu,
    memTotal,
    memUsed,
    memUsage: memTotal > 0 ? clampPercent(body.MEM_USAGE) : 0,
    diskTotal,
    diskUsed,
    diskUsage: diskTotal > 0 ? clampPercent(body.DISK_USAGE) : 0,
    netRxBytes: Math.max(num(body.NET_RX_BYTES), 0),
    netTxBytes: Math.max(num(body.NET_TX_BYTES), 0),
    netRxRate: Math.max(parseInt(body.NET_RX_RATE, 10) || 0, 0),
    netTxRate: Math.max(parseInt(body.NET_TX_RATE, 10) || 0, 0),
    loadAvg: String(body.LOAD_AVG || '-').slice(0, 100),
    uptime: String(body.UPTIME || '-').slice(0, 100),
    osInfo: String(body.OS_INFO || '').slice(0, 255),
    tcpConnections: Math.max(parseInt(body.TCP_CONN, 10) || 0, 0),
    udpConnections: Math.max(parseInt(body.UDP_CONN, 10) || 0, 0),
    version: String(body.VERSION || '').slice(0, 20),
    staticFlag: body.STATIC === '1',
    kernel: String(body.KERNEL || '').slice(0, 100),
    arch: String(body.ARCH || '').slice(0, 32),
    cpuCores: Math.max(parseInt(body.CPU_CORES, 10) || 0, 0),
    cpuModel: String(body.CPU_MODEL || '').slice(0, 120)
  };
}

async function handleAgentReport(req, res) {
  const token = String(req.get('X-Agent-Token') || '');
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return res.status(401).json({ code: 401, message: 'invalid token' });
  }
  const hash = sha256(token);
  const server = await db.queryOne(
    'SELECT s.*, g.name AS group_name FROM servers s LEFT JOIN server_groups g ON s.group_id = g.id WHERE s.agent_token_hash = ?',
    [hash]
  );
  if (!server || !tokenHashEquals(server.agent_token_hash, hash)) {
    return res.status(401).json({ code: 401, message: 'unknown agent' });
  }

  const m = parseReportBody(req.body || {});
  const interval = await getAgentInterval();

  try {
    await db.insert(
      'INSERT INTO server_metrics (server_id, cpu_usage, memory_total, memory_used, memory_usage, disk_total, disk_used, disk_usage, network_rx_bytes, network_tx_bytes, net_rx_rate, net_tx_rate, load_avg, uptime) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [server.id, m.cpu, m.memTotal, m.memUsed, m.memUsage, m.diskTotal, m.diskUsed, m.diskUsage, m.netRxBytes, m.netTxBytes, m.netRxRate, m.netTxRate, m.loadAvg, m.uptime]
    );

    await db.update(
      "UPDATE servers SET status='online', cpu_usage=?, memory_usage=?, disk_usage=?, os_info=COALESCE(?, os_info), uptime=?, load_avg=?, mem_total_mb=?, mem_used_mb=?, disk_total_mb=?, disk_used_mb=?, network_rx_bytes=?, network_tx_bytes=?, tcp_connections=?, udp_connections=?, agent_last_report_at=NOW(), agent_version=? WHERE id=?",
      [m.cpu, m.memUsage, m.diskUsage, m.osInfo || null, m.uptime, m.loadAvg, m.memTotal, m.memUsed, m.diskTotal, m.diskUsed, m.netRxBytes, m.netTxBytes, m.tcpConnections, m.udpConnections, m.version, server.id]
    );

    if (server.status !== 'online') {
      await db.insert('INSERT INTO server_status_changes (server_id, old_status, new_status) VALUES (?, ?, ?)', [server.id, server.status || 'unknown', 'online']).catch(() => {});
    }

    // 静态信息（agent 每 60s 附带一次）+ 出口 IP：零 SSH 成本补齐 system_info
    if (m.staticFlag) {
      try {
        const current = server.system_info ? JSON.parse(server.system_info) : {};
        current.kernel = m.kernel || current.kernel;
        current.arch = m.arch || current.arch;
        current.cpu_cores = m.cpuCores || current.cpu_cores;
        current.cpu_model = m.cpuModel || current.cpu_model;
        if (req.ip && !current.public_ipv4) current.public_ipv4 = req.ip;
        await db.update('UPDATE servers SET system_info = ? WHERE id = ?', [JSON.stringify(current), server.id]).catch(() => {});
      } catch {}
    }

    await checkMetricAlerts(server, m);
    ruleEngine.evaluateServer(server, m).catch(() => {});

    // 实时订阅：/metrics 命名空间转发给前端，不再开 SSH 连接
    agentEvents.emit(`metrics:${server.id}`, {
      cpu: m.cpu,
      mem_usage: m.memUsage,
      mem_used: m.memUsed,
      mem_total: m.memTotal,
      disk_usage: m.diskUsage,
      disk_used: m.diskUsed,
      disk_total: m.diskTotal,
      net_rx_bytes: m.netRxBytes,
      net_tx_bytes: m.netTxBytes,
      net_rx_rate: m.netRxRate,
      net_tx_rate: m.netTxRate,
      load_avg: m.loadAvg,
      uptime: m.uptime,
      timestamp: Date.now()
    });

    res.json({ code: 0, data: { interval } });
  } catch (err) {
    res.status(500).json({ code: 500, message: 'report failed' });
  }
}

// 生成新 token：返回明文（只在安装时展示），入库前存哈希
async function issueAgentToken(serverId) {
  const token = generateAgentToken();
  await db.update('UPDATE servers SET agent_token_hash = ?, agent_last_report_at = NULL WHERE id = ?', [sha256(token), serverId]);
  return token;
}

async function clearAgentToken(serverId) {
  await db.update('UPDATE servers SET agent_token_hash = NULL, agent_last_report_at = NULL, agent_version = NULL WHERE id = ?', [serverId]);
}

module.exports = { agentEvents, isAgentFresh, isAgentFreshAsync, handleAgentReport, issueAgentToken, clearAgentToken, sha256, getAgentInterval };
