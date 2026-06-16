<template>
  <div class="page-container">
    <div class="stat-cards">
      <el-row :gutter="16">
        <el-col :span="6" v-for="item in statCards" :key="item.label" style="margin-bottom:16px">
          <div class="stat-card" :style="{ background: item.gradient }">
            <div class="stat-card-content">
              <div class="stat-info">
                <div class="stat-label">{{ item.label }}</div>
                <div class="stat-value">{{ item.value }}</div>
              </div>
              <div class="stat-icon">
                <el-icon :size="28"><component :is="item.icon" /></el-icon>
              </div>
            </div>
          </div>
        </el-col>
      </el-row>
    </div>

    <!-- 实时监控面板（哪吒风格服务器卡片网格） -->
    <div class="monitor-section">
      <div class="monitor-header">
        <span class="monitor-title">
          <el-icon><DataLine /></el-icon>
          实时监控
          <span class="monitor-count">
            <i class="status-dot online"></i>在线 {{ onlineCount }} / {{ monitorServers.length }}
            <span class="monitor-fresh">· 数据随采集刷新</span>
          </span>
        </span>
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
        <el-link type="primary" :underline="false" @click="collapseOffline = !collapseOffline">
          {{ collapseOffline ? '展开' : '收起' }}
        </el-link>
      </div>

      <div v-if="monitorLoaded && monitorServers.length === 0" class="monitor-empty">
        暂无服务器，去<el-link type="primary" :underline="false" @click="router.push('/servers')">添加服务器</el-link>
      </div>
      <div v-else class="monitor-grid">
        <div
          v-for="s in filteredServers"
          :key="s.id"
          class="server-card"
          :class="{ offline: s.status !== 'online' }"
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
        </div>
      </div>
    </div>

    <el-row :gutter="16" style="margin-top:16px">
      <el-col :span="8">
        <el-card shadow="hover">
          <template #header><span class="card-title">服务器状态</span></template>
          <div ref="pieChartRef" style="height:280px"></div>
        </el-card>
      </el-col>
      <el-col :span="16">
        <el-card shadow="hover">
          <template #header><span class="card-title">近7天命令执行统计</span></template>
          <div ref="barChartRef" style="height:280px"></div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" style="margin-top:16px">
      <el-col :span="12">
        <el-card shadow="hover">
          <template #header><span class="card-title">最近执行记录</span></template>
          <el-table :data="recentCommands" size="small" stripe>
            <el-table-column prop="server_name" label="服务器" width="120" />
            <el-table-column prop="command" label="命令" show-overflow-tooltip />
            <el-table-column prop="status" label="状态" width="80">
              <template #default="{ row }">
                <el-tag :type="row.status==='success'?'success':'danger'" size="small" effect="plain">{{ row.status==='success'?'成功':'失败' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="duration_ms" label="耗时" width="80">
              <template #default="{ row }">{{ row.duration_ms ? (row.duration_ms/1000).toFixed(1)+'s' : '-' }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="hover">
          <template #header><span class="card-title">最近告警</span></template>
          <el-table :data="recentAlerts" size="small" stripe>
            <el-table-column prop="server_name" label="服务器" width="120" />
            <el-table-column prop="title" label="告警" show-overflow-tooltip />
            <el-table-column prop="level" label="级别" width="80">
              <template #default="{ row }">
                <el-tag :type="row.level==='critical'?'danger':row.level==='warning'?'warning':'info'" size="small" effect="plain">{{ row.level }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="created_at" label="时间" width="160" />
          </el-table>
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
  { label: '服务器总数', value: 0, icon: 'Server', gradient: 'linear-gradient(135deg, #4f6ef7 0%, #7b93fa 100%)' },
  { label: '在线服务器', value: 0, icon: 'CircleCheck', gradient: 'linear-gradient(135deg, #22c55e 0%, #4ade80 100%)' },
  { label: '离线服务器', value: 0, icon: 'CircleClose', gradient: 'linear-gradient(135deg, #ef4444 0%, #f87171 100%)' },
  { label: '告警数量', value: 0, icon: 'Bell', gradient: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)' },
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
  border-radius: 14px;
  padding: 20px 24px;
  color: #fff;
  position: relative;
  overflow: hidden;
  transition: transform 0.2s, box-shadow 0.2s;
  cursor: default;
}
.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(0,0,0,0.15);
}
.stat-card::after {
  content: '';
  position: absolute;
  top: -30%;
  right: -20%;
  width: 120px;
  height: 120px;
  background: rgba(255,255,255,0.1);
  border-radius: 50%;
}
.stat-card-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: relative;
  z-index: 1;
}
.stat-label { font-size: 13px; opacity: 0.9; font-weight: 500; letter-spacing: 0.5px; }
.stat-value { font-size: 32px; font-weight: 700; margin-top: 6px; line-height: 1; }
.stat-icon { opacity: 0.85; }
.card-title { font-weight: 600; color: #1e293b; font-size: 15px; }

/* 实时监控面板 */
.monitor-section {
  margin-top: 16px;
  background: #fff;
  border-radius: 14px;
  border: 1px solid #e8ecf4;
  padding: 16px;
}
.monitor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.monitor-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
}
.monitor-count {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: #64748b;
}
.monitor-fresh { color: #94a3b8; font-weight: 400; }
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
  border-radius: 12px;
  padding: 14px;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
}
.server-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
  border-color: #c7d2fe;
}
.server-card.offline { opacity: 0.75; background: #fafafa; }

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
</style>
