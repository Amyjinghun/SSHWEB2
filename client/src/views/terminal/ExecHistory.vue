<template>
  <div class="page-container">
    <el-card shadow="hover">
      <div class="toolbar">
        <div class="toolbar-left">
          <el-select v-model="filters.server_id" placeholder="服务器" clearable @change="loadData">
            <template #prefix><el-icon><Monitor /></el-icon></template>
            <el-option v-for="s in servers" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
          <el-select v-model="filters.status" placeholder="状态" clearable @change="loadData">
            <el-option label="成功" value="success" /><el-option label="失败" value="failed" /><el-option label="超时" value="timeout" />
          </el-select>
        </div>
      </div>
      <el-table :data="logs" stripe v-loading="loading">
        <el-table-column prop="server_name" label="服务器" width="140" />
        <el-table-column prop="command" label="命令" show-overflow-tooltip>
          <template #default="{ row }"><code class="cmd-code">{{ row.command }}</code></template>
        </el-table-column>
        <el-table-column prop="execute_type" label="类型" width="80"><template #default="{ row }"><el-tag size="small" effect="plain">{{ row.execute_type === 'batch' ? '批量' : '单台' }}</el-tag></template></el-table-column>
        <el-table-column prop="status" label="状态" width="80"><template #default="{ row }"><el-tag :type="row.status==='success'?'success':'danger'" size="small" effect="plain">{{ row.status }}</el-tag></template></el-table-column>
        <el-table-column prop="duration_ms" label="耗时" width="80"><template #default="{ row }">{{ row.duration_ms ? (row.duration_ms/1000).toFixed(1)+'s' : '-' }}</template></el-table-column>
        <el-table-column prop="created_at" label="时间" width="170" />
        <el-table-column label="操作" width="80">
          <template #default="{ row }"><el-button size="small" @click="viewDetail(row)">详情</el-button></template>
        </el-table-column>
      </el-table>
      <el-pagination v-model:current-page="page" :page-size="20" :total="total" layout="total, prev, pager, next" @current-change="loadData" style="margin-top:16px;justify-content:center" />
    </el-card>
    <el-dialog v-model="detailVisible" title="执行详情" width="700px">
      <template v-if="detail">
        <div class="detail-grid">
          <div class="detail-item"><span class="detail-label">命令</span><code class="cmd-code">{{ detail.command }}</code></div>
          <div class="detail-item"><span class="detail-label">服务器</span>{{ detail.server_name }} ({{ detail.server_host }})</div>
          <div class="detail-item"><span class="detail-label">退出码</span>{{ detail.exit_code }}</div>
          <div class="detail-item"><span class="detail-label">耗时</span>{{ detail.duration_ms ? (detail.duration_ms/1000).toFixed(2)+'s' : '-' }}</div>
        </div>
        <el-divider>标准输出</el-divider>
        <pre class="output-box">{{ detail.stdout || '(空)' }}</pre>
        <el-divider>错误输出</el-divider>
        <pre class="output-box" style="color:#f87171">{{ detail.stderr || detail.error_message || '(空)' }}</pre>
      </template>
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
const detailVisible = ref(false)
const detail = ref(null)
const filters = ref({ server_id: '', status: '' })
onMounted(async () => { const r = await api.get('/api/servers'); if (r.code === 0) servers.value = r.data; loadData() })
async function loadData() {
  loading.value = true
  const params = { page: page.value, ...filters.value }
  const r = await api.get('/api/commands/logs', { params })
  if (r.code === 0) { logs.value = r.data.list; total.value = r.data.total }
  loading.value = false
}
async function viewDetail(row) { const r = await api.get(`/api/commands/logs/${row.id}`); if (r.code === 0) { detail.value = r.data; detailVisible.value = true } }
</script>

<style scoped>
.toolbar { display: flex; gap: 12px; margin-bottom: 16px; }
.toolbar-left { display: flex; gap: 12px; }
.cmd-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12.5px;
  background: #f4f6fb;
  padding: 2px 6px;
  border-radius: 4px;
  color: #0891b2;
}
.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 24px;
  margin-bottom: 8px;
}
.detail-label { color: #64748b; font-size: 13px; margin-right: 8px; }
</style>
