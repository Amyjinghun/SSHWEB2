<template>
  <div class="page-container">
    <el-card shadow="hover">
      <div class="toolbar">
        <div class="toolbar-left">
          <el-select v-model="filters.server_id" placeholder="全部服务器" clearable @change="loadData">
            <template #prefix><el-icon><Monitor /></el-icon></template>
            <el-option v-for="s in servers" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
          <el-select v-model="filters.new_status" placeholder="全部状态" clearable @change="loadData">
            <el-option label="上线" value="online" />
            <el-option label="离线" value="offline" />
          </el-select>
        </div>
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <el-table :data="list" stripe v-loading="loading">
        <el-table-column prop="server_name" label="服务器" width="180">
          <template #default="{ row }">{{ row.server_name || `#${row.server_id}` }}</template>
        </el-table-column>
        <el-table-column prop="old_status" label="原状态" width="120">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.old_status)" size="small" effect="plain">{{ statusLabel(row.old_status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="变更" width="80" align="center">
          <template #default="{ row }">
            <el-icon :color="row.new_status === 'online' ? '#22c55e' : '#ef4444'">
              <Right />
            </el-icon>
          </template>
        </el-table-column>
        <el-table-column prop="new_status" label="新状态" width="120">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.new_status)" size="small" effect="dark">{{ statusLabel(row.new_status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="变更时间" width="180" />
      </el-table>

      <el-pagination
        v-model:current-page="page"
        :page-size="20"
        :total="total"
        layout="total, prev, pager, next"
        @current-change="loadData"
        style="margin-top:16px;justify-content:center"
      />
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../../api'

const servers = ref([])
const list = ref([])
const loading = ref(false)
const page = ref(1)
const total = ref(0)
const filters = ref({ server_id: '', new_status: '' })

onMounted(async () => {
  const r = await api.get('/api/servers')
  if (r.code === 0) servers.value = r.data
  loadData()
})

async function loadData() {
  loading.value = true
  try {
    const params = { page: page.value, ...filters.value }
    if (filters.value.server_id) {
      const res = await api.get(`/api/servers/${filters.value.server_id}/status-changes`, { params })
      if (res.code === 0) {
        const server = servers.value.find(s => s.id === Number(filters.value.server_id))
        list.value = (res.data.list || []).map(r => ({ ...r, server_name: server?.name }))
        total.value = res.data.total
      }
    } else {
      const allResults = []
      let totalCnt = 0
      for (const s of servers.value) {
        const res = await api.get(`/api/servers/${s.id}/status-changes`, { params: { page: 1, page_size: 200, ...filters.value } })
        if (res.code === 0) {
          totalCnt += res.data.total
          allResults.push(...(res.data.list || []).map(r => ({ ...r, server_name: s.name })))
        }
      }
      allResults.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      list.value = allResults.slice(0, 20)
      total.value = totalCnt
    }
  } finally { loading.value = false }
}

function statusTagType(status) {
  return status === 'online' ? 'success' : status === 'offline' ? 'danger' : 'info'
}

function statusLabel(status) {
  return status === 'online' ? '在线' : status === 'offline' ? '离线' : '未知'
}
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
.toolbar-left { display: flex; gap: 8px; flex-wrap: wrap; }
</style>
