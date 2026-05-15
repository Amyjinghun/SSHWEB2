<template>
  <div class="page-container">
    <el-card shadow="hover">
      <div class="toolbar">
        <el-select v-model="serverId" placeholder="选择服务器" filterable style="width:300px" @change="loadServices">
          <template #prefix><el-icon><Monitor /></el-icon></template>
          <el-option v-for="s in servers" :key="s.id" :label="`${s.name} (${s.host})`" :value="s.id" />
        </el-select>
        <el-input v-model="searchName" placeholder="搜索服务名" style="width:200px" clearable>
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
      </div>
      <el-table :data="filteredServices" stripe v-loading="loading" max-height="600">
        <el-table-column prop="name" label="服务名称" width="280" show-overflow-tooltip />
        <el-table-column prop="active" label="运行状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.active==='active'?'success':'info'" size="small" effect="plain">{{ row.active }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="sub" label="子状态" width="100" />
        <el-table-column prop="description" label="描述" show-overflow-tooltip />
        <el-table-column label="操作" width="320">
          <template #default="{ row }">
            <el-button-group>
              <el-button size="small" @click="doAction(row.name, 'start')">启动</el-button>
              <el-button size="small" @click="doAction(row.name, 'stop')">停止</el-button>
              <el-button size="small" @click="doAction(row.name, 'restart')">重启</el-button>
              <el-button size="small" @click="viewLog(row)">日志</el-button>
            </el-button-group>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
    <el-dialog v-model="logVisible" :title="`${logService} 日志`" width="700px">
      <pre class="output-box">{{ logContent }}</pre>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '../../api'
import { ElMessage } from 'element-plus'
const servers = ref([])
const serverId = ref('')
const services = ref([])
const loading = ref(false)
const searchName = ref('')
const logVisible = ref(false)
const logContent = ref('')
const logService = ref('')
const filteredServices = computed(() => searchName.value ? services.value.filter(s => s.name.includes(searchName.value)) : services.value)
onMounted(async () => { const r = await api.get('/api/servers'); if (r.code === 0) servers.value = r.data })
async function loadServices() {
  if (!serverId.value) return; loading.value = true
  const res = await api.get('/api/services', { params: { server_id: serverId.value } })
  if (res.code === 0) services.value = res.data; loading.value = false
}
async function doAction(service, action) {
  const res = await api.post('/api/services/action', { server_id: serverId.value, service, action })
  if (res.code === 0) ElMessage.success(res.message); else ElMessage.error(res.message); loadServices()
}
async function viewLog(row) {
  logService.value = row.name; const res = await api.get('/api/services/logs', { params: { server_id: serverId.value, service: row.name } })
  if (res.code === 0) { logContent.value = res.data.content; logVisible.value = true }
}
</script>

<style scoped>
.toolbar { display: flex; gap: 12px; margin-bottom: 16px; }
</style>
