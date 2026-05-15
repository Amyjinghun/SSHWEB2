<template>
  <div class="page-container">
    <el-card shadow="hover">
      <div class="toolbar">
        <el-select v-model="serverId" placeholder="选择服务器" filterable style="width:300px" @change="loadData">
          <template #prefix><el-icon><Monitor /></el-icon></template>
          <el-option v-for="s in servers" :key="s.id" :label="`${s.name} (${s.host})`" :value="s.id" />
        </el-select>
        <el-input v-model="search" placeholder="搜索进程" style="width:200px" clearable>
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>
      <el-table :data="filtered" stripe v-loading="loading" max-height="600">
        <el-table-column prop="pid" label="PID" width="80" />
        <el-table-column prop="user" label="用户" width="80" />
        <el-table-column prop="cpu" label="CPU%" width="80">
          <template #default="{ row }">
            <span :class="parseFloat(row.cpu) > 80 ? 'usage-high' : 'usage-normal'">{{ row.cpu }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="mem" label="内存%" width="80">
          <template #default="{ row }">
            <span :class="parseFloat(row.mem) > 80 ? 'usage-high' : 'usage-normal'">{{ row.mem }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="command" label="命令" show-overflow-tooltip />
        <el-table-column label="操作" width="150">
          <template #default="{ row }">
            <el-button size="small" @click="kill(row.pid)">结束</el-button>
            <el-button size="small" type="danger" @click="forceKill(row.pid)">强制结束</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '../../api'
import { ElMessage, ElMessageBox } from 'element-plus'
const servers = ref([]); const serverId = ref(''); const processes = ref([]); const loading = ref(false); const search = ref('')
const filtered = computed(() => search.value ? processes.value.filter(p => p.command?.includes(search.value) || p.pid?.toString() === search.value) : processes.value)
onMounted(async () => { const r = await api.get('/api/servers'); if (r.code === 0) servers.value = r.data })
async function loadData() {
  if (!serverId.value) return; loading.value = true
  const res = await api.get('/api/processes', { params: { server_id: serverId.value } })
  if (res.code === 0) processes.value = res.data; loading.value = false
}
async function kill(pid) { await ElMessageBox.confirm(`结束进程 ${pid}？`, '确认'); const r = await api.post(`/api/processes/${pid}/kill`, { server_id: serverId.value }); ElMessage[r.code === 0 ? 'success' : 'error'](r.message); loadData() }
async function forceKill(pid) { await ElMessageBox.confirm(`强制结束进程 ${pid}？`, '确认', { type: 'warning' }); const r = await api.post(`/api/processes/${pid}/force-kill`, { server_id: serverId.value }); ElMessage[r.code === 0 ? 'success' : 'error'](r.message); loadData() }
</script>

<style scoped>
.toolbar { display: flex; gap: 12px; margin-bottom: 16px; }
.usage-high { color: #ef4444; font-weight: 600; }
.usage-normal { color: #1e293b; }
</style>
