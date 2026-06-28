<template>
  <div class="page-container audit-page">
    <el-card shadow="hover" class="audit-card">
      <div class="audit-header">
        <div>
          <div class="page-title">审计日志</div>
          <div class="page-desc">查看登录、服务器、文件、任务和系统配置等关键操作记录</div>
        </div>
        <el-button :loading="loading" @click="loadData">刷新</el-button>
      </div>

      <div class="filter-bar">
        <el-select v-model="filters.action" placeholder="操作类型" clearable filterable @change="handleFilterChange">
          <el-option v-for="a in actionTypes" :key="a" :label="formatAction(a)" :value="a" />
        </el-select>
        <el-select v-model="filters.status" placeholder="状态" clearable @change="handleFilterChange">
          <el-option label="成功" value="success" />
          <el-option label="失败" value="failed" />
        </el-select>
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          @change="handleFilterChange"
        />
      </div>

      <el-table :data="logs" stripe v-loading="loading" class="audit-table">
        <el-table-column prop="username" label="操作人" min-width="110" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="user-cell">
              <span class="avatar">{{ getInitial(row.username) }}</span>
              <span>{{ row.username || '-' }}</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column prop="action" label="操作类型" min-width="170" show-overflow-tooltip>
          <template #default="{ row }">
            <el-tag size="small" effect="plain" class="action-tag">{{ formatAction(row.action) }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column prop="server_name" label="服务器" min-width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ row.server_name || '-' }}</template>
        </el-table-column>

        <el-table-column prop="ip" label="IP" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.ip || '-' }}</template>
        </el-table-column>

        <el-table-column prop="detail_json" label="详情" min-width="300">
          <template #default="{ row }">
            <button v-if="hasDetail(row)" class="detail-button" @click="showDetail(row)">
              {{ detailSummary(row) }}
            </button>
            <span v-else class="muted">-</span>
          </template>
        </el-table-column>

        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'success' ? 'success' : 'danger'" size="small" effect="light" round>
              {{ row.status === 'success' ? '成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column prop="created_at" label="时间" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="page"
          :page-size="20"
          :total="total"
          layout="total, prev, pager, next"
          @current-change="loadData"
        />
      </div>
    </el-card>

    <el-dialog v-model="detailVisible" title="操作详情" width="680px" destroy-on-close>
      <div v-if="currentLog" class="detail-dialog">
        <div class="detail-meta">
          <div><span>操作人</span><strong>{{ currentLog.username || '-' }}</strong></div>
          <div><span>操作类型</span><strong>{{ formatAction(currentLog.action) }}</strong></div>
          <div><span>状态</span><strong>{{ currentLog.status === 'success' ? '成功' : '失败' }}</strong></div>
          <div><span>时间</span><strong>{{ formatTime(currentLog.created_at) }}</strong></div>
        </div>
        <pre class="json-view">{{ formatDetail(currentLog.detail_json) }}</pre>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../../api'

const logs = ref([])
const loading = ref(false)
const page = ref(1)
const total = ref(0)
const dateRange = ref(null)
const filters = ref({ action: '', status: '' })
const detailVisible = ref(false)
const currentLog = ref(null)

const actionTypes = [
  'login', 'logout', 'add_server', 'update_server', 'delete_server', 'test_connection',
  'exec_command', 'batch_exec', 'upload_file', 'download_file', 'delete_file', 'edit_file',
  'restart_service', 'stop_service', 'kill_process', 'create_scheduled_task',
  'delete_scheduled_task', 'db_backup', 'change_password', 'update_settings',
  'import_servers', 'export_servers', 'refresh_server_metrics', 'renew_server',
  'create_user', 'update_user', 'delete_user', 'reset_password', 'data_cleanup'
]

const actionLabels = {
  login: '登录',
  logout: '退出登录',
  add_server: '添加服务器',
  update_server: '更新服务器',
  delete_server: '删除服务器',
  test_connection: '测试连接',
  exec_command: '执行命令',
  batch_exec: '批量执行',
  upload_file: '上传文件',
  download_file: '下载文件',
  delete_file: '删除文件',
  edit_file: '编辑文件',
  restart_service: '重启服务',
  stop_service: '停止服务',
  kill_process: '结束进程',
  create_scheduled_task: '创建计划任务',
  delete_scheduled_task: '删除计划任务',
  db_backup: '数据库备份',
  change_password: '修改密码',
  update_settings: '更新设置',
  import_servers: '导入服务器',
  export_servers: '导出服务器',
  refresh_server_metrics: '刷新监控',
  renew_server: '服务器续费',
  create_user: '创建用户',
  update_user: '更新用户',
  delete_user: '删除用户',
  reset_password: '重置密码',
  data_cleanup: '数据清理'
}

onMounted(() => loadData())

function handleFilterChange() {
  page.value = 1
  loadData()
}

async function loadData() {
  loading.value = true
  try {
    const params = { page: page.value, ...filters.value }
    if (dateRange.value) {
      params.start_date = dateRange.value[0].toISOString().split('T')[0]
      params.end_date = dateRange.value[1].toISOString().split('T')[0]
    }
    const r = await api.get('/api/audit-logs', { params })
    if (r.code === 0) {
      logs.value = r.data.list || []
      total.value = r.data.total || 0
    }
  } finally {
    loading.value = false
  }
}

function formatAction(action) {
  return actionLabels[action] || action || '-'
}

function getInitial(username) {
  return String(username || '?').slice(0, 1).toUpperCase()
}

function formatTime(value) {
  if (!value) return '-'
  return String(value).replace('T', ' ').replace('.000Z', '').replace('Z', '')
}

function hasDetail(row) {
  return row && row.detail_json && Object.keys(row.detail_json).length > 0
}

function detailSummary(row) {
  const detail = row.detail_json || {}
  if (detail.name) return `名称：${detail.name}`
  if (detail.host) return `主机：${detail.host}`
  if (detail.command) return `命令：${detail.command}`
  if (detail.path) return `路径：${detail.path}`
  if (detail.count !== undefined) return `数量：${detail.count}`
  return '查看详情'
}

function formatDetail(detail) {
  if (!detail) return '-'
  return JSON.stringify(detail, null, 2)
}

function showDetail(row) {
  currentLog.value = row
  detailVisible.value = true
}
</script>

<style scoped>
.audit-page {
  min-height: calc(100vh - 56px);
}

.audit-card {
  border-radius: 10px;
  border: 1px solid #e5eaf3;
  overflow: hidden;
}

.audit-card :deep(.el-card__body) {
  padding: 20px;
}

.audit-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.page-title {
  font-size: 18px;
  font-weight: 700;
  color: #111827;
}

.page-desc {
  margin-top: 6px;
  color: #64748b;
  font-size: 13px;
}

.filter-bar {
  display: grid;
  grid-template-columns: minmax(180px, 220px) minmax(140px, 180px) minmax(280px, 1fr);
  gap: 12px;
  padding: 14px;
  margin-bottom: 16px;
  border: 1px solid #e6edf5;
  border-radius: 8px;
  background: #f8fafc;
}

.filter-bar :deep(.el-select),
.filter-bar :deep(.el-date-editor) {
  width: 100%;
}

.audit-table {
  border: 1px solid #edf2f7;
  border-radius: 8px;
  overflow: hidden;
}

.audit-table :deep(.el-table__header th) {
  background: #f8fafc;
  color: #475569;
  font-weight: 700;
}

.audit-table :deep(.el-table__row) {
  height: 58px;
}

.user-cell {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  background: #eef4ff;
  color: #4f6ef7;
  font-size: 12px;
  font-weight: 700;
}

.action-tag {
  max-width: 150px;
}

.detail-button {
  width: 100%;
  height: 30px;
  padding: 0 10px;
  border: 1px solid #d9e4f2;
  border-radius: 6px;
  color: #334155;
  background: #fff;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-button:hover {
  color: #4f6ef7;
  border-color: #b8c6ff;
  background: #f5f7ff;
}

.muted {
  color: #94a3b8;
}

.pagination-wrap {
  display: flex;
  justify-content: center;
  padding-top: 16px;
}

.detail-dialog {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.detail-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.detail-meta div {
  padding: 10px 12px;
  border: 1px solid #e6edf5;
  border-radius: 8px;
  background: #f8fafc;
}

.detail-meta span {
  display: block;
  margin-bottom: 4px;
  color: #64748b;
  font-size: 12px;
}

.detail-meta strong {
  color: #111827;
  font-size: 13px;
  font-weight: 600;
}

.json-view {
  max-height: 420px;
  margin: 0;
  padding: 16px;
  overflow: auto;
  border-radius: 8px;
  background: #111827;
  color: #e5e7eb;
  font-size: 13px;
  line-height: 1.7;
}

@media (max-width: 900px) {
  .audit-header {
    flex-direction: column;
  }

  .filter-bar {
    grid-template-columns: 1fr;
  }

  .detail-meta {
    grid-template-columns: 1fr;
  }
}
</style>
