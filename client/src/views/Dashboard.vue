<template>
  <div class="page-container">
    <div class="stat-cards">
      <el-row :gutter="16">
        <el-col :xs="24" :sm="12" :lg="6" v-for="item in statCards" :key="item.label" style="margin-bottom:16px">
          <div class="stat-card" :style="{ '--accent': item.color, '--tint': item.tint }">
            <div class="stat-card-content">
              <div class="stat-info">
                <div class="stat-label">{{ item.label }}</div>
                <div class="stat-value">{{ item.value }}</div>
              </div>
              <div class="stat-icon" :style="{ color: item.color }">
                <el-icon :size="28"><component :is="item.icon" /></el-icon>
              </div>
            </div>
          </div>
        </el-col>
      </el-row>
    </div>

    <div class="dashboard-live">
      <div class="live-main">
        <!-- 实时监控面板（哪吒风格服务器卡片网格） -->
        <div class="monitor-section">
          <div class="monitor-header">
            <div class="monitor-heading">
              <span class="monitor-title">
                <el-icon><DataLine /></el-icon>
                实时监控
              </span>
            </div>
            <div class="monitor-tools">
              <el-select v-model="monitorGroup" size="small" style="width:130px" placeholder="全部分组">
                <el-option label="全部分组" value="all" />
                <el-option v-for="g in monitorGroups" :key="g.id" :label="g.name" :value="g.id" />
              </el-select>
              <el-input v-model="monitorSearch" placeholder="搜索服务器" clearable size="small" style="width:180px" />
              <el-select v-model="monitorSort" size="small" style="width:130px">
                <el-option label="默认排序" value="default" />
                <el-option label="CPU 高→低" value="cpu" />
                <el-option label="内存 高→低" value="mem" />
                <el-option label="磁盘 高→低" value="disk" />
              </el-select>
            </div>
          </div>

          <div v-if="offlineCount > 0" class="monitor-collapse-bar">
            <span>{{ offlineBarText }}</span>
            <el-link type="primary" underline="never" @click="collapseOffline = !collapseOffline">
              {{ collapseOffline ? '展开' : '收起' }}
            </el-link>
          </div>

          <div v-if="monitorLoaded && monitorServers.length === 0" class="monitor-empty">
            暂无服务器，去<el-link type="primary" underline="never" @click="router.push('/servers')">添加服务器</el-link>
          </div>
          <div v-else class="monitor-grid">
            <div
              v-for="s in filteredServers"
              :key="s.id"
              class="server-card"
              :class="cardHealth(s).className"
              :style="{ '--health-color': cardHealth(s).color }"
              @click="openMonitor(s)"
            >
              <div class="sc-head">
                <span class="sc-name" :title="s.name">{{ s.name }}</span>
                <span class="sc-status" :class="s.status">
                  <i class="status-dot"></i>{{ statusText(s.status) }}
                </span>
              </div>
              <div class="sc-meta">
                <span class="sc-os" :title="s.os_info">{{ s.os_info || '-' }}</span>
                <span v-if="s.group_name" class="sc-tag">{{ s.group_name }}</span>
              </div>

              <div class="sc-bar-row">
                <div class="sc-bar-label"><span>CPU</span><span>{{ pct(s.cpu_usage) }}%</span></div>
                <div class="sc-bar"><div class="sc-bar-fill" :style="{ width: pct(s.cpu_usage) + '%', background: usageColor(s.cpu_usage) }"></div></div>
              </div>
              <div class="sc-bar-row">
                <div class="sc-bar-label">
                  <span>内存</span>
                  <span>{{ pct(s.memory_usage) }}% <em>{{ mb(s.mem_used_mb) }} / {{ mb(s.mem_total_mb) }}</em></span>
                </div>
                <div class="sc-bar"><div class="sc-bar-fill" :style="{ width: pct(s.memory_usage) + '%', background: usageColor(s.memory_usage) }"></div></div>
              </div>
              <div class="sc-bar-row">
                <div class="sc-bar-label">
                  <span>磁盘</span>
                  <span>{{ pct(s.disk_usage) }}% <em>{{ mb(s.disk_used_mb) }} / {{ mb(s.disk_total_mb) }}</em></span>
                </div>
                <div class="sc-bar"><div class="sc-bar-fill" :style="{ width: pct(s.disk_usage) + '%', background: usageColor(s.disk_usage) }"></div></div>
              </div>

              <div class="sc-footer">
                <span :title="'负载 ' + (s.load_avg || '-')">负载 {{ s.load_avg || '-' }}</span>
                <span :title="s.uptime || ''">{{ s.uptime || '-' }}</span>
              </div>
              <div class="sc-network">
                <span>↓ {{ bytes(s.network_rx_bytes) }}</span>
                <span>↑ {{ bytes(s.network_tx_bytes) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <aside class="live-side">
        <el-card shadow="never" class="side-card">
          <template #header><span class="card-title">最近告警</span></template>
          <div v-if="!recentAlerts.length" class="side-empty">暂无告警</div>
          <div v-for="item in recentAlerts.slice(0, 5)" :key="`${item.server_name}-${item.created_at}`" class="side-item">
            <div class="side-item-main">
              <span class="side-title" :title="item.title">{{ item.title }}</span>
              <el-tag :type="item.level==='critical'?'danger':item.level==='warning'?'warning':'info'" size="small" effect="plain">{{ item.level }}</el-tag>
            </div>
            <div class="side-meta">{{ item.server_name || '-' }} · {{ item.created_at || '-' }}</div>
          </div>
        </el-card>

        <el-card shadow="never" class="side-card">
          <template #header><span class="card-title">最近命令</span></template>
          <div v-if="!recentCommands.length" class="side-empty">暂无执行记录</div>
          <div v-for="item in recentCommands.slice(0, 5)" :key="`${item.server_name}-${item.command}-${item.duration_ms}`" class="side-item">
            <div class="side-item-main">
              <span class="side-title" :title="item.command">{{ item.command }}</span>
              <el-tag :type="item.status==='success'?'success':'danger'" size="small" effect="plain">{{ item.status==='success'?'成功':'失败' }}</el-tag>
            </div>
            <div class="side-meta">{{ item.server_name || '-' }} · {{ item.duration_ms ? (item.duration_ms/1000).toFixed(1)+'s' : '-' }}</div>
          </div>
        </el-card>
      </aside>
    </div>

    <el-row :gutter="16" style="margin-top:16px">
      <el-col :xs="24" :lg="8">
        <el-card shadow="hover">
          <template #header><span class="card-title">服务器状态</span></template>
          <div ref="pieChartRef" style="height:280px"></div>
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="16">
        <el-card shadow="hover">
          <template #header><span class="card-title">近7天命令执行统计</span></template>
          <div ref="barChartRef" style="height:280px"></div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { io } from 'socket.io-client'
import api from '../api'
import * as echarts from 'echarts'

const router = useRouter()

const recentCommands = ref([])
const recentAlerts = ref([])
const pieChartRef = ref(null)
const barChartRef = ref(null)

const statCards = ref([
  { label: '服务器总数', value: 0, icon: 'Server', color: '#4f6ef7', tint: '#eef2ff' },
  { label: '在线服务器', value: 0, icon: 'CircleCheck', color: '#22c55e', tint: '#ecfdf5' },
  { label: '离线服务器', value: 0, icon: 'CircleClose', color: '#ef4444', tint: '#fef2f2' },
  { label: '告警数量', value: 0, icon: 'Bell', color: '#f59e0b', tint: '#fffbeb' },
])

// ──── 实时监控面板 ────
const monitorServers = ref([])
const monitorLoaded = ref(false)
const monitorSearch = ref('')
const monitorSort = ref('default')
const monitorGroup = ref('all')
const collapseOffline = ref(true)
let monitorSocket = null

const onlineCount = computed(() => monitorServers.value.filter(s => s.status === 'online').length)

// 当前可选分组（从快照里动态提取）
const monitorGroups = computed(() => {
  const map = new Map()
  monitorServers.value.forEach(s => {
    if (s.group_id && s.group_name && !map.has(s.group_id)) {
      map.set(s.group_id, { id: s.group_id, name: s.group_name })
    }
  })
  return [...map.values()]
})

// 分组 + 搜索过滤（折叠离线前）
const baseFiltered = computed(() => {
  let list = monitorServers.value
  if (monitorGroup.value !== 'all') {
    const gid = Number(monitorGroup.value)
    list = list.filter(s => Number(s.group_id) === gid)
  }
  const kw = monitorSearch.value.trim().toLowerCase()
  if (kw) {
    list = list.filter(s =>
      String(s.name || '').toLowerCase().includes(kw) ||
      String(s.host || '').toLowerCase().includes(kw)
    )
  }
  return list
})

const offlineCount = computed(() => baseFiltered.value.filter(s => s.status !== 'online').length)
const offlineBarText = computed(() => collapseOffline.value
  ? `已折叠 ${offlineCount.value} 台离线服务器`
  : `当前显示全部（含 ${offlineCount.value} 台离线）`)

const filteredServers = computed(() => {
  const list = collapseOffline.value
    ? baseFiltered.value.filter(s => s.status === 'online')
    : baseFiltered.value
  const sorted = [...list]
  if (monitorSort.value === 'cpu') sorted.sort((a, b) => num(b.cpu_usage) - num(a.cpu_usage))
  else if (monitorSort.value === 'mem') sorted.sort((a, b) => num(b.memory_usage) - num(a.memory_usage))
  else if (monitorSort.value === 'disk') sorted.sort((a, b) => num(b.disk_usage) - num(a.disk_usage))
  return sorted
})

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function pct(v) {
  const n = num(v)
  if (n <= 0) return 0
  return Math.min(100, Math.round(n * 10) / 10)
}
function cardHealth(s) {
  if (s.status !== 'online') {
    return { level: 'offline', color: '#94a3b8', className: 'offline' }
  }
  if (num(s.cpu_usage) >= 90 || num(s.memory_usage) >= 90 || num(s.disk_usage) >= 90) {
    return { level: 'critical', color: '#ef4444', className: 'critical' }
  }
  if (num(s.cpu_usage) >= 70 || num(s.memory_usage) >= 70 || num(s.disk_usage) >= 70) {
    return { level: 'warning', color: '#f59e0b', className: 'warning' }
  }
  return { level: 'normal', color: '#22c55e', className: 'normal' }
}
function usageColor(v) {
  const n = num(v)
  if (n >= 90) return '#ef4444'
  if (n >= 70) return '#f59e0b'
  return '#22c55e'
}
function mb(v) {
  const n = num(v)
  if (n <= 0) return '-'
  if (n >= 1024) return (n / 1024).toFixed(1) + ' GB'
  return n + ' MB'
}
function bytes(v) {
  let n = num(v)
  if (n <= 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}
function statusText(status) {
  return status === 'online' ? '在线' : status === 'offline' ? '离线' : '未知'
}
function openMonitor(s) {
  router.push({ path: '/monitor', query: { id: s.id } })
}

function connectMonitor() {
  const token = localStorage.getItem('token')
  if (!token) return
  monitorSocket = io('/monitor', { auth: { token }, transports: ['websocket'] })
  monitorSocket.on('snapshot', (list) => {
    monitorServers.value = list || []
    monitorLoaded.value = true
  })
  monitorSocket.on('connect_error', () => { monitorLoaded.value = true })
}
function disconnectMonitor() {
  try { monitorSocket?.disconnect() } catch {}
  monitorSocket = null
}

onMounted(async () => {
  connectMonitor()

  const res = await api.get('/api/dashboard')
  if (res.code === 0) {
    const d = res.data
    statCards.value[0].value = d.server_total
    statCards.value[1].value = d.server_online
    statCards.value[2].value = d.server_offline
    statCards.value[3].value = d.alert_active
    recentCommands.value = d.recent_commands
    recentAlerts.value = d.recent_alerts

    await nextTick()
    renderPieChart(d)
    renderBarChart(d.exec_stats)
  }
})

onBeforeUnmount(() => {
  disconnectMonitor()
})

function renderPieChart(data) {
  const chart = echarts.init(pieChartRef.value)
  chart.setOption({
    tooltip: { trigger: 'item', backgroundColor: '#fff', borderColor: '#e8ecf4', borderWidth: 1, textStyle: { color: '#1e293b' } },
    legend: { bottom: 0, textStyle: { color: '#64748b' } },
    series: [{
      type: 'pie', radius: ['45%', '72%'],
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 3 },
      label: { formatter: '{b}: {c}', color: '#64748b' },
      data: [
        { value: data.server_online, name: '在线', itemStyle: { color: '#22c55e' } },
        { value: data.server_offline, name: '离线', itemStyle: { color: '#ef4444' } },
        { value: data.server_total - data.server_online - data.server_offline, name: '未知', itemStyle: { color: '#94a3b8' } }
      ]
    }]
  })
  window.addEventListener('resize', () => chart.resize())
}

function renderBarChart(stats) {
  const chart = echarts.init(barChartRef.value)
  chart.setOption({
    tooltip: { trigger: 'axis', backgroundColor: '#fff', borderColor: '#e8ecf4', borderWidth: 1, textStyle: { color: '#1e293b' } },
    legend: { data: ['成功', '失败'], textStyle: { color: '#64748b' } },
    grid: { left: 40, right: 20, bottom: 40, top: 30 },
    xAxis: { type: 'category', data: stats.map(s => s.date), axisLine: { lineStyle: { color: '#e8ecf4' } }, axisLabel: { color: '#94a3b8' } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#f4f6fb' } }, axisLabel: { color: '#94a3b8' } },
    series: [
      { name: '成功', type: 'bar', stack: 'total', data: stats.map(s => s.success_count), itemStyle: { color: '#22c55e', borderRadius: [0, 0, 0, 0] }, barWidth: 20 },
      { name: '失败', type: 'bar', stack: 'total', data: stats.map(s => s.failed_count), itemStyle: { color: '#ef4444', borderRadius: [4, 4, 0, 0] } }
    ]
  })
  window.addEventListener('resize', () => chart.resize())
}
</script>

<style scoped>
.stat-cards { margin-bottom: 0; }
.stat-card {
  border-radius: 10px;
  padding: 18px 20px;
  color: #1e293b;
  background: #fff;
  border: 1px solid #e8ecf4;
  border-left: 4px solid var(--accent);
  position: relative;
  overflow: hidden;
  transition: transform 0.2s, box-shadow 0.2s;
  cursor: default;
}
.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.08);
}
.stat-card::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent 0%, var(--tint) 100%);
  opacity: 0.7;
  pointer-events: none;
}
.stat-card-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: relative;
  z-index: 1;
}
.stat-label { font-size: 13px; color: #64748b; font-weight: 500; }
.stat-value { font-size: 30px; font-weight: 700; margin-top: 6px; line-height: 1; }
.stat-icon {
  width: 42px;
  height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: var(--tint);
}
.card-title { font-weight: 600; color: #1e293b; font-size: 15px; }

.dashboard-live {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 16px;
}
.live-main { min-width: 0; }
.live-side {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.side-card {
  border-radius: 10px !important;
}
.side-card :deep(.el-card__header) {
  padding: 14px 16px;
}
.side-card :deep(.el-card__body) {
  padding: 6px 14px 12px;
}
.side-item {
  padding: 10px 0;
  border-bottom: 1px solid #f0f2f7;
}
.side-item:last-child { border-bottom: 0; }
.side-item-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.side-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: #1e293b;
  font-weight: 500;
}
.side-meta {
  margin-top: 5px;
  color: #94a3b8;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.side-empty {
  padding: 24px 0;
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
}

/* 实时监控面板 */
.monitor-section {
  background: #fff;
  border-radius: 10px;
  border: 1px solid #e8ecf4;
  padding: 16px;
}
.monitor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin: -16px -16px 14px;
  padding: 14px 16px;
  position: sticky;
  top: 0;
  z-index: 3;
  background: rgba(255,255,255,0.96);
  border-bottom: 1px solid #eef2f7;
  border-radius: 10px 10px 0 0;
  backdrop-filter: blur(8px);
}
.monitor-heading {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.monitor-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
}
.monitor-tools { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.monitor-collapse-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 6px 0 12px;
  font-size: 12px;
  color: #94a3b8;
}
.monitor-empty {
  text-align: center;
  color: #94a3b8;
  padding: 40px 0;
  font-size: 14px;
}

.monitor-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}
.server-card {
  background: #f8fafc;
  border: 1px solid #e8ecf4;
  border-left: 4px solid var(--health-color);
  border-radius: 12px;
  padding: 14px 14px 14px 12px;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
}
.server-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
  border-color: #c7d2fe;
  border-left-color: var(--health-color);
}
.server-card.normal { background: #f8fafc; }
.server-card.warning { background: #fffaf0; border-color: #fde68a; border-left-color: var(--health-color); }
.server-card.critical { background: #fff7f7; border-color: #fecaca; border-left-color: var(--health-color); }
.server-card.offline {
  opacity: 0.72;
  background: #f1f5f9;
  border-color: #e2e8f0;
  border-left-color: var(--health-color);
}

.sc-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.sc-name {
  font-weight: 600;
  font-size: 14px;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 60%;
}
.sc-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #64748b;
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}
.status-dot.online { background: #22c55e; box-shadow: 0 0 6px rgba(34,197,94,0.5); animation: pulse 2s infinite; }
.status-dot.offline { background: #ef4444; }
.sc-status.unknown .status-dot,
.status-dot.unknown { background: #94a3b8; }
.sc-status.online { color: #16a34a; }
.sc-status.offline { color: #ef4444; }
.sc-status.unknown { color: #94a3b8; }
.sc-status.unknown .status-dot { background: #94a3b8; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

.sc-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  min-height: 18px;
}
.sc-os {
  font-size: 12px;
  color: #94a3b8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sc-tag {
  flex-shrink: 0;
  font-size: 11px;
  color: #4f6ef7;
  background: #eef2ff;
  padding: 1px 8px;
  border-radius: 10px;
}

.sc-bar-row { margin-bottom: 8px; }
.sc-bar-label {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #64748b;
  margin-bottom: 4px;
}
.sc-bar-label em {
  font-style: normal;
  color: #94a3b8;
  margin-left: 4px;
}
.sc-bar {
  height: 6px;
  background: #e8ecf4;
  border-radius: 4px;
  overflow: hidden;
}
.sc-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.5s ease, background 0.3s ease;
}

.sc-footer {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #e8ecf4;
  font-size: 11px;
  color: #94a3b8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sc-network {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
  font-size: 11px;
  color: #06b6d4;
}

@media (max-width: 1200px) {
  .dashboard-live { grid-template-columns: 1fr; }
  .live-side { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 768px) {
  .live-side { grid-template-columns: 1fr; }
  .monitor-header { position: static; }
  .monitor-tools { width: 100%; }
  .monitor-tools .el-select,
  .monitor-tools .el-input { width: 100% !important; }
}
</style>
