// 指标告警评估：SSH 采集（scheduler）与 Agent 上报（services/agent）共用，
// 从 scheduler 抽出以避免 agent.js → scheduler 的循环依赖。
const config = require('../config');
const { createAndNotifyAlert, getAlertBoolean, getAlertNumber } = require('./telegram');

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

module.exports = { parseTags, baseAlertVars, checkMetricAlerts };
