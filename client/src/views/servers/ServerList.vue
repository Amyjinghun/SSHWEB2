<template>
  <div class="page-container">
    <el-card shadow="hover">
      <div class="toolbar">
        <div class="toolbar-left">
          <el-input v-model="keyword" placeholder="搜索名称/IP/备注" style="width:220px" clearable @clear="loadData" @keyup.enter="loadData">
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-select v-model="groupId" placeholder="选择分组" clearable style="width:150px" @change="loadData">
            <el-option v-for="g in groups" :key="g.id" :label="g.name" :value="g.id" />
          </el-select>
          <el-select v-model="statusFilter" placeholder="状态" clearable style="width:120px" @change="loadData">
            <el-option label="在线" value="online" />
            <el-option label="离线" value="offline" />
            <el-option label="未知" value="unknown" />
          </el-select>
        </div>
        <div class="toolbar-actions">
          <el-button @click="showImportDialog = true"><el-icon><Upload /></el-icon>导入配置</el-button>
          <el-dropdown split-button type="success" @click="exportServers('csv')" @command="exportServers">
            <el-icon><Download /></el-icon>导出配置
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="csv">导出 CSV（不含明文凭据）</el-dropdown-item>
                <el-dropdown-item command="json">导出 JSON（不含明文凭据）</el-dropdown-item>
                <el-dropdown-item divided command="csv:credentials">导出 CSV（含明文凭据，仅超级管理员）</el-dropdown-item>
                <el-dropdown-item command="json:credentials">导出 JSON（含明文凭据，仅超级管理员）</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button type="primary" @click="$router.push('/servers/add')"><el-icon><Plus /></el-icon>添加服务器</el-button>
        </div>
      </div>

      <el-alert
        title="系统版本会在服务器状态监控或测试连接后自动采集；如果导入配置里包含 os_info/系统版本，也会先显示导入值。"
        type="info"
        show-icon
        :closable="false"
        class="list-tip"
      />

      <el-table :data="servers" stripe v-loading="loading" @selection-change="onSelection">
        <el-table-column type="selection" width="50" />
        <el-table-column prop="name" label="名称" min-width="140" show-overflow-tooltip />
        <el-table-column prop="host" label="IP地址" min-width="150" show-overflow-tooltip />
        <el-table-column prop="port" label="端口" width="80" />
        <el-table-column prop="username" label="用户" width="100" show-overflow-tooltip />
        <el-table-column prop="group_name" label="分组" width="110" show-overflow-tooltip />
        <el-table-column prop="os_info" label="系统版本" min-width="190" show-overflow-tooltip>
          <template #default="{ row }">{{ row.os_info || '-' }}</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status==='online'?'success':row.status==='offline'?'danger':'info'" size="small" effect="dark" round>
              {{ row.status==='online'?'在线':row.status==='offline'?'离线':'未知' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="cpu_usage" label="CPU" width="80">
          <template #default="{ row }">
            <span v-if="row.cpu_usage != null" :class="row.cpu_usage > 90 ? 'usage-high' : row.cpu_usage > 70 ? 'usage-warn' : 'usage-normal'">{{ row.cpu_usage }}%</span>
            <span v-else class="usage-none">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="memory_usage" label="内存" width="80">
          <template #default="{ row }">
            <span v-if="row.memory_usage != null" :class="row.memory_usage > 90 ? 'usage-high' : row.memory_usage > 70 ? 'usage-warn' : 'usage-normal'">{{ row.memory_usage }}%</span>
            <span v-else class="usage-none">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="disk_usage" label="磁盘" width="80">
          <template #default="{ row }">
            <span v-if="row.disk_usage != null" :class="row.disk_usage > 90 ? 'usage-high' : row.disk_usage > 70 ? 'usage-warn' : 'usage-normal'">{{ row.disk_usage }}%</span>
            <span v-else class="usage-none">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="expires_at" label="到期日期" width="120">
          <template #default="{ row }">{{ row.expires_at || '-' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <div class="row-actions">
              <el-button size="small" type="primary" @click="openTerminal(row)">终端</el-button>
              <el-button size="small" @click="execCmd(row)">执行</el-button>
              <el-dropdown size="small" trigger="click">
                <el-button size="small">更多<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item @click="testConn(row)">测试连接</el-dropdown-item>
                    <el-dropdown-item @click="refreshMonitor(row)">采集状态</el-dropdown-item>
                    <el-dropdown-item @click="$router.push('/servers/edit/' + row.id)">编辑</el-dropdown-item>
                    <el-dropdown-item v-for="m in 12" :key="m" @click="renewServer(row, m)">续费 {{ m }} 个月</el-dropdown-item>
                    <el-dropdown-item divided @click="deleteServer(row)">删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="showImportDialog" title="导入服务器配置信息" width="760px" destroy-on-close>
      <el-alert type="warning" show-icon :closable="false" class="import-alert">
        <template #title>
          支持 CSV 或 JSON。CSV 第一行必须是表头，密码/私钥会在后端加密保存。
        </template>
      </el-alert>

      <div class="import-actions">
        <el-button @click="downloadTemplate">下载CSV模板</el-button>
        <label class="file-button">
          选择CSV/JSON文件
          <input type="file" accept=".csv,.json,.txt" @change="readImportFile" />
        </label>
      </div>

      <el-input
        v-model="importContent"
        type="textarea"
        :rows="14"
        placeholder="可直接粘贴CSV或JSON内容。例如：
name,host,port,username,auth_type,password,group_name,tags,expires_at,remark
生产Web-01,1.2.3.4,22,root,password,SSH密码,生产环境,nginx,2026-12-31,备注"
      />

      <div class="import-help">
        <div>常用字段：name、host、port、username、auth_type、password、private_key、group_name、tags、expires_at、os_info、remark</div>
        <div>中文表头也支持：服务器名称、主机地址、端口、用户名、密码、分组、标签、到期日期、系统版本、备注</div>
      </div>

      <div v-if="importResult" class="import-result">
        <el-divider>导入结果</el-divider>
        <p>总数：{{ importResult.total }}，成功：{{ importResult.success }}，失败：{{ importResult.failed }}</p>
        <el-table v-if="importResult.errors && importResult.errors.length" :data="importResult.errors" size="small" max-height="180">
          <el-table-column prop="row" label="行号" width="80" />
          <el-table-column prop="message" label="错误原因" />
        </el-table>
      </div>

      <template #footer>
        <el-button @click="showImportDialog = false">取消</el-button>
        <el-button type="primary" :loading="importing" @click="submitImport">开始导入</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showExecDialog" title="快速执行命令" width="600px">
      <el-input v-model="quickCommand" placeholder="输入要执行的命令" />
      <div style="margin-top:12px">
        <el-button type="primary" @click="runQuickCmd" :loading="execLoading">执行</el-button>
      </div>
      <div v-if="execResult" style="margin-top:12px">
        <el-divider>执行结果</el-divider>
        <pre class="output-box">{{ execResult.stdout || execResult.stderr || execResult.message }}</pre>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '../../api'
import { ElMessage, ElMessageBox } from 'element-plus'

const router = useRouter()
const servers = ref([])
const groups = ref([])
const keyword = ref('')
const groupId = ref('')
const statusFilter = ref('')
const loading = ref(false)
const selectedServers = ref([])
const showExecDialog = ref(false)
const quickCommand = ref('')
const execResult = ref(null)
const execLoading = ref(false)
const currentServer = ref(null)
const showImportDialog = ref(false)
const importContent = ref('')
const importResult = ref(null)
const importing = ref(false)

onMounted(() => { loadData(); loadGroups() })

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

async function loadData() {
  loading.value = true
  try {
    const params = {}
    if (keyword.value) params.keyword = keyword.value
    if (groupId.value) params.group_id = groupId.value
    if (statusFilter.value) params.status = statusFilter.value
    const res = await api.get('/api/servers', { params })
    if (res.code === 0) servers.value = res.data.map(s => ({ ...s, testing: false, monitoring: false }))
  } finally {
    loading.value = false
  }
}

async function loadGroups() {
  const res = await api.get('/api/server-groups')
  if (res.code === 0) groups.value = res.data
}

function onSelection(rows) { selectedServers.value = rows }

async function testConn(row) {
  row.testing = true
  const res = await api.post(`/api/servers/${row.id}/test`)
  row.testing = false
  if (res.code === 0) { ElMessage.success('连接成功'); loadData() }
  else ElMessage.error(res.message)
}

async function refreshMonitor(row) {
  row.monitoring = true
  const res = await api.post(`/api/servers/${row.id}/monitor`)
  row.monitoring = false
  if (res.code === 0) { ElMessage.success('状态采集成功'); loadData() }
  else ElMessage.error(res.message || '采集失败')
}

function openTerminal(row) { router.push({ path: '/terminal', query: { server_id: row.id } }) }

function execCmd(row) { currentServer.value = row; quickCommand.value = ''; execResult.value = null; showExecDialog.value = true }

async function runQuickCmd() {
  if (!quickCommand.value) return
  execLoading.value = true
  const res = await api.post('/api/commands/exec', { server_id: currentServer.value.id, command: quickCommand.value })
  execLoading.value = false
  if (res.code === 0) execResult.value = res.data
  else ElMessage.error(res.message)
}

async function deleteServer(row) {
  await ElMessageBox.confirm(`确定删除服务器 "${row.name}" ?`, '确认删除', { type: 'warning' })
  const res = await api.delete(`/api/servers/${row.id}`)
  if (res.code === 0) { ElMessage.success('已删除'); loadData() }
  else ElMessage.error(res.message)
}

async function renewServer(row, months) {
  const res = await api.post(`/api/servers/${row.id}/renew`, { months })
  if (res.code === 0) { ElMessage.success(res.message); loadData() }
  else ElMessage.error(res.message)
}

async function downloadTemplate() {
  const blob = await api.get('/api/servers/import/template', { responseType: 'blob' })
  saveBlob(blob, 'servers_import_template.csv')
}

function buildServerQuery() {
  const query = new URLSearchParams()
  if (keyword.value) query.set('keyword', keyword.value)
  if (groupId.value) query.set('group_id', groupId.value)
  if (statusFilter.value) query.set('status', statusFilter.value)
  if (selectedServers.value.length) {
    query.set('ids', selectedServers.value.map(item => item.id).join(','))
  }
  return query
}

async function exportServers(command = 'csv') {
  const selectedText = selectedServers.value.length ? `已选 ${selectedServers.value.length} 台` : '当前筛选结果'
  const [format, mode] = String(command || 'csv').split(':')
  const includeCredentials = mode === 'credentials'
  try {
    if (includeCredentials) {
      await ElMessageBox.confirm(
        `即将导出${selectedText}的服务器配置，文件将包含 SSH 密码、私钥、私钥密码等明文敏感信息。该操作仅超级管理员可用，下载后务必妥善保存。`,
        '确认导出明文凭据',
        { type: 'warning', confirmButtonText: '确认导出', cancelButtonText: '取消' }
      )
    }
    const query = buildServerQuery()
    query.set('format', format === 'json' ? 'json' : 'csv')
    if (includeCredentials) query.set('include_credentials', '1')
    ElMessage.info(`正在导出${selectedText}的服务器配置${includeCredentials ? '（含明文凭据）' : '（不含明文凭据）'}`)
    const blob = await api.get(`/api/servers/export?${query.toString()}`, { responseType: 'blob' })
    const ext = format === 'json' ? 'json' : 'csv'
    saveBlob(blob, `servers_export.${ext}`)
  } catch (e) {
    // 用户取消导出
  }
}

function readImportFile(event) {
  const file = event.target.files && event.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => { importContent.value = String(reader.result || '') }
  reader.readAsText(file, 'utf-8')
  event.target.value = ''
}

async function submitImport() {
  if (!importContent.value.trim()) return ElMessage.warning('请上传文件或粘贴导入内容')
  importing.value = true
  importResult.value = null
  const res = await api.post('/api/servers/import', { content: importContent.value })
  importing.value = false
  if (res.code === 0) {
    importResult.value = res.data
    ElMessage.success(res.message || '导入完成')
    loadData()
    loadGroups()
  } else {
    ElMessage.error(res.message || '导入失败')
  }
}
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; gap: 12px; }
.toolbar-left { display: flex; gap: 12px; flex-wrap: wrap; }
.toolbar-actions { display: flex; gap: 10px; }
.row-actions { display: flex; gap: 8px; align-items: center; }
.list-tip { margin-bottom: 14px; }

.usage-normal { color: #22c55e; font-weight: 600; font-size: 13px; }
.usage-warn { color: #f59e0b; font-weight: 600; font-size: 13px; }
.usage-high { color: #ef4444; font-weight: 700; font-size: 13px; }
.usage-none { color: #94a3b8; }

.import-alert { margin-bottom: 14px; }
.import-actions { display: flex; gap: 12px; align-items: center; margin-bottom: 14px; }
.file-button { position: relative; display: inline-flex; align-items: center; justify-content: center; height: 32px; padding: 0 14px; border-radius: 6px; border: 1px solid #dcdfe6; color: #606266; cursor: pointer; font-size: 14px; background: #fff; transition: all 0.15s; }
.file-button:hover { color: #4f6ef7; border-color: #4f6ef7; background: rgba(79, 110, 247, 0.04); }
.file-button input { display: none; }
.import-help { margin-top: 10px; color: #94a3b8; line-height: 1.8; font-size: 13px; }
.import-result { margin-top: 8px; }
@media (max-width: 768px) {
  .toolbar { align-items: flex-start; flex-direction: column; }
  .toolbar-actions { width: 100%; justify-content: flex-start; }
}
</style>
