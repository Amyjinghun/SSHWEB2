<template>
  <div class="page-container">
    <div class="stat-cards">
      <el-row :gutter="16">
        <el-col :span="6" v-for="item in statCards" :key="item.label">
          <el-card class="stat-card" shadow="hover">
            <div class="stat-card-inner" :style="{ borderLeft: `4px solid ${item.color}` }">
              <div class="stat-info">
                <div class="stat-label">{{ item.label }}</div>
                <div class="stat-value" :style="{ color: item.color }">{{ item.value }}</div>
              </div>
              <el-icon :size="36" :style="{ color: item.color }"><component :is="item.icon" /></el-icon>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <el-row :gutter="16" style="margin-top:16px">
      <el-col :span="8">
        <el-card shadow="hover">
          <template #header><span style="font-weight:600">服务器状态</span></template>
          <div ref="pieChartRef" style="height:280px"></div>
        </el-card>
      </el-col>
      <el-col :span="16">
        <el-card shadow="hover">
          <template #header><span style="font-weight:600">近7天命令执行统计</span></template>
          <div ref="barChartRef" style="height:280px"></div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" style="margin-top:16px">
      <el-col :span="12">
        <el-card shadow="hover">
          <template #header><span style="font-weight:600">最近执行记录</span></template>
          <el-table :data="recentCommands" size="small" stripe>
            <el-table-column prop="server_name" label="服务器" width="120" />
            <el-table-column prop="command" label="命令" show-overflow-tooltip />
            <el-table-column prop="status" label="状态" width="80">
              <template #default="{ row }">
                <el-tag :type="row.status==='success'?'success':'danger'" size="small">{{ row.status==='success'?'成功':'失败' }}</el-tag>
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
          <template #header><span style="font-weight:600">最近告警</span></template>
          <el-table :data="recentAlerts" size="small" stripe>
            <el-table-column prop="server_name" label="服务器" width="120" />
            <el-table-column prop="title" label="告警" show-overflow-tooltip />
            <el-table-column prop="level" label="级别" width="80">
              <template #default="{ row }">
                <el-tag :type="row.level==='critical'?'danger':row.level==='warning'?'warning':'info'" size="small">{{ row.level }}</el-tag>
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
  { label: '服务器总数', value: 0, icon: 'Server', color: '#409EFF' },
  { label: '在线服务器', value: 0, icon: 'CircleCheck', color: '#67C23A' },
  { label: '离线服务器', value: 0, icon: 'CircleClose', color: '#F56C6C' },
  { label: '告警数量', value: 0, icon: 'Bell', color: '#E6A23C' },
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
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie', radius: ['40%', '70%'],
      label: { formatter: '{b}: {c}' },
      data: [
        { value: data.server_online, name: '在线', itemStyle: { color: '#67C23A' } },
        { value: data.server_offline, name: '离线', itemStyle: { color: '#F56C6C' } },
        { value: data.server_total - data.server_online - data.server_offline, name: '未知', itemStyle: { color: '#909399' } }
      ]
    }]
  })
  window.addEventListener('resize', () => chart.resize())
}

function renderBarChart(stats) {
  const chart = echarts.init(barChartRef.value)
  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['成功', '失败'] },
    grid: { left: 40, right: 20, bottom: 40 },
    xAxis: { type: 'category', data: stats.map(s => s.date) },
    yAxis: { type: 'value' },
    series: [
      { name: '成功', type: 'bar', stack: 'total', data: stats.map(s => s.success_count), itemStyle: { color: '#67C23A' } },
      { name: '失败', type: 'bar', stack: 'total', data: stats.map(s => s.failed_count), itemStyle: { color: '#F56C6C' } }
    ]
  })
  window.addEventListener('resize', () => chart.resize())
}
</script>

<style scoped>
.stat-cards { margin-bottom: 0; }
.stat-card { border-radius: 12px; }
.stat-card-inner { display: flex; justify-content: space-between; align-items: center; padding: 4px 0 4px 16px; }
.stat-label { color: #909399; font-size: 14px; }
.stat-value { font-size: 28px; font-weight: 700; margin-top: 4px; }
</style>
