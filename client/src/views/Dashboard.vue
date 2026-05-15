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
import { ref, onMounted, nextTick } from 'vue'
import api from '../api'
import * as echarts from 'echarts'

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

onMounted(async () => {
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
</style>
