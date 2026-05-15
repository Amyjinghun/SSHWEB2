<template>
  <div class="page-container">
    <el-card shadow="hover">
      <div class="toolbar">
        <span class="page-title">批量文件分发</span>
      </div>

      <el-alert type="info" show-icon :closable="false" style="margin-bottom:16px">
        <template #title>从一台服务器下载文件，然后分发到多台目标服务器的相同路径或自定义路径。</template>
      </el-alert>

      <el-row :gutter="16">
        <el-col :span="12">
          <el-card shadow="hover">
            <template #header><span class="card-title">源文件</span></template>
            <el-form label-width="100px">
              <el-form-item label="源服务器">
                <el-select v-model="form.source_server_id" placeholder="选择源服务器" filterable style="width:100%">
                  <el-option v-for="s in servers" :key="s.id" :label="`${s.name} (${s.host})`" :value="s.id" />
                </el-select>
              </el-form-item>
              <el-form-item label="源文件路径">
                <el-input v-model="form.source_path" placeholder="例如: /etc/nginx/nginx.conf" />
              </el-form-item>
            </el-form>
          </el-card>
        </el-col>
        <el-col :span="12">
          <el-card shadow="hover">
            <template #header><span class="card-title">分发目标</span></template>
            <el-form label-width="100px">
              <el-form-item label="目标路径">
                <el-input v-model="form.target_path" placeholder="目标服务器上的完整路径（含文件名）" />
              </el-form-item>
              <el-form-item label="目标服务器">
                <el-select v-model="form.target_servers" placeholder="选择目标服务器" filterable multiple collapse-tags collapse-tags-tooltip style="width:100%">
                  <el-option v-for="s in servers" :key="s.id" :label="`${s.name} (${s.host})`" :value="s.id" />
                </el-select>
              </el-form-item>
              <el-form-item label="按分组选择">
                <el-select v-model="groupId" placeholder="选择分组" clearable @change="selectByGroup" style="width:100%">
                  <el-option v-for="g in groups" :key="g.id" :label="g.name" :value="g.id" />
                </el-select>
              </el-form-item>
            </el-form>
          </el-card>
        </el-col>
      </el-row>

      <div style="margin-top:16px;text-align:center">
        <el-button type="primary" size="large" @click="distribute" :loading="distributing" :disabled="!canDistribute">
          开始分发
        </el-button>
      </div>

      <el-card shadow="hover" style="margin-top:16px" v-if="results.length">
        <template #header><span class="card-title">分发结果</span></template>
        <el-table :data="results" size="small" stripe>
          <el-table-column prop="server_name" label="服务器" min-width="160" />
          <el-table-column prop="host" label="主机" min-width="140" />
          <el-table-column prop="success" label="结果" width="90">
            <template #default="{ row }"><el-tag :type="row.success?'success':'danger'" size="small" effect="plain">{{ row.success ? '成功' : '失败' }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="message" label="信息" show-overflow-tooltip />
        </el-table>
      </el-card>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '../../api'
import { ElMessage } from 'element-plus'

const servers = ref([])
const groups = ref([])
const groupId = ref('')
const distributing = ref(false)
const results = ref([])

const form = ref({
  source_server_id: null,
  source_path: '',
  target_path: '',
  target_servers: []
})

const canDistribute = computed(() =>
  form.value.source_server_id &&
  form.value.source_path &&
  form.value.target_path &&
  form.value.target_servers.length > 0
)

onMounted(async () => {
  const [sRes, gRes] = await Promise.all([api.get('/api/servers'), api.get('/api/server-groups')])
  if (sRes.code === 0) servers.value = sRes.data
  if (gRes.code === 0) groups.value = gRes.data
})

function selectByGroup(gid) {
  if (!gid) return
  const ids = servers.value.filter(s => s.group_id === gid).map(s => s.id)
  const existing = new Set(form.value.target_servers)
  ids.forEach(id => existing.add(id))
  form.value.target_servers = [...existing]
}

async function distribute() {
  if (!canDistribute.value) return ElMessage.warning('请填写完整配置')
  distributing.value = true
  results.value = []
  try {
    const res = await api.post('/api/files/distribute', form.value)
    if (res.code === 0) {
      results.value = res.data.results || []
      ElMessage.success(res.message)
    } else {
      ElMessage.error(res.message)
    }
  } finally {
    distributing.value = false
  }
}
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-title { font-weight: 600; font-size: 16px; color: #1e293b; }
.card-title { font-weight: 600; color: #1e293b; font-size: 15px; }
</style>
