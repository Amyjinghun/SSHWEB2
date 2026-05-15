<template>
  <div class="page-container">
    <el-card shadow="hover">
      <div class="toolbar">
        <el-select v-model="serverId" placeholder="选择服务器" filterable style="width:300px" @change="onServerChange">
          <template #prefix><el-icon><Monitor /></el-icon></template>
          <el-option v-for="s in servers" :key="s.id" :label="`${s.name} (${s.host})`" :value="s.id" />
        </el-select>
        <div class="toolbar-right">
          <template v-if="serverId">
            <el-button v-if="!rtConnected" type="success" @click="startRealtime"><el-icon><VideoPlay /></el-icon>开启实时</el-button>
            <el-button v-else type="danger" @click="stopRealtime"><el-icon><VideoPause /></el-icon>停止实时</el-button>
          </template>
          <el-button @click="loadHistory"><el-icon><Refresh /></el-icon>刷新历史</el-button>
        </div>
      </div>

      <div v-if="!serverId" class="empty-state">
        <el-icon :size="48" color="#cbd5e1"><DataLine /></el-icon>
        <p>请选择服务器查看监控</p>
      </div>

      <template v-else>
        <!-- 实时状态面板 -->
        <div class="realtime-panel" v-if="rtConnected || rtData.cpu !== null">
          <div class="rt-status-bar">
            <span class="status-dot" :class="rtConnected ? 'online' : 'offline'"></span>
            <span>{{ rtConnected ? '实时采集中 (每3秒)' : '已停止' }}</span>
          </div>
          <el-row :gutter="16">
            <el-col :span="6" v-for="item in realtimeCards" :key="item.label">
              <div class="rt-card" :style="{ borderTop: `3px solid ${item.color}` }">
                <div class="rt-label">{{ item.label }}</div>
                <div class="rt-value" :style="{ color: item.color }">{{ item.value }}</div>
                <div class="rt-sub">{{ item.sub }}</div>
              </div>
            </el-col>
          </el-row>
          <div ref="rtChartRef" style="height:200px;margin-top:12px"></div>
        </div>

        <!-- 历史曲线 -->
        <el-divider content-position="left">
          <span class="divider-text">历史趋势</span>
          <el-radio-group v-model="timeRange" @change="loadHistory" size="small" style="margin-left:12px">
            <el-radio-button value="1">1小时</el-radio-button>
            <el-radio-button value="6">6小时</el-radio-button>
            <el-radio-button value="24">24小时</el-radio-button>
            <el-radio-button value="168">7天</el-radio-button>
          </el-radio-group>
        </el-divider>

        <el-row :gutter="16">
          <el-col :span="8">
            <el-card shadow="hover" class="metric-card">
              <div class="metric-header"><el-icon style="color:#4f6ef7"><Cpu /></el-icon> CPU</div>
              <div ref="cpuChartRef" style="height:220px"></div>
            </el-card>
          </el-col>
          <el-col :span="8">
            <el-card shadow="hover" class="metric-card">
              <div class="metric-header"><el-icon style="color:#22c55e"><Memo /></el-icon> 内存</div>
              <div ref="memChartRef" style="height:220px"></div>
            </el-card>
          </el-col>
          <el-col :span="8">
            <el-card shadow="hover" class="metric-card">
              <div class="metric-header"><el-icon style="color:#f59e0b"><Coin /></el-icon> 磁盘</div>
              <div ref="diskChartRef" style="height:220px"></div>
            </el-card>
          </el-col>
        </el-row>

        <el-card shadow="hover" style="margin-top:16px">
          <template #header><span class="card-title">监控明细</span></template>
          <el-table :data="metrics" stripe size="small" max-height="320" v-loading="loading">
            <el-table-column prop="created_at" label="时间" width="170" />
            <el-table-column prop="cpu_usage" label="CPU%" width="100">
              <template #default="{ row }"><span :class="usageClass(row.cpu_usage)">{{ row.cpu_usage }}%</span></template>
            </el-table-column>
            <el-table-column prop="memory_usage" label="内存%" width="100">
              <template #default="{ row }"><span :class="usageClass(row.memory_usage)">{{ row.memory_usage }}%</span></template>
            </el-table-column>
            <el-table-column label="内存" width="160">
              <template #default="{ row }">{{ row.memory_used }} / {{ row.memory_total }} MB</template>
            </el-table-column>
            <el-table-column prop="disk_usage" label="磁盘%" width="100">
              <template #default="{ row }"><span :class="usageClass(row.disk_usage)">{{ row.disk_usage }}%</span></template>
            </el-table-column>
            <el-table-column label="磁盘" width="160">
              <template #default="{ row }">{{ row.disk_used }} / {{ row.disk_total }} MB</template>
            </el-table-column>
            <el-table-column prop="load_avg" label="负载" width="140" />
            <el-table-column prop="uptime" label="运行时间" show-overflow-tooltip />
          </el-table>
        </el-card>
      </template>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { io } from 'socket.io-client'
import api from '../../api'
import * as echarts from 'echarts'

const servers = ref([])
const serverId = ref('')
const metrics = ref([])
const loading = ref(false)
const timeRange = ref('24')
const cpuChartRef = ref(null)
const memChartRef = ref(null)
const diskChartRef = ref(null)
const rtChartRef = ref(null)
const charts = []

// 实时监控
const rtConnected = ref(false)
const rtData = ref({ cpu: null, mem_usage: null, mem_used: 0, mem_total: 0, disk_usage: null, disk_used: 0, disk_total: 0, load_avg: '-', uptime: '-' })
const rtHistory = ref([])
let rtSocket = null
let rtChart = null

const MAX_RT_POINTS = 60

const realtimeCards = computed(() => [
  { label: 'CPU', value: rtData.value.cpu !== null ? rtData.value.cpu.toFixed(1) + '%' : '-', sub: '使用率', color: rtData.value.cpu > 90 ? '#ef4444' : rtData.value.cpu > 70 ? '#f59e0b' : '#4f6ef7' },
  { label: '内存', value: rtData.value.mem_usage !== null ? rtData.value.mem_usage.toFixed(1) + '%' : '-', sub: `${rtData.value.mem_used} / ${rtData.value.mem_total} MB`, color: rtData.value.mem_usage > 90 ? '#ef4444' : rtData.value.mem_usage > 70 ? '#f59e0b' : '#22c55e' },
  { label: '磁盘', value: rtData.value.disk_usage !== null ? rtData.value.disk_usage.toFixed(1) + '%' : '-', sub: `${rtData.value.disk_used} / ${rtData.value.disk_total} MB`, color: rtData.value.disk_usage > 90 ? '#ef4444' : rtData.value.disk_usage > 70 ? '#f59e0b' : '#f59e0b' },
  { label: '负载', value: rtData.value.load_avg, sub: rtData.value.uptime, color: '#64748b' },
])

onMounted(async () => {
  const r = await api.get('/api/servers')
  if (r.code === 0) servers.value = r.data
})

onBeforeUnmount(() => {
  stopRealtime()
  charts.forEach(c => c.dispose())
})

function onServerChange() {
  stopRealtime()
  rtData.value = { cpu: null, mem_usage: null, mem_used: 0, mem_total: 0, disk_usage: null, disk_used: 0, disk_total: 0, load_avg: '-', uptime: '-' }
  rtHistory.value = []
  loadHistory()
}

// ──── 实时监控 ────
function startRealtime() {
  if (!serverId.value) return
  stopRealtime()
  rtHistory.value = []

  const token = localStorage.getItem('token')
  rtSocket = io('/metrics', { auth: { token }, transports: ['websocket'] })

  rtSocket.on('connect', () => {
    rtSocket.emit('start', serverId.value)
  })

  rtSocket.on('connected', () => {
    rtConnected.value = true
  })

  rtSocket.on('metrics', (data) => {
    rtData.value = data
    rtHistory.value.push(data)
    if (rtHistory.value.length > MAX_RT_POINTS) rtHistory.value.shift()
    renderRealtimeChart()
  })

  rtSocket.on('error', (msg) => {
    rtConnected.value = false
  })

  rtSocket.on('disconnect', () => {
    rtConnected.value = false
  })
}

function stopRealtime() {
  try { rtSocket?.emit('stop') } catch {}
  try { rtSocket?.disconnect() } catch {}
  rtSocket = null
  rtConnected.value = false
}

function renderRealtimeChart() {
  if (!rtChartRef.value) return
  if (!rtChart) rtChart = echarts.init(rtChartRef.value)

  const times = rtHistory.value.map(d => new Date(d.timestamp).toLocaleTimeString('zh-CN', { hour12: false }))
  rtChart.setOption({
    tooltip: { trigger: 'axis', backgroundColor: '#fff', borderColor: '#e8ecf4', borderWidth: 1, textStyle: { color: '#1e293b', fontSize: 12 } },
    legend: { data: ['CPU', '内存', '磁盘'], top: 0, textStyle: { fontSize: 12 } },
    grid: { left: 40, right: 10, top: 30, bottom: 24 },
    xAxis: { type: 'category', data: times, axisLabel: { color: '#94a3b8', fontSize: 10, interval: 'auto' }, axisLine: { lineStyle: { color: '#e8ecf4' } } },
    yAxis: { type: 'value', min: 0, max: 100, splitLine: { lineStyle: { color: '#f4f6fb' } }, axisLabel: { color: '#94a3b8' } },
    series: [
      { name: 'CPU', type: 'line', data: rtHistory.value.map(d => d.cpu?.toFixed(1) || 0), smooth: true, symbol: 'none', lineStyle: { width: 2, color: '#4f6ef7' } },
      { name: '内存', type: 'line', data: rtHistory.value.map(d => d.mem_usage?.toFixed(1) || 0), smooth: true, symbol: 'none', lineStyle: { width: 2, color: '#22c55e' } },
      { name: '磁盘', type: 'line', data: rtHistory.value.map(d => d.disk_usage?.toFixed(1) || 0), smooth: true, symbol: 'none', lineStyle: { width: 2, color: '#f59e0b' } },
    ]
  })
  window.addEventListener('resize', () => rtChart?.resize())
}

// ──── 历史曲线 ────
async function loadHistory() {
  if (!serverId.value) return
  loading.value = true
  try {
    const res = await api.get(`/api/servers/${serverId.value}/metrics`, { params: { hours: timeRange.value } })
    if (res.code === 0) {
      metrics.value = res.data
      await nextTick()
      renderHistoryCharts(res.data)
    }
  } finally { loading.value = false }
}

function usageClass(val) {
  if (val > 90) return 'usage-high'
  if (val > 70) return 'usage-warn'
  return 'usage-normal'
}

function buildChartOption(data, key, color) {
  const times = data.map(d => d.created_at ? d.created_at.slice(11, 16) : '')
  const values = data.map(d => Number(d[key]) || 0)
  return {
    tooltip: { trigger: 'axis', backgroundColor: '#fff', borderColor: '#e8ecf4', borderWidth: 1, textStyle: { color: '#1e293b' } },
    grid: { left: 40, right: 10, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: times, axisLine: { lineStyle: { color: '#e8ecf4' } }, axisLabel: { color: '#94a3b8', fontSize: 11 } },
    yAxis: { type: 'value', min: 0, max: 100, splitLine: { lineStyle: { color: '#f4f6fb' } }, axisLabel: { color: '#94a3b8' } },
    series: [{
      type: 'line', data: values, smooth: true, symbol: 'none', lineStyle: { width: 2, color },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: color + '30' }, { offset: 1, color: color + '05' }]) }
    }]
  }
}

function renderChart(el, option) {
  if (!el) return
  let chart = echarts.getInstanceByDom(el)
  if (!chart) { chart = echarts.init(el); charts.push(chart) }
  chart.setOption(option, true)
  window.addEventListener('resize', () => chart.resize())
}

function renderHistoryCharts(data) {
  renderChart(cpuChartRef.value, buildChartOption(data, 'cpu_usage', '#4f6ef7'))
  renderChart(memChartRef.value, buildChartOption(data, 'memory_usage', '#22c55e'))
  renderChart(diskChartRef.value, buildChartOption(data, 'disk_usage', '#f59e0b'))
}
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.toolbar-right { display: flex; gap: 10px; align-items: center; }

.realtime-panel {
  margin-top: 16px; padding: 16px; background: #f8fafc; border-radius: 12px; border: 1px solid #e8ecf4;
}
.rt-status-bar {
  display: flex; align-items: center; gap: 8px; margin-bottom: 12px;
  font-size: 13px; color: #64748b;
}
.status-dot {
  width: 8px; height: 8px; border-radius: 50%; display: inline-block;
}
.status-dot.online { background: #22c55e; box-shadow: 0 0 6px rgba(34,197,94,0.5); animation: pulse 2s infinite; }
.status-dot.offline { background: #94a3b8; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.rt-card {
  background: #fff; border-radius: 10px; padding: 16px 20px; text-align: center;
  transition: transform 0.15s;
}
.rt-card:hover { transform: translateY(-2px); }
.rt-label { font-size: 13px; color: #64748b; margin-bottom: 6px; }
.rt-value { font-size: 28px; font-weight: 700; line-height: 1.2; }
.rt-sub { font-size: 12px; color: #94a3b8; margin-top: 6px; }

.divider-text { font-size: 14px; color: #64748b; }
.metric-card { border-radius: 12px; }
.metric-header { font-weight: 600; color: #1e293b; font-size: 14px; display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.card-title { font-weight: 600; color: #1e293b; font-size: 15px; }
.usage-normal { color: #22c55e; font-weight: 600; }
.usage-warn { color: #f59e0b; font-weight: 600; }
.usage-high { color: #ef4444; font-weight: 700; }
.empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  height: 300px; color: #94a3b8; background: #f8fafc; border-radius: 12px; border: 2px dashed #e2e8f0;
  p { margin-top: 12px; font-size: 15px; }
}
</style>
