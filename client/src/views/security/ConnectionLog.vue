<template>
  <div class="page-container">
    <el-card shadow="hover">
      <div class="header">
        <div>
          <div class="page-title">连接日志</div>
          <div class="page-desc">记录每次 SSH 测试连接的诊断步骤，用于排查连接失败问题</div>
        </div>
        <el-button :loading="loading" @click="loadData">刷新</el-button>
      </div>

      <div class="filter-bar">
        <el-select v-model="filters.status" placeholder="结果" clearable @change="handleFilterChange" style="width:140px">
          <el-option label="成功" value="success" />
          <el-option label="失败" value="failed" />
        </el-select>
        <el-select v-model="filters.server_id" placeholder="服务器" clearable filterable @change="handleFilterChange" style="width:200px">
          <el-option v-for="s in servers" :key="s.id" :label="s.name" :value="s.id" />
        </el-select>
      </div>

      <el-table :data="logs" stripe v-loading="loading">
        <el-table-column prop="server_name" label="服务器" min-width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ row.server_name || '-' }}</template>
        </el-table-column>
        <el-table-column label="目标" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ getDetail(row).target || '-' }}</template>
        </el-table-column>
        <el-table-column label="TCP" width="90">
          <template #default="{ row }">
            <el-tag v-if="getDetail(row).tcp" :type="getDetail(row).tcp.ok ? 'success' : 'danger'" size="small" effect="light">
              {{ getDetail(row).tcp.ok ? '通' : '不通' }}
            </el-tag>
            <span v-else class="muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="SSH" width="90">
          <template #default="{ row }">
            <el-tag v-if="getDetail(row).ssh" :type="getDetail(row).ssh.ok ? 'success' : 'danger'" size="small" effect="light">
              {{ getDetail(row).ssh.ok ? '成功' : '失败' }}
            </el-tag>
            <span v-else class="muted">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="error_message" label="错误信息" min-width="240" show-overflow-tooltip>
          <template #default="{ row }">{{ row.error_message || '-' }}</template>
        </el-table-column>
        <el-table-column prop="status" label="结果" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 'success' ? 'success' : 'danger'" size="small" round>
              {{ row.status === 'success' ? '成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="时间" min-width="170" show-overflow-tooltip>
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="showDetail(row)">步骤</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="page" :page-size="20" :total="total" layout="total, prev, pager, next" @current-change="loadData" />
      </div>
    </el-card>

    <el-dialog v-model="detailVisible" title="连接步骤" width="720px" destroy-on-close>
      <div v-if="currentLog" class="detail-dialog">
        <div class="detail-meta">
          <div><span>服务器</span><strong>{{ currentLog.server_name || '-' }}</strong></div>
          <div><span>结果</span><strong :class="currentLog.status === 'success' ? 'ok' : 'fail'">{{ currentLog.status === 'success' ? '成功' : '失败' }}</strong></div>
          <div><span>时间</span><strong>{{ formatTime(currentLog.created_at) }}</strong></div>
          <div v-if="currentLog.error_message" style="grid-column: span 2"><span>错误</span><strong class="fail">{{ currentLog.error_message }}</strong></div>
        </div>
        <div class="steps">
          <div v-if="!(getDetail(currentLog).steps || []).length" class="empty">无步骤记录（可能是旧版本生成的记录）</div>
          <div v-for="(s, i) in (getDetail(currentLog).steps || [])" :key="i" class="step">
            <span class="step-time">{{ (s.time || '').slice(11, 19) }}</span>
            <span class="step-name">{{ s.step }}</span>
            <span v-if="s.detail" class="step-detail">{{ s.detail }}</span>
          </div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../../api'

const logs = ref([])
const servers = ref([])
const loading = ref(false)
const page = ref(1)
const total = ref(0)
const filters = ref({ status: '', server_id: '' })
const detailVisible = ref(false)
const currentLog = ref(null)

onMounted(() => { loadData(); loadServers() })

function handleFilterChange() { page.value = 1; loadData() }

async function loadData() {
  loading.value = true
  try {
    const params = { page: page.value, action: 'test_connection', ...filters.value }
    const r = await api.get('/api/audit-logs', { params })
    if (r.code === 0) { logs.value = r.data.list || []; total.value = r.data.total || 0 }
  } finally { loading.value = false }
}

async function loadServers() {
  const r = await api.get('/api/servers')
  if (r.code === 0) servers.value = r.data || []
}

function getDetail(row) {
  const d = row && row.detail_json
  if (!d) return {}
  if (typeof d === 'string') { try { return JSON.parse(d) } catch { return {} } }
  return d
}

function formatTime(v) {
  if (!v) return '-'
  return String(v).replace('T', ' ').replace('.000Z', '').replace('Z', '')
}

function showDetail(row) { currentLog.value = row; detailVisible.value = true }
</script>

<style scoped>
.page-title { font-size: 18px; font-weight: 700; color: #111827; }
.page-desc { margin-top: 6px; color: #64748b; font-size: 13px; }
.header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 18px; }
.filter-bar { display: flex; gap: 12px; margin-bottom: 16px; }
.muted { color: #94a3b8; }
.pagination-wrap { display: flex; justify-content: center; padding-top: 16px; }
.detail-dialog { display: flex; flex-direction: column; gap: 14px; }
.detail-meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.detail-meta div { padding: 10px 12px; border: 1px solid #e6edf5; border-radius: 8px; background: #f8fafc; }
.detail-meta span { display: block; margin-bottom: 4px; color: #64748b; font-size: 12px; }
.detail-meta strong { color: #111827; font-size: 13px; word-break: break-all; }
.detail-meta strong.fail { color: #ef4444; }
.detail-meta strong.ok { color: #22c55e; }
.steps { max-height: 420px; overflow: auto; border: 1px solid #e6edf5; border-radius: 8px; background: #0f172a; padding: 12px; }
.step { display: flex; gap: 10px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 13px; line-height: 1.6; color: #e5e7eb; }
.step:last-child { border-bottom: none; }
.step-time { color: #94a3b8; font-family: monospace; flex-shrink: 0; }
.step-name { color: #93c5fd; font-weight: 600; flex-shrink: 0; }
.step-detail { color: #cbd5e1; word-break: break-all; }
.empty { color: #94a3b8; text-align: center; padding: 20px; }
</style>
