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
        <div
          v-for="server in filteredServers"
          :key="server.id"
          class="server-card"
          :class="cardHealth(server).className"
          :style="{ '--health-color': cardHealth(server).color }"
        >
          <div class="server-head">
            <div class="server-title">
              <strong :title="server.name">{{ server.name }}</strong>
              <span v-if="server.group_name">{{ server.group_name }}</span>
            </div>
            <div class="server-status" :class="server.status">
              <i></i>{{ statusText(server.status) }}
            </div>
          </div>

          <div class="server-meta">
            <span :title="server.host">{{ server.host || '-' }}</span>
            <span :title="server.os_info">{{ server.os_info || '-' }}</span>
          </div>

          <div class="metric-row">
            <div class="metric-label"><span>CPU</span><strong>{{ pct(server.cpu_usage) }}%</strong></div>
            <div class="metric-bar"><div :style="{ width: pct(server.cpu_usage) + '%', background: usageColor(server.cpu_usage) }"></div></div>
          </div>
          <div class="metric-row">
            <div class="metric-label">
              <span>内存</span>
              <strong>{{ pct(server.memory_usage) }}% <em>{{ mb(server.mem_used_mb) }} / {{ mb(server.mem_total_mb) }}</em></strong>
            </div>
            <div class="metric-bar"><div :style="{ width: pct(server.memory_usage) + '%', background: usageColor(server.memory_usage) }"></div></div>
          </div>
          <div class="metric-row">
            <div class="metric-label">
              <span>磁盘</span>
              <strong>{{ pct(server.disk_usage) }}% <em>{{ mb(server.disk_used_mb) }} / {{ mb(server.disk_total_mb) }}</em></strong>
            </div>
            <div class="metric-bar"><div :style="{ width: pct(server.disk_usage) + '%', background: usageColor(server.disk_usage) }"></div></div>
          </div>

          <div class="server-foot">
            <span>负载 {{ server.load_avg || '-' }}</span>
            <span :title="server.uptime || ''">{{ server.uptime || '-' }}</span>
          </div>

          <!-- 系统信息 -->
          <div class="info-grid" v-if="server._sys && Object.keys(server._sys).length">
            <div class="info-cell"><span>内核</span><strong :title="server._sys.kernel">{{ server._sys.kernel || '-' }}</strong></div>
            <div class="info-cell"><span>架构</span><strong>{{ server._sys.arch || '-' }}</strong></div>
            <div class="info-cell"><span>CPU</span><strong>{{ server._sys.cpu_cores || '?' }}核</strong></div>
            <div class="info-cell"><span>拥塞</span><strong>{{ server._sys.tcp_congestion || '-' }}</strong></div>
            <div class="info-cell full" v-if="server._sys.cpu_model"><span>型号</span><strong :title="server._sys.cpu_model">{{ server._sys.cpu_model }}</strong></div>
          </div>

          <div class="network-row">
            <span>下行 {{ bytes(server.network_rx_bytes) }}</span>
            <span>上行 {{ bytes(server.network_tx_bytes) }}</span>
          </div>
          <div class="network-row">
            <span>TCP {{ server.tcp_connections ?? '-' }}</span>
            <span>UDP {{ server.udp_connections ?? '-' }}</span>
          </div>

          <!-- 公网信息（内部页才显示） -->
          <div class="info-grid public-grid" v-if="hasPublicInfo(server._sys)">
            <div class="info-cell" v-if="server._sys.public_ipv4"><span>IPv4</span><strong>{{ server._sys.public_ipv4 }}</strong></div>
            <div class="info-cell" v-if="server._sys.public_ipv6"><span>IPv6</span><strong :title="server._sys.public_ipv6">{{ server._sys.public_ipv6 }}</strong></div>
            <div class="info-cell" v-if="server._sys.geo_location"><span>位置</span><strong>{{ server._sys.geo_location }}</strong></div>
            <div class="info-cell" v-if="server._sys.isp"><span>运营商</span><strong>{{ server._sys.isp }}</strong></div>
            <div class="info-cell full" v-if="server._sys.dns_servers"><span>DNS</span><strong :title="server._sys.dns_servers">{{ server._sys.dns_servers }}</strong></div>
          </div>

          <div class="fresh-row">最后连接 {{ formatTime(server.last_connected_at) }}</div>
          <div class="expiry-row" v-if="server._expiry" :class="server._expiry.className">
            <span>到期 {{ server._expiry.date }}</span>
            <strong>{{ server._expiry.text }}</strong>
          </div>
        </div>
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
  socket.on('snapshot', (list) => {
    servers.value = (list || []).map(s => {
      let info = s.system_info
      if (typeof info === 'string') { try { info = JSON.parse(info) } catch { info = {} } }
      s._sys = info || {}
      s._expiry = expiryDisplay(s.expires_at)
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
.monitor-page {
  min-height: calc(100vh - 56px);
}

.monitor-card {
  border-radius: 10px;
  border: 1px solid #e5eaf3;
  overflow: hidden;
}

.monitor-card :deep(.el-card__body) {
  padding: 20px;
}

.monitor-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.page-title {
  color: #111827;
  font-size: 18px;
  font-weight: 700;
}

.page-desc {
  margin-top: 6px;
  color: #64748b;
  font-size: 13px;
}

.monitor-state {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #64748b;
  font-size: 13px;
  white-space: nowrap;
}

.monitor-state em {
  color: #94a3b8;
  font-style: normal;
}

.state-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #94a3b8;
}

.state-dot.online {
  background: #22c55e;
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.45);
}

.summary-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(120px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

.summary-item {
  padding: 12px 14px;
  border: 1px solid #e6edf5;
  border-radius: 8px;
  background: #f8fafc;
}

.summary-item span {
  display: block;
  color: #64748b;
  font-size: 12px;
}

.summary-item strong {
  display: block;
  margin-top: 4px;
  color: #111827;
  font-size: 24px;
  line-height: 1;
}

.summary-item.success strong { color: #16a34a; }
.summary-item.muted strong { color: #64748b; }
.summary-item.danger strong { color: #dc2626; }

.filter-bar {
  display: grid;
  grid-template-columns: minmax(140px, 180px) minmax(220px, 1fr) minmax(130px, 160px) minmax(140px, 170px);
  gap: 10px;
  padding: 12px;
  margin-bottom: 14px;
  border: 1px solid #e6edf5;
  border-radius: 8px;
  background: #f8fafc;
}

.filter-bar :deep(.el-select),
.filter-bar :deep(.el-input) {
  width: 100%;
}

.monitor-alert {
  margin-bottom: 14px;
}

.empty-state {
  padding: 64px 0;
  color: #94a3b8;
  text-align: center;
  border: 1px dashed #dbe5ef;
  border-radius: 8px;
  background: #f8fafc;
}

.server-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.server-card {
  padding: 14px;
  border: 1px solid #e6edf5;
  border-left: 4px solid var(--health-color);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
}

.server-card.warning {
  background: #fffaf0;
  border-color: #fde68a;
}

.server-card.critical {
  background: #fff7f7;
  border-color: #fecaca;
}

.server-card.offline {
  opacity: 0.72;
  background: #f1f5f9;
  border-color: #e2e8f0;
}

.server-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.server-title {
  min-width: 0;
}

.server-title strong {
  display: block;
  overflow: hidden;
  color: #111827;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-title span {
  display: inline-block;
  margin-top: 4px;
  padding: 1px 8px;
  border-radius: 999px;
  color: #4f6ef7;
  background: #eef4ff;
  font-size: 12px;
}

.server-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #64748b;
  font-size: 12px;
  white-space: nowrap;
}

.server-status i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #94a3b8;
}

.server-status.online { color: #16a34a; }
.server-status.online i { background: #22c55e; }
.server-status.offline { color: #ef4444; }
.server-status.offline i { background: #ef4444; }

.server-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 10px 0 12px;
  color: #94a3b8;
  font-size: 12px;
}

.server-meta span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric-row {
  margin-bottom: 9px;
}

.metric-label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
  color: #64748b;
  font-size: 12px;
}

.metric-label strong {
  color: #334155;
  font-weight: 600;
}

.metric-label em {
  margin-left: 4px;
  color: #94a3b8;
  font-style: normal;
  font-weight: 400;
}

.metric-bar {
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: #e8ecf4;
}

.metric-bar div {
  height: 100%;
  border-radius: inherit;
  transition: width 0.4s ease;
}

.server-foot,
.network-row,
.fresh-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: #94a3b8;
  font-size: 11px;
}

.server-foot {
  padding-top: 8px;
  margin-top: 8px;
  border-top: 1px dashed #e6edf5;
}

.network-row {
  margin-top: 6px;
  color: #0891b2;
}

.fresh-row {
  margin-top: 6px;
  display: block;
}

.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 10px;
  padding: 8px 0 4px;
  margin-top: 4px;
  border-top: 1px dashed #e6edf5;
}

.info-cell {
  display: flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
  font-size: 11px;
}

.info-cell span {
  flex-shrink: 0;
  color: #94a3b8;
}

.info-cell strong {
  min-width: 0;
  overflow: hidden;
  color: #334155;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.info-cell.full {
  grid-column: 1 / -1;
}

.public-grid .info-cell strong {
  color: #4f6ef7;
}

.expiry-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 11px;
  background: #f1f5f9;
  color: #64748b;
}

.expiry-row strong {
  font-weight: 600;
}

.expiry-row.expiring {
  background: #fffbeb;
  color: #b45309;
}

.expiry-row.expired {
  background: #fef2f2;
  color: #dc2626;
}

@media (max-width: 900px) {
  .monitor-header {
    flex-direction: column;
  }

  .summary-row,
  .filter-bar {
    grid-template-columns: 1fr;
  }

  .server-grid {
    grid-template-columns: 1fr;
  }
}
</style>
