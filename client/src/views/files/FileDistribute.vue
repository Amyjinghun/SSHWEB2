<template>
  <div class="page-container">
    <el-card shadow="hover">
      <div class="toolbar">
        <span class="page-title">批量文件分发</span>
      </div>

      <el-alert type="info" show-icon :closable="false" style="margin-bottom:16px">
        <template #title>从远程服务器或面板本机选择文件，分发到多台目标服务器的指定路径。</template>
      </el-alert>

      <el-row :gutter="16">
        <el-col :span="12">
          <el-card shadow="hover">
            <template #header><span class="card-title">源文件</span></template>
            <el-form label-width="100px">
              <el-form-item label="源类型">
                <el-radio-group v-model="sourceType">
                  <el-radio-button value="remote">远程服务器</el-radio-button>
                  <el-radio-button value="local">本机文件</el-radio-button>
                </el-radio-group>
              </el-form-item>
              <template v-if="sourceType === 'remote'">
                <el-form-item label="源服务器">
                  <el-select v-model="form.source_server_id" placeholder="选择源服务器" filterable style="width:100%">
                    <el-option v-for="s in servers" :key="s.id" :label="`${s.name} (${s.host})`" :value="s.id" />
                  </el-select>
                </el-form-item>
                <el-form-item label="源文件路径">
                  <el-input v-model="form.source_path" placeholder="例如: /etc/nginx/nginx.conf" />
                </el-form-item>
              </template>
              <template v-else>
                <el-form-item label="本机文件">
                  <el-input v-model="localFilePath" placeholder="点击浏览选择本机文件" readonly>
                    <template #append>
                      <el-button :icon="FolderOpened" @click="openLocalBrowser">浏览</el-button>
                    </template>
                  </el-input>
                </el-form-item>
                <el-form-item>
                  <span style="color:var(--text-muted);font-size:12px">从面板所在服务器的本地文件系统中选择文件</span>
                </el-form-item>
              </template>
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

    <!-- 本机文件浏览对话框 -->
    <el-dialog v-model="localBrowserVisible" title="浏览本机文件" width="700px" top="5vh">
      <div class="local-browser-bar">
        <el-button text :icon="Back" @click="goParent" :disabled="!localBrowserParent || localBrowserParent === localBrowserPath" />
        <el-icon><FolderOpened /></el-icon>
        <span class="local-path-display">{{ localBrowserPath }}</span>
      </div>
      <el-table :data="localBrowserItems" size="small" @row-dblclick="onRowDblClick" max-height="450" v-loading="localLoading">
        <el-table-column prop="name" label="名称" min-width="300">
          <template #default="{ row }">
            <el-icon v-if="row.isDir" style="color:var(--primary-color)"><Folder /></el-icon>
            <el-icon v-else style="color:var(--text-muted)"><Document /></el-icon>
            <span style="margin-left:6px">{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="size" label="大小" width="100">
          <template #default="{ row }">{{ row.isDir ? '-' : formatSize(row.size) }}</template>
        </el-table-column>
        <el-table-column label="" width="80">
          <template #default="{ row }">
            <el-button v-if="row.isFile" size="small" type="primary" @click.stop="selectLocalFile(row)">选择</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { FolderOpened, Back, Folder, Document } from '@element-plus/icons-vue'
import api from '../../api'
import { ElMessage } from 'element-plus'

const servers = ref([])
const groups = ref([])
const groupId = ref('')
const distributing = ref(false)
const results = ref([])
const sourceType = ref('remote')

const form = ref({
  source_server_id: null,
  source_path: '',
  target_path: '',
  target_servers: []
})

// 本机文件浏览
const localFilePath = ref('')
const localBrowserVisible = ref(false)
const localBrowserPath = ref('/')
const localBrowserParent = ref('')
const localBrowserItems = ref([])
const localLoading = ref(false)

const canDistribute = computed(() => {
  if (sourceType.value === 'local') {
    return localFilePath.value && form.value.target_path && form.value.target_servers.length > 0
  }
  return form.value.source_server_id && form.value.source_path && form.value.target_path && form.value.target_servers.length > 0
})

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
    let res
    if (sourceType.value === 'local') {
      res = await api.post('/api/local-files/distribute', {
        local_path: localFilePath.value,
        target_path: form.value.target_path,
        target_servers: form.value.target_servers
      })
    } else {
      res = await api.post('/api/files/distribute', form.value)
    }
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

// 本机文件浏览
async function openLocalBrowser() {
  localBrowserVisible.value = true
  await loadLocalDir('/')
}

async function loadLocalDir(dir) {
  localLoading.value = true
  try {
    const res = await api.get('/api/local-files/list', { params: { path: dir } })
    if (res.code === 0) {
      localBrowserPath.value = res.data.path
      localBrowserParent.value = res.data.parent
      localBrowserItems.value = res.data.items
    } else {
      ElMessage.error(res.message)
    }
  } finally { localLoading.value = false }
}

function goParent() {
  if (localBrowserParent.value && localBrowserParent.value !== localBrowserPath.value) {
    loadLocalDir(localBrowserParent.value)
  }
}

function onRowDblClick(row) {
  if (row.isDir) loadLocalDir(row.path)
}

function selectLocalFile(row) {
  localFilePath.value = row.path
  localBrowserVisible.value = false
}

function formatSize(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return n.toFixed(i === 0 ? 0 : 1) + ' ' + units[i]
}
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-title { font-weight: 600; font-size: 16px; color: var(--text-primary); }
.card-title { font-weight: 600; color: var(--text-primary); font-size: 15px; }
.local-browser-bar {
  display: flex; align-items: center; gap: 8px; margin-bottom: 12px;
  padding: 8px 12px; background: var(--surface-subtle); border-radius: var(--radius-sm);
}
.local-path-display {
  font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 13px;
  color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
</style>
