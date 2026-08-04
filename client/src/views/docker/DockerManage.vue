<template>
  <div class="page-container">
    <!-- 工具栏 -->
    <div class="toolbar">
      <el-select v-model="serverId" placeholder="选择服务器" filterable @change="onServerChange" style="width:280px">
        <el-option v-for="s in servers" :key="s.id" :label="`${s.name} (${s.host})`" :value="s.id" />
      </el-select>
      <div class="toolbar-right">
        <el-button :icon="Refresh" @click="loadAll" :loading="loading" :disabled="!serverId">刷新</el-button>
        <el-button type="warning" :icon="Delete" @click="showPruneDialog = true" :disabled="!serverId">系统清理</el-button>
      </div>
    </div>

    <!-- Docker 信息卡 -->
    <div v-if="dockerInfo" class="info-cards">
      <div class="info-card"><span>容器</span><strong>{{ dockerInfo.Containers || 0 }}</strong><em>{{ dockerInfo.ContainersRunning || 0 }} 运行 / {{ dockerInfo.ContainersStopped || 0 }} 停止</em></div>
      <div class="info-card"><span>镜像</span><strong>{{ dockerInfo.Images || 0 }}</strong></div>
      <div class="info-card"><span>Docker 版本</span><strong>{{ dockerInfo.ServerVersion || '-' }}</strong></div>
      <div class="info-card"><span>存储驱动</span><strong>{{ dockerInfo.Driver || '-' }}</strong></div>
    </div>

    <el-empty v-if="!serverId" description="请先选择一台服务器" />

    <el-tabs v-else v-model="activeTab" @tab-change="onTabChange">
      <!-- 容器 -->
      <el-tab-pane label="容器" name="containers">
        <el-table :data="containers" stripe v-loading="loading" size="small">
          <el-table-column prop="Names" label="名称" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">{{ (row.Names || []).join(', ') || row.ID?.slice(0,12) }}</template>
          </el-table-column>
          <el-table-column prop="Image" label="镜像" min-width="160" show-overflow-tooltip />
          <el-table-column label="状态" width="120">
            <template #default="{ row }">
              <el-tag :type="statusType(row.State)" size="small" effect="dark" round>{{ row.Status || row.State }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="Ports" label="端口映射" min-width="200" show-overflow-tooltip />
          <el-table-column label="操作" width="220">
            <template #default="{ row }">
              <div class="docker-actions">
                <el-button size="small" type="success" v-if="row.State !== 'running'" @click="doAction(row, 'start')">启动</el-button>
                <el-button size="small" type="warning" v-if="row.State === 'running'" @click="doAction(row, 'stop')">停止</el-button>
                <el-button size="small" @click="doAction(row, 'restart')">重启</el-button>
                <el-button size="small" @click="showLogs(row)">日志</el-button>
                <el-button size="small" type="danger" :icon="Delete" @click="doAction(row, 'rm')" />
              </div>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 镜像 -->
      <el-tab-pane label="镜像" name="images">
        <el-table :data="images" stripe v-loading="loading" size="small">
          <el-table-column prop="Repository" label="仓库" min-width="160" show-overflow-tooltip />
          <el-table-column prop="Tag" label="标签" width="120" />
          <el-table-column prop="ID" label="ID" width="120" show-overflow-tooltip>
            <template #default="{ row }">{{ row.ID?.replace('sha256:','').slice(0,12) }}</template>
          </el-table-column>
          <el-table-column prop="Size" label="大小" width="100" />
          <el-table-column prop="CreatedSince" label="创建时间" width="120" />
          <el-table-column label="操作" width="100" fixed="right">
            <template #default="{ row }">
              <el-button size="small" type="danger" :icon="Delete" @click="deleteImage(row)" />
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 网络 -->
      <el-tab-pane label="网络" name="networks">
        <el-table :data="networks" stripe v-loading="loading" size="small">
          <el-table-column prop="Name" label="名称" min-width="180" />
          <el-table-column prop="Driver" label="驱动" width="120" />
          <el-table-column prop="Scope" label="范围" width="100" />
          <el-table-column prop="IPv6" label="IPv6" width="80" />
        </el-table>
      </el-tab-pane>

      <!-- 存储卷 -->
      <el-tab-pane label="存储卷" name="volumes">
        <el-table :data="volumes" stripe v-loading="loading" size="small">
          <el-table-column prop="Name" label="名称" min-width="200" show-overflow-tooltip />
          <el-table-column prop="Driver" label="驱动" width="120" />
          <el-table-column prop="Mountpoint" label="挂载点" min-width="300" show-overflow-tooltip />
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- 日志对话框 -->
    <el-dialog v-model="logDialogVisible" :title="`容器日志 - ${logContainerName}`" width="900px" top="5vh">
      <div class="log-toolbar">
        <el-input-number v-model="logTail" :min="50" :max="2000" :step="50" size="small" />
        <span class="log-tail-hint">显示最后 {{ logTail }} 行</span>
        <el-button size="small" @click="loadLogs">刷新日志</el-button>
      </div>
      <pre class="docker-log-output">{{ logContent || '加载中...' }}</pre>
    </el-dialog>

    <!-- 清理对话框 -->
    <el-dialog v-model="showPruneDialog" title="Docker 系统清理" width="480px">
      <el-alert type="warning" show-icon :closable="false" style="margin-bottom:16px">
        清理将删除所有停止的容器、悬空镜像和未使用的网络/卷，不可恢复。
      </el-alert>
      <el-radio-group v-model="pruneType" style="display:flex;flex-direction:column;gap:10px">
        <el-radio value="all">全部清理（容器 + 镜像 + 网络 + 卷）</el-radio>
        <el-radio value="container">仅清理停止的容器</el-radio>
        <el-radio value="image">仅清理悬空镜像</el-radio>
        <el-radio value="volume">仅清理未使用的卷</el-radio>
        <el-radio value="network">仅清理未使用的网络</el-radio>
      </el-radio-group>
      <template #footer>
        <el-button @click="showPruneDialog = false">取消</el-button>
        <el-button type="danger" :loading="pruning" @click="doPrune">确认清理</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Refresh, Delete } from '@element-plus/icons-vue'
import api from '../../api'
import { ElMessage, ElMessageBox } from 'element-plus'

const servers = ref([])
const serverId = ref('')
const loading = ref(false)
const activeTab = ref('containers')
const dockerInfo = ref(null)

const containers = ref([])
const images = ref([])
const networks = ref([])
const volumes = ref([])

const logDialogVisible = ref(false)
const logContent = ref('')
const logContainerName = ref('')
const logTail = ref(200)
const logContainerId = ref('')

const showPruneDialog = ref(false)
const pruneType = ref('all')
const pruning = ref(false)

onMounted(async () => {
  const res = await api.get('/api/servers')
  if (res.code === 0) servers.value = res.data
})

function onServerChange() {
  dockerInfo.value = null
  containers.value = []
  images.value = []
  networks.value = []
  volumes.value = []
  if (serverId.value) loadAll()
}

async function loadAll() {
  if (!serverId.value) return
  loading.value = true
  try {
    await Promise.all([loadInfo(), loadCurrentTab()])
  } finally { loading.value = false }
}

async function loadInfo() {
  const res = await api.post('/api/docker/info', { server_id: serverId.value })
  if (res.code === 0) dockerInfo.value = res.data
}

async function loadCurrentTab() {
  const loaders = { containers: loadContainers, images: loadImages, networks: loadNetworks, volumes: loadVolumes }
  await loaders[activeTab.value]?.()
}

function onTabChange() { if (serverId.value) loadCurrentTab() }

async function loadContainers() {
  const res = await api.post('/api/docker/containers', { server_id: serverId.value })
  if (res.code === 0) containers.value = res.data
}

async function loadImages() {
  const res = await api.post('/api/docker/images', { server_id: serverId.value })
  if (res.code === 0) images.value = res.data
}

async function loadNetworks() {
  const res = await api.post('/api/docker/networks', { server_id: serverId.value })
  if (res.code === 0) networks.value = res.data
}

async function loadVolumes() {
  const res = await api.post('/api/docker/volumes', { server_id: serverId.value })
  if (res.code === 0) volumes.value = res.data
}

function statusType(state) {
  if (state === 'running') return 'success'
  if (state === 'exited') return 'info'
  if (state === 'paused') return 'warning'
  return 'danger'
}

async function doAction(row, action) {
  const id = row.ID || row.Id || row.Names?.[0]
  if (!id) return
  const actionText = { start: '启动', stop: '停止', restart: '重启', rm: '删除' }[action]
  if (action === 'rm') {
    await ElMessageBox.confirm(`确定删除容器 ${(row.Names || [id])[0]}？`, '确认', { type: 'warning' })
  }
  const res = await api.post(`/api/docker/containers/${encodeURIComponent(id)}/action`, { server_id: serverId.value, action })
  ElMessage[res.code === 0 ? 'success' : 'error'](res.message || actionText + (res.code === 0 ? '成功' : '失败'))
  if (res.code === 0) loadContainers()
}

async function deleteImage(row) {
  const id = row.ID?.replace('sha256:', '') || row.ID
  await ElMessageBox.confirm(`确定删除镜像 ${row.Repository}:${row.Tag}？`, '确认', { type: 'warning' })
  const res = await api.post(`/api/docker/images/${encodeURIComponent(id)}/delete`, { server_id: serverId.value })
  ElMessage[res.code === 0 ? 'success' : 'error'](res.message)
  if (res.code === 0) loadImages()
}

async function showLogs(row) {
  logContainerId.value = row.ID || row.Id || row.Names?.[0]
  logContainerName.value = (row.Names || [logContainerId.value])[0]
  logContent.value = ''
  logDialogVisible.value = true
  await loadLogs()
}

async function loadLogs() {
  const res = await api.post(`/api/docker/containers/${encodeURIComponent(logContainerId.value)}/logs`, { server_id: serverId.value, tail: logTail.value })
  if (res.code === 0) logContent.value = res.data
  else ElMessage.error(res.message)
}

async function doPrune() {
  pruning.value = true
  try {
    const res = await api.post('/api/docker/prune', { server_id: serverId.value, type: pruneType.value })
    ElMessage[res.code === 0 ? 'success' : 'error'](res.message)
    if (res.code === 0) { showPruneDialog.value = false; loadAll() }
  } finally { pruning.value = false }
}
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; gap: 12px; }
.toolbar-right { display: flex; gap: 10px; }

.info-cards {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px;
}
.info-card {
  padding: 14px 18px; background: var(--surface); border: 1px solid var(--border-color);
  border-left: 3px solid var(--primary-color);
  border-radius: var(--radius-md); box-shadow: var(--card-shadow); display: flex; flex-direction: column; gap: 4px;
  transition: transform 0.2s, box-shadow 0.2s;
}
.info-card:hover { transform: translateY(-2px); box-shadow: var(--card-shadow-hover); }
.info-card:nth-child(2) { border-left-color: #7257cf; }
.info-card:nth-child(3) { border-left-color: #c47a16; }
.info-card:nth-child(4) { border-left-color: #367bd5; }
.info-card span { color: var(--text-muted); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }
.info-card strong { font-size: 22px; font-weight: 750; color: var(--text-primary); }
.info-card em { font-style: normal; color: var(--text-muted); font-size: 11px; }

.log-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.docker-actions { display: flex; flex-wrap: wrap; gap: 4px; max-width: 200px; overflow: hidden; }
.log-tail-hint { color: var(--text-muted); font-size: 12px; }
.docker-log-output {
  max-height: 500px; overflow: auto; padding: 16px; border-radius: var(--radius-sm);
  background: #0b1214; color: #d8dddc; font-size: 12px; line-height: 1.6;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre-wrap; word-break: break-all;
}

@media (max-width: 900px) {
  .info-cards { grid-template-columns: repeat(2, 1fr); }
}
</style>
