<template>
  <div class="page-container monitor-page">
    <el-card shadow="hover" class="monitor-card">
      <div class="monitor-header">
        <div>
          <div class="page-title">资源监控</div>
          <div class="page-desc">统一查看全部服务器的准实时资源快照，数据由后端定时采集并缓存</div>
        </div>
        <div class="monitor-state">
          <span class="state-dot" :class="{ online: connected }"></span>
          <span>{{ connected ? '实时推送中' : '连接中' }}</span>
          <em>更新 {{ updatedText }}</em>
        </div>
      </div>

      <div class="summary-row">
        <div class="summary-item">
          <span>服务器</span>
          <strong>{{ summary.total }}</strong>
        </div>
        <div class="summary-item success">
          <span>在线</span>
          <strong>{{ summary.online }}</strong>
        </div>
        <div class="summary-item muted">
          <span>离线</span>
          <strong>{{ summary.offline }}</strong>
        </div>
        <div class="summary-item danger">
          <span>高负载</span>
          <strong>{{ summary.critical }}</strong>
        </div>
      </div>

      <div class="filter-bar">
        <el-select v-model="groupFilter" placeholder="全部分组" clearable>
          <el-option label="全部分组" value="" />
          <el-option v-for="group in groups" :key="group.id" :label="group.name" :value="group.id" />
        </el-select>
        <el-input v-model="keyword" placeholder="搜索服务器/系统版本" clearable />
        <el-select v-model="statusFilter" placeholder="全部状态" clearable>
          <el-option label="全部状态" value="" />
          <el-option label="在线" value="online" />
          <el-option label="离线" value="offline" />
          <el-option label="未知" value="unknown" />
        </el-select>
        <el-select v-model="sortBy" placeholder="排序">
          <el-option label="默认排序" value="default" />
          <el-option label="CPU 高到低" value="cpu" />
          <el-option label="内存 高到低" value="memory" />
          <el-option label="磁盘 高到低" value="disk" />
          <el-option label="告警优先" value="health" />
        </el-select>
      </div>

      <el-alert
        v-if="!connected && loaded"
        title="实时连接暂未建立，页面会在连接恢复后自动刷新快照。"
        type="warning"
        show-icon
        :closable="false"
        class="monitor-alert"
      />

      <div v-if="loaded && !filteredServers.length" class="empty-state">
        暂无符合条件的服务器
      </div>

      <div v-else class="server-grid">
        <article
          v-for="server in filteredServers"
          :key="server.id"
          class="mc-card"
          :class="cardHealth(server).className"
        >
          <header class="mc-head">
            <div class="mc-title-row">
              <strong :title="server.name">{{ server.name }}</strong>
              <span v-if="server.group_name" class="mc-tag">{{ server.group_name }}</span>
              <span class="mc-status" :class="server.status"><i></i>{{ statusText(server.status) }}</span>
            </div>
            <div class="mc-host">{{ server.host }}<span v-if="server.os_info"> · {{ server.os_info }}</span></div>
          </header>

          <div class="mc-metrics">
            <div class="mc-metric">
              <span>CPU</span>
              <strong :class="pct(server.cpu_usage) >= 90 ? 'high' : pct(server.cpu_usage) >= 70 ? 'warn' : ''">{{ pct(server.cpu_usage) }}%</strong>
              <div class="mc-bar"><div :style="{ width: pct(server.cpu_usage) + '%', background: usageColor(server.cpu_usage) }"></div></div>
              <small>{{ server._sys?.cpu_cores || '?' }} 核</small>
            </div>
            <div class="mc-metric">
              <span>内存</span>
              <strong :class="pct(server.memory_usage) >= 90 ? 'high' : pct(server.memory_usage) >= 70 ? 'warn' : ''">{{ pct(server.memory_usage) }}%</strong>
              <div class="mc-bar"><div :style="{ width: pct(server.memory_usage) + '%', background: usageColor(server.memory_usage) }"></div></div>
              <small>{{ mb(server.mem_used_mb) }} / {{ mb(server.mem_total_mb) }}</small>
            </div>
            <div class="mc-metric">
              <span>磁盘</span>
              <strong :class="pct(server.disk_usage) >= 90 ? 'high' : pct(server.disk_usage) >= 70 ? 'warn' : ''">{{ pct(server.disk_usage) }}%</strong>
              <div class="mc-bar"><div :style="{ width: pct(server.disk_usage) + '%', background: usageColor(server.disk_usage) }"></div></div>
              <small>{{ mb(server.disk_used_mb) }} / {{ mb(server.disk_total_mb) }}</small>
            </div>
          </div>

          <div class="mc-details">
            <div><span>负载</span><strong>{{ server.load_avg || '-' }}</strong></div>
            <div><span>运行</span><strong :title="server.uptime || ''">{{ server.uptime || '-' }}</strong></div>
            <div><span>下行</span><strong>{{ rateStr(server._rxRate) }} <small style="font-size:10px;opacity:.5;font-weight:400">{{ bytes(server.network_rx_bytes) }}</small></strong></div>
            <div><span>上行</span><strong>{{ rateStr(server._txRate) }} <small style="font-size:10px;opacity:.5;font-weight:400">{{ bytes(server.network_tx_bytes) }}</small></strong></div>
            <div><span>TCP</span><strong>{{ server.tcp_connections ?? '-' }}</strong></div>
            <div><span>UDP</span><strong>{{ server.udp_connections ?? '-' }}</strong></div>
          </div>

          <div class="mc-sysinfo" v-if="server._sys && Object.keys(server._sys).length">
            <div><span>内核</span><strong :title="server._sys.kernel">{{ server._sys.kernel || '-' }}</strong></div>
            <div><span>架构</span><strong>{{ server._sys.arch || '-' }}</strong></div>
            <div><span>拥塞</span><strong>{{ server._sys.tcp_congestion || '-' }}</strong></div>
            <div v-if="server._sys.cpu_model" class="mc-wide"><span>型号</span><strong :title="server._sys.cpu_model">{{ server._sys.cpu_model }}</strong></div>
          </div>

          <div class="mc-public" v-if="hasPublicInfo(server._sys)">
            <div v-if="server._sys.public_ipv4"><span>IPv4</span><strong>{{ server._sys.public_ipv4 }}</strong></div>
            <div v-if="server._sys.public_ipv6"><span>IPv6</span><strong :title="server._sys.public_ipv6">{{ server._sys.public_ipv6 }}</strong></div>
            <div v-if="server._sys.geo_location"><span>位置</span><strong>{{ server._sys.geo_location }}</strong></div>
            <div v-if="server._sys.isp"><span>运营商</span><strong>{{ server._sys.isp }}</strong></div>
            <div v-if="server._sys.dns_servers" class="mc-wide"><span>DNS</span><strong :title="server._sys.dns_servers">{{ server._sys.dns_servers }}</strong></div>
          </div>

          <footer class="mc-footer">
            <span>最后连接 {{ formatTime(server.last_connected_at) }}</span>
            <div class="mc-expiry" v-if="server._expiry" :class="server._expiry.className">
              到期 {{ server._expiry.date }} · {{ server._expiry.text }}
            </div>
          </footer>
        </article>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { io } from 'socket.io-client'

const servers = ref([])
const loaded = ref(false)
const connected = ref(false)
const updatedAt = ref('')
const groupFilter = ref('')
const statusFilter = ref('')
const keyword = ref('')
const sortBy = ref('health')
let socket = null

const groups = computed(() => {
  const map = new Map()
  for (const server of servers.value) {
    if (server.group_id && server.group_name) map.set(server.group_id, { id: server.group_id, name: server.group_name })
  }
  return Array.from(map.values())
})

const summary = computed(() => {
  const total = servers.value.length
  const online = servers.value.filter(server => server.status === 'online').length
  const offline = servers.value.filter(server => server.status === 'offline').length
  const critical = servers.value.filter(server => cardHealth(server).className === 'critical').length
  return { total, online, offline, critical }
})

const updatedText = computed(() => {
  if (!updatedAt.value) return '-'
  return new Date(updatedAt.value).toLocaleTimeString('zh-CN', { hour12: false })
})

const filteredServers = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  const list = servers.value.filter(server => {
    if (groupFilter.value && server.group_id !== groupFilter.value) return false
    if (statusFilter.value && server.status !== statusFilter.value) return false
    if (!q) return true
    return [server.name, server.host, server.os_info, server.group_name].some(value => String(value || '').toLowerCase().includes(q))
  })
  const healthRank = server => ({ critical: 4, warning: 3, normal: 2, offline: 1 }[cardHealth(server).className] || 0)
  const num = value => Number(value) || 0
  if (sortBy.value === 'cpu') list.sort((a, b) => num(b.cpu_usage) - num(a.cpu_usage))
  else if (sortBy.value === 'memory') list.sort((a, b) => num(b.memory_usage) - num(a.memory_usage))
  else if (sortBy.value === 'disk') list.sort((a, b) => num(b.disk_usage) - num(a.disk_usage))
  else if (sortBy.value === 'health') list.sort((a, b) => healthRank(b) - healthRank(a))
  return list
})

onMounted(connectMonitor)
onBeforeUnmount(disconnectMonitor)

function connectMonitor() {
  const token = localStorage.getItem('token')
  if (!token) return
  socket = io('/monitor', { auth: { token }, transports: ['websocket'] })
  socket.on('connect', () => { connected.value = true })
  socket.on('disconnect', () => { connected.value = false })
  socket.on('connect_error', () => {
    connected.value = false
    loaded.value = true
  })
  const prevNet = {}
  socket.on('snapshot', (list) => {
    const now = Date.now()
    servers.value = (list || []).map(s => {
      let info = s.system_info
      if (typeof info === 'string') { try { info = JSON.parse(info) } catch { info = {} } }
      s._sys = info || {}
      s._expiry = expiryDisplay(s.expires_at)
      const prev = prevNet[s.id]
      let rxRate = 0, txRate = 0
      if (prev) {
        const dt = (now - prev.t) / 1000
        if (dt > 0) {
          rxRate = Math.max(0, (num(s.network_rx_bytes) - prev.rx) / dt)
          txRate = Math.max(0, (num(s.network_tx_bytes) - prev.tx) / dt)
        }
      }
      prevNet[s.id] = { rx: num(s.network_rx_bytes), tx: num(s.network_tx_bytes), t: now }
      s._rxRate = rxRate
      s._txRate = txRate
      return s
    })
    updatedAt.value = new Date().toISOString()
    loaded.value = true
  })
}

function disconnectMonitor() {
  try { socket?.disconnect() } catch {}
  socket = null
}

function rateStr(bps) {
  if (!bps || bps < 1) return '0 B/s'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let i = 0, n = bps
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return n.toFixed(i === 0 ? 0 : 1) + ' ' + units[i]
}
function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function pct(value) {
  return Math.min(100, Math.round(num(value) * 10) / 10)
}

function usageColor(value) {
  const n = num(value)
  if (n >= 90) return '#ef4444'
  if (n >= 70) return '#f59e0b'
  return '#22c55e'
}

function cardHealth(server) {
  if (server.status !== 'online') return { color: '#94a3b8', className: 'offline' }
  if (pct(server.cpu_usage) >= 90 || pct(server.memory_usage) >= 90 || pct(server.disk_usage) >= 90) return { color: '#ef4444', className: 'critical' }
  if (pct(server.cpu_usage) >= 70 || pct(server.memory_usage) >= 70 || pct(server.disk_usage) >= 70) return { color: '#f59e0b', className: 'warning' }
  return { color: '#22c55e', className: 'normal' }
}

function statusText(status) {
  if (status === 'online') return '在线'
  if (status === 'offline') return '离线'
  return '未知'
}

function mb(value) {
  const n = num(value)
  if (n <= 0) return '-'
  if (n >= 1024) return `${(n / 1024).toFixed(1)} GB`
  return `${Math.round(n)} MB`
}

function bytes(value) {
  let n = num(value)
  if (n <= 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let index = 0
  while (n >= 1024 && index < units.length - 1) {
    n /= 1024
    index += 1
  }
  return `${n.toFixed(n >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
}

function formatTime(value) {
  if (!value) return '-'
  return String(value).replace('T', ' ').replace('.000Z', '').replace('Z', '')
}

function hasPublicInfo(sys) {
  return sys && (sys.public_ipv4 || sys.public_ipv6 || sys.geo_location || sys.isp || sys.dns_servers)
}

function expiryDisplay(expiresAt) {
  if (!expiresAt) return null
  const date = String(expiresAt).slice(0, 10)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((new Date(date + 'T00:00:00') - today) / 86400000)
  if (days < 0) return { date, text: `已过期 ${Math.abs(days)} 天`, className: 'expired' }
  if (days === 0) return { date, text: '今天到期', className: 'expired' }
  if (days <= 30) return { date, text: `剩余 ${days} 天`, className: 'expiring' }
  return { date, text: `剩余 ${days} 天`, className: '' }
}
</script>

<style scoped>
.monitor-page { min-height: calc(100vh - 56px); }
.monitor-card { border-radius: var(--radius-lg); overflow: hidden; }
.monitor-card :deep(.el-card__body) { padding: 20px; }

.monitor-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 16px; margin-bottom: 16px;
}
.page-title { color: var(--text-primary); font-size: 18px; font-weight: 700; }
.page-desc { margin-top: 6px; color: var(--text-muted); font-size: 13px; }
.monitor-state {
  display: inline-flex; align-items: center; gap: 7px;
  color: var(--text-muted); font-size: 13px; white-space: nowrap;
}
.monitor-state em { color: var(--text-muted); font-style: normal; margin-left: 4px; }
.state-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-muted); }
.state-dot.online { background: #16a34a; box-shadow: 0 0 8px rgba(22,163,74,0.45); }

.summary-row {
  display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr));
  gap: 12px; margin-bottom: 14px;
}
.summary-item {
  padding: 12px 14px; border: 1px solid var(--border-color);
  border-radius: var(--radius-sm); background: var(--surface-subtle);
}
.summary-item span { display: block; color: var(--text-muted); font-size: 12px; }
.summary-item strong { display: block; margin-top: 4px; color: var(--text-primary); font-size: 24px; line-height: 1; }
.summary-item.success strong { color: #16a34a; }
.summary-item.muted strong { color: var(--text-muted); }
.summary-item.danger strong { color: #ef4444; }

.filter-bar {
  display: grid; gap: 10px; padding: 12px; margin-bottom: 14px;
  grid-template-columns: minmax(140px,180px) minmax(220px,1fr) minmax(130px,160px) minmax(140px,170px);
  border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--surface-subtle);
}
.filter-bar :deep(.el-select), .filter-bar :deep(.el-input) { width: 100%; }

.monitor-alert { margin-bottom: 14px; }
.empty-state {
  padding: 64px 0; color: var(--text-muted); text-align: center;
  border: 1px dashed var(--border-strong); border-radius: var(--radius-sm); background: var(--surface-subtle);
}

/* ═══ KPanel 风格卡片 ═══ */
.server-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 16px;
}

.mc-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border-color);
  border-left: 3px solid #0891b2;
  border-radius: var(--radius-md);
  box-shadow: var(--card-shadow);
  transition: box-shadow var(--transition-normal), transform var(--transition-normal);
}
.mc-card:hover { box-shadow: var(--card-shadow-hover); transform: translateY(-2px); }
.mc-card.warning { border-left-color: #f59e0b; }
.mc-card.critical { border-left-color: #ef4444; }
.mc-card.offline { border-left-color: var(--text-muted); opacity: 0.65; }

/* 头部 */
.mc-head {
  padding: 16px;
  border-bottom: 1px solid var(--border-color);
}
.mc-title-row {
  display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
}
.mc-title-row strong {
  font-size: 15px; font-weight: 650; color: var(--text-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mc-tag {
  flex-shrink: 0; padding: 2px 8px;
  background: var(--primary-bg); color: var(--primary-color);
  border-radius: 999px; font-size: 10px; font-weight: 700;
}
.mc-status {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700;
  background: var(--surface-subtle); color: var(--text-muted);
}
.mc-status i { width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); }
.mc-status.online { background: #dcfce7; color: #16a34a; }
.mc-status.online i { background: #16a34a; }
.mc-status.offline { background: var(--color-danger-soft); color: var(--color-danger); }
.mc-status.offline i { background: var(--color-danger); }
.mc-host {
  color: var(--text-muted); font-size: 12px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* 指标三列 */
.mc-metrics {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px;
  background: var(--border-color); border-bottom: 1px solid var(--border-color);
}
.mc-metric {
  display: flex; flex-direction: column; gap: 5px; padding: 12px;
  background: var(--surface);
}
.mc-metric span {
  color: var(--text-muted); font-size: 10px; font-weight: 600; text-transform: uppercase;
}
.mc-metric strong { font-size: 18px; font-weight: 700; color: var(--text-primary); }
.mc-metric strong.high { color: #ef4444; }
.mc-metric strong.warn { color: #f59e0b; }
.mc-metric small { color: var(--text-muted); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-bar {
  height: 3px; background: var(--border-color); border-radius: 99px; overflow: hidden;
}
.mc-bar > div { height: 100%; border-radius: inherit; transition: width 0.3s ease; }

/* 详情网格 */
.mc-details {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 12px;
  padding: 14px 16px; border-bottom: 1px solid var(--border-color);
}
.mc-details > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mc-details span { color: var(--text-muted); font-size: 10px; font-weight: 600; }
.mc-details strong {
  font-size: 12px; color: var(--text-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* 系统信息 */
.mc-sysinfo {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 12px;
  padding: 12px 16px; border-bottom: 1px solid var(--border-color);
}
.mc-sysinfo > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mc-sysinfo span { color: var(--text-muted); font-size: 10px; font-weight: 600; }
.mc-sysinfo strong {
  font-size: 12px; color: var(--text-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* 公网信息 */
.mc-public {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 12px;
  padding: 12px 16px; border-bottom: 1px solid var(--border-color);
}
.mc-public > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mc-public span { color: var(--text-muted); font-size: 10px; font-weight: 600; }
.mc-public strong {
  font-size: 12px; color: var(--primary-color);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.mc-wide { grid-column: 1 / -1; }

/* 底部 */
.mc-footer {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; padding: 10px 16px; margin-top: auto;
}
.mc-footer > span { color: var(--text-muted); font-size: 11px; }
.mc-expiry {
  padding: 3px 8px; border-radius: var(--radius-sm); font-size: 11px; font-weight: 600;
  background: var(--surface-subtle); color: var(--text-muted);
}
.mc-expiry.expiring { background: #fff3dc; color: #c47a16; }
.mc-expiry.expired { background: var(--color-danger-soft); color: var(--color-danger); }

@media (max-width: 900px) {
  .monitor-header { flex-direction: column; }
  .summary-row, .filter-bar { grid-template-columns: 1fr; }
  .server-grid { grid-template-columns: 1fr; }
}
</style>
