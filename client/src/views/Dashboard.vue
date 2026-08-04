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
            <article
              v-for="s in filteredServers"
              :key="s.id"
              class="mc-card"
              :class="cardHealth(s).className"
              @click="openMonitor(s)"
            >
              <header class="mc-head">
                <div class="mc-title-row">
                  <strong :title="s.name">{{ s.name }}</strong>
                  <span v-if="s.group_name" class="mc-tag">{{ s.group_name }}</span>
                  <span class="mc-status" :class="s.status"><i></i>{{ statusText(s.status) }}</span>
                </div>
                <div class="mc-host">{{ s.os_info || '-' }}</div>
              </header>
              <div class="mc-metrics">
                <div class="mc-metric">
                  <span>CPU</span>
                  <strong :class="pct(s.cpu_usage) >= 90 ? 'high' : pct(s.cpu_usage) >= 70 ? 'warn' : ''">{{ pct(s.cpu_usage) }}%</strong>
                  <div class="mc-bar"><div :style="{ width: pct(s.cpu_usage) + '%', background: usageColor(s.cpu_usage) }"></div></div>
                  <small>{{ pct(s.cpu_usage) }}%</small>
                </div>
                <div class="mc-metric">
                  <span>内存</span>
                  <strong :class="pct(s.memory_usage) >= 90 ? 'high' : pct(s.memory_usage) >= 70 ? 'warn' : ''">{{ pct(s.memory_usage) }}%</strong>
                  <div class="mc-bar"><div :style="{ width: pct(s.memory_usage) + '%', background: usageColor(s.memory_usage) }"></div></div>
                  <small>{{ mb(s.mem_used_mb) }} / {{ mb(s.mem_total_mb) }}</small>
                </div>
                <div class="mc-metric">
                  <span>磁盘</span>
                  <strong :class="pct(s.disk_usage) >= 90 ? 'high' : pct(s.disk_usage) >= 70 ? 'warn' : ''">{{ pct(s.disk_usage) }}%</strong>
                  <div class="mc-bar"><div :style="{ width: pct(s.disk_usage) + '%', background: usageColor(s.disk_usage) }"></div></div>
                  <small>{{ mb(s.disk_used_mb) }} / {{ mb(s.disk_total_mb) }}</small>
                </div>
              </div>
              <div class="mc-details">
                <div><span>负载</span><strong>{{ s.load_avg || '-' }}</strong></div>
                <div><span>运行</span><strong :title="s.uptime || ''">{{ s.uptime || '-' }}</strong></div>
                <div><span>下行</span><strong>{{ bytes(s.network_rx_bytes) }}</strong></div>
                <div><span>上行</span><strong>{{ bytes(s.network_tx_bytes) }}</strong></div>
              </div>
            </article>
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
  { label: '服务器总数', value: 0, icon: 'Server', color: '#0891b2', tint: '#eef2ff' },
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
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
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
  cursor: pointer;
  transition: box-shadow var(--transition-normal), transform var(--transition-normal);
}
.mc-card:hover { box-shadow: var(--card-shadow-hover); transform: translateY(-2px); }
.mc-card.normal { border-left-color: #0891b2; }
.mc-card.warning { border-left-color: #f59e0b; }
.mc-card.critical { border-left-color: #ef4444; }
.mc-card.offline { border-left-color: var(--text-muted); opacity: 0.65; }

.mc-head { padding: 14px 16px; border-bottom: 1px solid var(--border-color); }
.mc-title-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.mc-title-row strong { font-size: 14px; font-weight: 650; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-tag { flex-shrink: 0; padding: 2px 8px; background: var(--primary-bg); color: var(--primary-color); border-radius: 999px; font-size: 10px; font-weight: 700; }
.mc-status { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; background: var(--surface-subtle); color: var(--text-muted); }
.mc-status i { width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); }
.mc-status.online { background: #dcfce7; color: #16a34a; }
.mc-status.online i { background: #16a34a; }
.mc-status.offline { background: var(--color-danger-soft); color: var(--color-danger); }
.mc-status.offline i { background: var(--color-danger); }
.mc-host { color: var(--text-muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.mc-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--border-color); border-bottom: 1px solid var(--border-color); }
.mc-metric { display: flex; flex-direction: column; gap: 5px; padding: 12px; background: var(--surface); }
.mc-metric span { color: var(--text-muted); font-size: 10px; font-weight: 600; text-transform: uppercase; }
.mc-metric strong { font-size: 18px; font-weight: 700; color: var(--text-primary); }
.mc-metric strong.high { color: #ef4444; }
.mc-metric strong.warn { color: #f59e0b; }
.mc-metric small { color: var(--text-muted); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-bar { height: 3px; background: var(--border-color); border-radius: 99px; overflow: hidden; }
.mc-bar > div { height: 100%; border-radius: inherit; transition: width 0.3s ease; }

.mc-details { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 12px; padding: 12px 16px; }
.mc-details > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mc-details span { color: var(--text-muted); font-size: 10px; font-weight: 600; }
.mc-details strong { font-size: 12px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

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
