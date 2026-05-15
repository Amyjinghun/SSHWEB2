<template>
  <div class="page-container">
    <el-card shadow="hover">
      <div class="toolbar">
        <span class="page-title">审计日志</span>
        <div class="toolbar-left">
          <el-select v-model="filters.action" placeholder="操作类型" clearable @change="loadData">
            <el-option v-for="a in actionTypes" :key="a" :label="a" :value="a" />
          </el-select>
          <el-select v-model="filters.status" placeholder="状态" clearable @change="loadData">
            <el-option label="成功" value="success" /><el-option label="失败" value="failed" />
          </el-select>
          <el-date-picker v-model="dateRange" type="daterange" range-separator="至" start-placeholder="开始" end-placeholder="结束" @change="loadData" />
        </div>
      </div>
      <el-table :data="logs" stripe v-loading="loading">
        <el-table-column prop="username" label="操作人" width="100" />
        <el-table-column prop="action" label="操作类型" width="140">
          <template #default="{ row }"><el-tag size="small" effect="plain">{{ row.action }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="server_name" label="服务器" width="140" />
        <el-table-column prop="ip" label="IP" width="130" />
        <el-table-column prop="detail_json" label="详情" show-overflow-tooltip>
          <template #default="{ row }">{{ row.detail_json ? JSON.stringify(row.detail_json) : '-' }}</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="80">
          <template #default="{ row }"><el-tag :type="row.status==='success'?'success':'danger'" size="small" effect="plain">{{ row.status }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="created_at" label="时间" width="170" />
      </el-table>
      <el-pagination v-model:current-page="page" :page-size="20" :total="total" layout="total, prev, pager, next" @current-change="loadData" style="margin-top:16px;justify-content:center" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../../api'
const logs = ref([]); const loading = ref(false); const page = ref(1); const total = ref(0)
const dateRange = ref(null); const filters = ref({ action: '', status: '' })
const actionTypes = ['login', 'logout', 'add_server', 'update_server', 'delete_server', 'test_connection', 'exec_command', 'batch_exec', 'upload_file', 'download_file', 'delete_file', 'edit_file', 'restart_service', 'stop_service', 'kill_process', 'create_scheduled_task', 'delete_scheduled_task', 'db_backup', 'change_password', 'update_settings']
onMounted(() => loadData())
async function loadData() {
  loading.value = true
  const params = { page: page.value, ...filters.value }
  if (dateRange.value) { params.start_date = dateRange.value[0].toISOString().split('T')[0]; params.end_date = dateRange.value[1].toISOString().split('T')[0] }
  const r = await api.get('/api/audit-logs', { params })
  if (r.code === 0) { logs.value = r.data.list; total.value = r.data.total }
  loading.value = false
}
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
.toolbar-left { display: flex; gap: 8px; flex-wrap: wrap; }
.page-title { font-weight: 600; font-size: 16px; color: #1e293b; }
</style>
