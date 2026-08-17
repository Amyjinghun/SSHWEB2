const cron = require('node-cron');
const db = require('../db');
const { createSSHConnection, execCommand, isDangerousCommand } = require('../ssh/connection');
const config = require('../config');
const { createAndNotifyAlert, getAlertNumber, getAlertBoolean, getSettingValue } = require('../services/telegram');
const ruleEngine = require('../services/rule-engine');
const { runWithConcurrency } = require('../utils/async');
const { cleanupOldData } = require('../services/cleanup');

let runningSchedulers = [];
let statusCheckRunning = false;
let statusTimer = null;

const COLLECT_SCRIPT = String.raw`#!/bin/sh
LC_ALL=C
export LC_ALL

read TOTAL1 IDLE1 <<EOF
$(awk '/^cpu / { idle=$5+$6; total=0; for(i=2;i<=NF;i++) total+=$i; print total, idle; exit }' /proc/stat)
EOF
sleep 1
read TOTAL2 IDLE2 <<EOF
$(awk '/^cpu / { idle=$5+$6; total=0; for(i=2;i<=NF;i++) total+=$i; print total, idle; exit }' /proc/stat)
EOF

CPU_USAGE=$(awk -v t1="$TOTAL1" -v t2="$TOTAL2" -v i1="$IDLE1" -v i2="$IDLE2" 'BEGIN {
  dt=t2-t1; di=i2-i1;
  if (dt <= 0) printf "0.00";
  else printf "%.2f", (1 - di/dt) * 100;
}')

printf 'CPU_USAGE=%s\n' "$CPU_USAGE"

awk '
/MemTotal/ { total=$2 }
/MemAvailable/ { available=$2 }
END {
  if (total <= 0) total=1;
  used=total-available;
  printf "MEM_TOTAL_MB=%d\n", total/1024;
  printf "MEM_USED_MB=%d\n", used/1024;
  printf "MEM_USAGE=%.2f\n", used/total*100;
}' /proc/meminfo

df -Pm / | awk 'NR==2 {
  gsub("%","",$5);
  printf "DISK_TOTAL_MB=%d\n", $2;
  printf "DISK_USED_MB=%d\n", $3;
  printf "DISK_USAGE=%.2f\n", $5;
}'

awk -F'[: ]+' '
NR > 2 {
  iface=$2;
  if (iface == "lo") next;
  rx += $3;
  tx += $11;
}
END {
  printf "NET_RX_BYTES=%.0f\n", rx;
  printf "NET_TX_BYTES=%.0f\n", tx;
}' /proc/net/dev 2>/dev/null || {
  printf 'NET_RX_BYTES=0\n'
  printf 'NET_TX_BYTES=0\n'
}

awk '{ printf "LOAD_AVG=%s %s %s\n", $1, $2, $3 }' /proc/loadavg 2>/dev/null || printf 'LOAD_AVG=-\n'

if [ -f /etc/os-release ]; then
  OS_INFO=$(awk -F= '/^PRETTY_NAME=/{gsub(/^"|"$/,"",$2); print $2; exit}' /etc/os-release)
  if [ -z "$OS_INFO" ]; then
    OS_INFO=$(awk -F= '/^NAME=/{gsub(/^"|"$/,"",$2); print $2; exit}' /etc/os-release)
  fi
else
  OS_INFO=$(uname -srm 2>/dev/null)
fi

UPTIME_INFO=$(uptime -p 2>/dev/null || uptime 2>/dev/null || printf '-')

printf 'OS_INFO=%s\n' "$OS_INFO"
printf 'UPTIME=%s\n' "$UPTIME_INFO"

# TCP/UDP 连接数（inuse），优先 /proc/net/sockstat 不依赖 ss 命令
awk '/^TCP:/{tcp=$3} /^UDP:/{udp=$3} END{printf "TCP_CONN=%d\nUDP_CONN=%d\n", tcp+0, udp+0}' /proc/net/sockstat 2>/dev/null || printf 'TCP_CONN=0\nUDP_CONN=0\n'
`;

function n(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function parseKeyValueOutput(out) {
  const data = {};
  String(out || '').split(/\r?\n/).forEach(line => {
    const idx = line.indexOf('=');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) data[key] = value;
  });
  return data;
}


function parseTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(tags).split(',').map(t => t.trim()).filter(Boolean);
  }
}

function baseAlertVars(server, extra = {}) {
  return {
    server_name: server.name || server.host || '-',
    name: server.name || server.host || '-',
    host: server.host || '-',
    ip: server.host || '-',
    port: server.port || 22,
    username: server.username || '-',
    auth_type: server.auth_type || '-',
    group_name: server.group_name || server.groupName || '-',
    tags: parseTags(server.tags),
    remark: server.remark || '-',
    os_info: server.os_info || '-',
    expires_at: server.expires_at || '-',
    ...extra
  };
}

function buildCollectCommand() {
  return `sh -s <<'__SSHWEB_MONITOR__'\n${COLLECT_SCRIPT}\n__SSHWEB_MONITOR__`;
}

async function collectServerMetrics(conn) {
  const { out } = await execCommand(conn, buildCollectCommand(), 30000);
  const kv = parseKeyValueOutput(out);

  return {
    cpu: n(kv.CPU_USAGE, 0),
    memTotal: n(kv.MEM_TOTAL_MB, 0),
    memUsed: n(kv.MEM_USED_MB, 0),
    memUsage: n(kv.MEM_USAGE, 0),
    diskTotal: n(kv.DISK_TOTAL_MB, 0),
    diskUsed: n(kv.DISK_USED_MB, 0),
    diskUsage: n(kv.DISK_USAGE, 0),
    netRxBytes: n(kv.NET_RX_BYTES, 0),
    netTxBytes: n(kv.NET_TX_BYTES, 0),
    loadAvg: kv.LOAD_AVG || '-',
    uptime: kv.UPTIME || '-',
    osInfo: (kv.OS_INFO || '').slice(0, 255),
    tcpConnections: n(kv.TCP_CONN, 0),
    udpConnections: n(kv.UDP_CONN, 0)
  };
}

// 静态系统信息采集间隔：6 小时（内核/架构/DNS/公网IP/位置等几乎不变，低频采即可）
const STATIC_INFO_INTERVAL_MS = 6 * 3600 * 1000;

const STATIC_INFO_SCRIPT = String.raw`#!/bin/sh
LC_ALL=C
export LC_ALL

KERNEL=$(uname -r 2>/dev/null || echo '-')
ARCH=$(uname -m 2>/dev/null || echo '-')
CPU_CORES=$(nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo '0')
CPU_MODEL=$(awk -F': ' '/^model name/{print $2; exit}' /proc/cpuinfo 2>/dev/null | head -c 120)
[ -z "$CPU_MODEL" ] && CPU_MODEL='-'
DNS_SERVERS=$(grep -E '^[[:space:]]*nameserver' /etc/resolv.conf 2>/dev/null | awk '{print $2}' | head -3 | tr '\n' ',' | sed 's/,$//')
[ -z "$DNS_SERVERS" ] && DNS_SERVERS='-'
TCP_CONGESTION=$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || echo '-')

# 公网信息（超时 3 秒，失败留空；内网机器访问不了外网这几项就空着）
PUBLIC_INFO=$(curl -4 -s --max-time 3 '__IPINFO_URL__' 2>/dev/null | tr -d '\n\r')
PUBLIC_IPV6=$(curl -6 -s --max-time 3 'https://api6.ipify.org' 2>/dev/null | tr -d '\n\r')

printf 'KERNEL=%s\n' "$KERNEL"
printf 'ARCH=%s\n' "$ARCH"
printf 'CPU_CORES=%s\n' "$CPU_CORES"
printf 'CPU_MODEL=%s\n' "$CPU_MODEL"
printf 'DNS_SERVERS=%s\n' "$DNS_SERVERS"
printf 'TCP_CONGESTION=%s\n' "$TCP_CONGESTION"
printf 'PUBLIC_INFO=%s\n' "$PUBLIC_INFO"
printf 'PUBLIC_IPV6=%s\n' "$PUBLIC_IPV6"
`;

function buildStaticInfoCommand(provider) {
  // ipinfo.io: HTTPS，免费 50000 次/月，国内可能不可达
  // ip-api.com: HTTP，免费 45 次/分钟，国内可达
  const url = provider === 'ipapi'
    ? 'http://ip-api.com/json/?fields=query,city,regionName,country,isp'
    : 'https://ipinfo.io/json';
  const script = STATIC_INFO_SCRIPT.replace('__IPINFO_URL__', url);
  return `sh -s <<'__SSHWEB_STATIC__'\n${script}\n__SSHWEB_STATIC__`;
}

async function collectStaticInfo(conn) {
  const provider = await getSettingValue('ip_query_provider', 'ipinfo');
  const { out } = await execCommand(conn, buildStaticInfoCommand(provider), 30000);
  const kv = parseKeyValueOutput(out);
  let p = {};
  try { p = JSON.parse(kv.PUBLIC_INFO || '{}'); } catch {}
  // 兼容两个 API 的字段名：ipinfo.io(ip/region/org) vs ip-api.com(query/regionName/isp)
  const ipv4 = p.ip || p.query || '';
  const region = p.region || p.regionName || '';
  const org = p.org || p.isp || '';
  return {
    kernel: kv.KERNEL || '-',
    arch: kv.ARCH || '-',
    cpu_cores: n(kv.CPU_CORES, 0),
    cpu_model: kv.CPU_MODEL || '-',
    dns_servers: kv.DNS_SERVERS || '-',
    tcp_congestion: kv.TCP_CONGESTION || '-',
    public_ipv4: ipv4,
    public_ipv6: kv.PUBLIC_IPV6 || '',
    geo_location: [p.city, region, p.country].filter(Boolean).join(', '),
    isp: org
  };
}

// 低频采集：距上次采集超过 6 小时才采，用现有 SSH 连接不额外开。失败不影响主流程。
async function maybeCollectStaticInfo(server, conn) {
  const last = server.static_info_updated_at ? new Date(server.static_info_updated_at).getTime() : 0;
  if (Date.now() - last < STATIC_INFO_INTERVAL_MS) return false;
  try {
    const info = await collectStaticInfo(conn);
    await db.update('UPDATE servers SET system_info = ?, static_info_updated_at = NOW() WHERE id = ?', [JSON.stringify(info), server.id]);
    return true;
  } catch (err) {
    console.error(`[静态信息采集失败 ${server.name || server.host}]:`, err.message);
    return false;
  }
}

async function checkMetricAlerts(server, metrics) {
  const serverName = server.name || server.host;

  const enableCpu = await getAlertBoolean('alert_enable_cpu', config.alerts.enableCpuAlert);
  if (enableCpu) {
    const cpuThreshold = await getAlertNumber('alert_cpu_threshold', config.alerts.cpuThreshold);
    if (metrics.cpu >= cpuThreshold) {
      await createAndNotifyAlert({
        serverId: server.id,
        level: 'critical',
        title: `CPU占用过高：${serverName}`,
        content: `服务器：${serverName}\nIP：${server.host}\n当前CPU：${metrics.cpu.toFixed(2)}%\n阈值：${cpuThreshold}%`,
        templateKey: 'alert_template_cpu',
        variables: baseAlertVars(server, {
          cpu_usage: metrics.cpu.toFixed(2),
          threshold: cpuThreshold,
          os_info: metrics.osInfo || server.os_info || '-'
        })
      });
    }
  }

  const enableMemory = await getAlertBoolean('alert_enable_memory', config.alerts.enableMemoryAlert);
  if (enableMemory) {
    const memoryThreshold = await getAlertNumber('alert_memory_threshold', config.alerts.memoryThreshold);
    if (metrics.memUsage >= memoryThreshold) {
      await createAndNotifyAlert({
        serverId: server.id,
        level: 'critical',
        title: `内存占用过高：${serverName}`,
        content: `服务器：${serverName}\nIP：${server.host}\n当前内存：${metrics.memUsage.toFixed(2)}%\n已用/总量：${metrics.memUsed}MB / ${metrics.memTotal}MB\n阈值：${memoryThreshold}%`,
        templateKey: 'alert_template_memory',
        variables: baseAlertVars(server, {
          memory_usage: metrics.memUsage.toFixed(2),
          memory_used: metrics.memUsed,
          memory_total: metrics.memTotal,
          threshold: memoryThreshold,
          os_info: metrics.osInfo || server.os_info || '-'
        })
      });
    }
  }

  const enableDisk = await getAlertBoolean('alert_enable_disk', config.alerts.enableDiskAlert);
  if (enableDisk) {
    const diskThreshold = await getAlertNumber('alert_disk_threshold', config.alerts.diskThreshold);
    if (metrics.diskUsage >= diskThreshold) {
      await createAndNotifyAlert({
        serverId: server.id,
        level: 'warning',
        title: `磁盘占用过高：${serverName}`,
        content: `服务器：${serverName}\nIP：${server.host}\n根分区磁盘：${metrics.diskUsage.toFixed(2)}%\n已用/总量：${metrics.diskUsed}MB / ${metrics.diskTotal}MB\n阈值：${diskThreshold}%`,
        templateKey: 'alert_template_disk',
        variables: baseAlertVars(server, {
          disk_usage: metrics.diskUsage.toFixed(2),
          disk_used: metrics.diskUsed,
          disk_total: metrics.diskTotal,
          threshold: diskThreshold,
          os_info: metrics.osInfo || server.os_info || '-'
        })
      });
    }
  }
}


function parseCronField(field, min, max) {
  const values = new Set();
  const parts = String(field || '').split(',');
  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) return null;
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step <= 0) return null;

    let start;
    let end;
    if (rangePart === '*') {
      start = min;
      end = max;
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-').map(Number);
      if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
      start = a;
      end = b;
    } else {
      const v = Number(rangePart);
      if (!Number.isInteger(v)) return null;
      start = v;
      end = v;
    }
    if (start < min || end > max || start > end) return null;
    for (let i = start; i <= end; i += step) values.add(i);
  }
  return values;
}

function shouldRunCronNow(cronExpr, now, lastRunAt) {
  const expr = String(cronExpr || '').trim();
  if (!cron.validate(expr)) return false;
  const fields = expr.split(/\s+/);
  if (fields.length !== 5) return false;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields.map((field, idx) => {
    const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
    return parseCronField(field, ranges[idx][0], ranges[idx][1]);
  });
  if ([minute, hour, dayOfMonth, month, dayOfWeek].some(v => !v)) return false;

  const dow = now.getDay();
  const matchesDow = dayOfWeek.has(dow) || (dow === 0 && dayOfWeek.has(7));
  const matches = minute.has(now.getMinutes()) && hour.has(now.getHours()) &&
    dayOfMonth.has(now.getDate()) && month.has(now.getMonth() + 1) && matchesDow;
  if (!matches) return false;

  if (!lastRunAt) return true;
  const last = new Date(lastRunAt);
  const currentMinuteStart = new Date(now);
  currentMinuteStart.setSeconds(0, 0);
  return last < currentMinuteStart;
}

async function checkOneServer(server) {
  let conn;
  try {
    conn = await createSSHConnection(server);
    const metrics = await collectServerMetrics(conn);

    await db.insert(
      'INSERT INTO server_metrics (server_id, cpu_usage, memory_total, memory_used, memory_usage, disk_total, disk_used, disk_usage, network_rx_bytes, network_tx_bytes, load_avg, uptime) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [server.id, metrics.cpu, metrics.memTotal, metrics.memUsed, metrics.memUsage, metrics.diskTotal, metrics.diskUsed, metrics.diskUsage, metrics.netRxBytes, metrics.netTxBytes, metrics.loadAvg, metrics.uptime]
    );

    await db.update(
      "UPDATE servers SET status='online', cpu_usage=?, memory_usage=?, disk_usage=?, os_info=COALESCE(?, os_info), uptime=?, load_avg=?, mem_total_mb=?, mem_used_mb=?, disk_total_mb=?, disk_used_mb=?, network_rx_bytes=?, network_tx_bytes=?, tcp_connections=?, udp_connections=?, last_connected_at=NOW() WHERE id=?",
      [metrics.cpu, metrics.memUsage, metrics.diskUsage, metrics.osInfo || null, metrics.uptime, metrics.loadAvg, metrics.memTotal, metrics.memUsed, metrics.diskTotal, metrics.diskUsed, metrics.netRxBytes, metrics.netTxBytes, metrics.tcpConnections, metrics.udpConnections, server.id]
    );

    if (server.status !== 'online') {
      await db.insert('INSERT INTO server_status_changes (server_id, old_status, new_status) VALUES (?, ?, ?)', [server.id, server.status || 'unknown', 'online']);
    }

    // 低频采集静态系统信息（内核/架构/公网IP/位置等，6 小时一次，复用当前 SSH 连接）
    await maybeCollectStaticInfo(server, conn);

    await checkMetricAlerts(server, metrics);
    // 规则引擎 agent：评估 alert_rules 自定义规则（自带总开关，与上面硬编码规则并存）
    await ruleEngine.evaluateServer(server, metrics);
    await db.remove('DELETE FROM server_metrics WHERE server_id=? AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)', [server.id]);

    return { ok: true, metrics };
  } catch (err) {
    await db.update("UPDATE servers SET status='offline' WHERE id=?", [server.id]);
    if (server.status !== 'offline') {
      await db.insert('INSERT INTO server_status_changes (server_id, old_status, new_status) VALUES (?, ?, ?)', [server.id, server.status || 'unknown', 'offline']);
    }
    const enableOffline = await getAlertBoolean('alert_enable_offline', config.alerts.enableOfflineAlert);
    if (enableOffline) {
      await createAndNotifyAlert({
        serverId: server.id,
        level: 'critical',
        title: `服务器离线：${server.name || server.host}`,
        content: `服务器：${server.name || server.host}\nIP：${server.host}\nSSH端口：${server.port || 22}\n失败原因：${err.message || '连接失败'}`,
        templateKey: 'alert_template_offline',
        variables: baseAlertVars(server, { error: err.message || '连接失败' })
      });
    }
    return { ok: false, error: err.message };
  } finally {
    try { if (conn) conn.end(); } catch {}
  }
}

async function checkAllServers() {
  if (statusCheckRunning) return { skipped: true, message: '上一次检测仍在运行' };
  statusCheckRunning = true;

  try {
    const servers = await db.query(`SELECT s.*, g.name AS group_name FROM servers s LEFT JOIN server_groups g ON s.group_id = g.id ORDER BY s.id ASC`);
    if (!servers.length) return { total: 0, success: 0, failed: 0 };

    const concurrency = clamp(await getAlertNumber('server_monitor_concurrency', 5), 1, 30);
    const results = await runWithConcurrency(servers, concurrency, checkOneServer);
    const success = results.filter(r => r && r.ok).length;
    const failed = results.length - success;

    console.log(`服务器状态检测完成：总数 ${servers.length}，在线 ${success}，失败/离线 ${failed}，并发 ${concurrency}`);
    return { total: servers.length, success, failed };
  } catch (err) {
    console.error('服务器状态检测失败:', err.message);
    return { ok: false, error: err.message };
  } finally {
    statusCheckRunning = false;
  }
}

async function checkServerExpiry() {
  try {
    const enableExpiry = await getAlertBoolean('alert_enable_expiry', true);
    if (!enableExpiry) return;

    const days = await getAlertNumber('alert_server_expiry_days', config.alerts.serverExpiryDays);
    const servers = await db.query(
      `SELECT s.id, s.name, s.host, s.port, s.username, s.tags, s.remark, g.name AS group_name,
              DATE_FORMAT(s.expires_at, '%Y-%m-%d') AS expires_at,
              DATEDIFF(s.expires_at, CURDATE()) AS days_left
       FROM servers s
       LEFT JOIN server_groups g ON s.group_id = g.id
       WHERE s.expires_at IS NOT NULL
         AND DATEDIFF(s.expires_at, CURDATE()) <= ?`,
      [days]
    );

    for (const server of servers) {
      const daysLeft = Number(server.days_left);
      const expired = daysLeft < 0;
      await createAndNotifyAlert({
        serverId: server.id,
        level: expired ? 'critical' : 'warning',
        title: expired ? `服务器已到期：${server.name || server.host}` : `服务器即将到期：${server.name || server.host}`,
        content: expired
          ? `服务器：${server.name || server.host}\nIP：${server.host}\n到期时间：${server.expires_at}\n已过期：${Math.abs(daysLeft)} 天\n备注：${server.remark || '-'}`
          : `服务器：${server.name || server.host}\nIP：${server.host}\n到期时间：${server.expires_at}\n剩余天数：${daysLeft} 天\n备注：${server.remark || '-'}\n提醒规则：提前 ${days} 天开始通知`,
        templateKey: expired ? 'alert_template_expired' : 'alert_template_expiry',
        variables: baseAlertVars(server, {
          expires_at: server.expires_at,
          days_left: daysLeft,
          expired_days: Math.abs(daysLeft),
          reminder_days: days
        })
      });
    }
  } catch (err) {
    console.error('服务器到期检查失败:', err.message);
  }
}

async function statusLoop() {
  try {
    await checkAllServers();
    const modeSetting = await db.queryOne("SELECT setting_value FROM settings WHERE setting_key='server_monitor_mode'");
    const rawInterval = await getAlertNumber('server_check_interval', 10);
    const mode = modeSetting?.setting_value
      ? String(modeSetting.setting_value)
      : (rawInterval >= 120 ? 'normal' : 'realtime');
    const intervalSeconds = mode === 'normal'
      ? clamp(rawInterval, 120, 180)
      : clamp(rawInterval, 5, 60);
    statusTimer = setTimeout(statusLoop, intervalSeconds * 1000);
  } catch (err) {
    // DB 瞬断等异常不能让循环死掉，兜底 60s 后重试，否则监控会冻结到进程重启
    console.error('状态监控循环异常，60秒后重试:', err.message);
    statusTimer = setTimeout(statusLoop, 60 * 1000);
  }
}


function parseTaskServerIds(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(Number).filter(Boolean);
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(Number).filter(Boolean) : [];
  } catch {
    return String(value).split(',').map(v => Number(v.trim())).filter(Boolean);
  }
}

async function getScheduledTaskServers(task) {
  const type = task.target_type || (task.server_id ? 'server' : 'server_list');
  if (type === 'group') {
    if (!task.group_id) return [];
    return db.query('SELECT * FROM servers WHERE group_id = ? ORDER BY id ASC', [task.group_id]);
  }
  if (type === 'server_list') {
    const ids = parseTaskServerIds(task.server_ids);
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    return db.query(`SELECT * FROM servers WHERE id IN (${placeholders}) ORDER BY id ASC`, ids);
  }
  if (!task.server_id) return [];
  return db.query('SELECT * FROM servers WHERE id = ?', [task.server_id]);
}

// 数据自动清理：每天 03:30 按系统设置的天数清理过期日志（默认 90 天）
async function autoCleanup() {
  try {
    const days = {
      audit_days: await getAlertNumber('cleanup_audit_days', 90),
      command_log_days: await getAlertNumber('cleanup_command_log_days', 90),
      alert_days: await getAlertNumber('cleanup_alert_days', 90)
    };
    const results = await cleanupOldData(days);
    console.log(`自动数据清理完成：审计日志 ${results.audit_logs} 条，执行历史 ${results.command_logs} 条，告警记录 ${results.alert_logs} 条`);
  } catch (err) {
    console.error('自动数据清理失败:', err.message);
  }
}

async function runScheduledCommandTask(task) {
  const servers = await getScheduledTaskServers(task);
  if (!servers.length) {
    console.error(`计划任务没有可执行目标 [${task.name}]`);
    return { total: 0, success: 0, failed: 0 };
  }

  // 有限并发执行，批量目标不再逐台串行
  const results = await runWithConcurrency(servers, 5, async (server) => {
    let conn;
    try {
      conn = await createSSHConnection(server);
      const result = await execCommand(conn, task.command);
      return result.exitCode === 0;
    } catch (err) {
      console.error(`计划任务执行失败 [${task.name}] -> ${server.name || server.host}:`, err.message);
      return false;
    } finally {
      try { if (conn) conn.end(); } catch {}
    }
  });
  const success = results.filter(Boolean).length;
  return { total: servers.length, success, failed: servers.length - success };
}

function startSchedulers() {
  statusTimer = setTimeout(statusLoop, 10000);
  runningSchedulers.push({ stop: () => clearTimeout(statusTimer) });

  // 服务器到期提醒：启动后检查一次，之后每天 09:00 检查
  setTimeout(checkServerExpiry, 15000);
  const expiryScheduler = cron.schedule('0 9 * * *', checkServerExpiry);
  runningSchedulers.push(expiryScheduler);

  // 数据自动清理：每天 03:30 清理过期日志
  const cleanupScheduler = cron.schedule('30 3 * * *', autoCleanup);
  runningSchedulers.push(cleanupScheduler);

  // 计划任务执行器 - 每分钟检查，支持单台、多台和分组目标
  const taskScheduler = cron.schedule('* * * * *', async () => {
    try {
      const tasks = await db.query(`SELECT id, name, target_type, server_id, server_ids, group_id, command, cron_expr, last_run_at
        FROM scheduled_tasks WHERE enabled = 1`);
      const now = new Date();
      for (const task of tasks) {
        try {
          if (!shouldRunCronNow(task.cron_expr, now, task.last_run_at)) continue;
          if (isDangerousCommand(task.command)) {
            console.error(`计划任务被安全策略拦截 [${task.name}]`);
            continue;
          }

          const result = await runScheduledCommandTask(task);
          await db.update('UPDATE scheduled_tasks SET last_run_at = NOW() WHERE id = ?', [task.id]);
          console.log(`计划任务执行完成 [${task.name}]：总数 ${result.total}，成功 ${result.success}，失败 ${result.failed}`);
        } catch (err) {
          console.error(`计划任务执行失败 [${task.name}]:`, err.message);
        }
      }
    } catch (err) {
      console.error('计划任务调度失败:', err.message);
    }
  });

  runningSchedulers.push(taskScheduler);
}

function stopSchedulers() {
  runningSchedulers.forEach(s => { try { s.stop ? s.stop() : clearInterval(s); } catch {} });
  runningSchedulers = [];
}

module.exports = {
  startSchedulers,
  stopSchedulers,
  checkAllServers,
  checkOneServer,
  checkServerExpiry,
  collectServerMetrics
};
