<template>
  <div class="page-container">
    <!-- 工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <el-input v-model="keyword" placeholder="搜索名称/IP/备注" style="width:220px" clearable @clear="loadData" @keyup.enter="loadData">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="groupId" placeholder="全部分组" clearable style="width:140px" @change="loadData">
          <el-option v-for="g in groups" :key="g.id" :label="g.name" :value="g.id" />
        </el-select>
        <el-select v-model="statusFilter" placeholder="全部状态" clearable style="width:110px" @change="loadData">
          <el-option label="在线" value="online" />
          <el-option label="离线" value="offline" />
          <el-option label="未知" value="unknown" />
        </el-select>
      </div>
      <div class="toolbar-actions">
        <el-button @click="showImportDialog = true"><el-icon><Upload /></el-icon>导入</el-button>
        <el-dropdown split-button type="success" @click="exportServers('json:credentials')" @command="exportServers">
          <el-icon><Download /></el-icon>导出
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="json:credentials">JSON 迁移包（含密码）</el-dropdown-item>
              <el-dropdown-item command="csv:credentials">CSV 迁移包（含密码）</el-dropdown-item>
              <el-dropdown-item divided command="json">JSON（不含密码）</el-dropdown-item>
              <el-dropdown-item command="csv">CSV（不含密码）</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button type="primary" @click="$router.push('/servers/add')"><el-icon><Plus /></el-icon>添加服务器</el-button>
      </div>
    </div>

    <!-- 统计概览 -->
    <div class="stats-row">
      <div class="stat-item"><span>总节点</span><strong>{{ servers.length }}</strong></div>
      <div class="stat-item success"><span>在线</span><strong>{{ onlineCount }}</strong></div>
      <div class="stat-item muted"><span>离线</span><strong>{{ offlineCount }}</strong></div>
      <div class="stat-item danger"><span>高负载</span><strong>{{ criticalCount }}</strong></div>
    </div>

    <!-- 服务器卡片网格 -->
    <div v-if="!loading && !servers.length" class="empty-state">
      <el-icon :size="40"><Box /></el-icon>
      <p>暂无服务器，点击「添加服务器」开始管理</p>
    </div>

    <div v-else class="server-grid" v-loading="loading">
      <div
        v-for="row in servers"
        :key="row.id"
        class="server-card"
        :class="cardClass(row)"
      >
        <!-- 卡片头部 -->
        <div class="card-head">
          <div class="card-head-info">
            <div class="card-title-row">
              <strong :title="row.name">{{ row.name }}</strong>
              <span v-if="row.group_name" class="card-tag">{{ row.group_name }}</span>
            </div>
            <div class="card-sub">
              <span class="status-dot" :class="row.status"></span>
              <span class="card-host" :title="row.host + ':' + row.port">{{ row.host }}:{{ row.port }}</span>
              <span class="card-user">{{ row.username }}</span>
            </div>
          </div>
        </div>

        <!-- 指标进度条 -->
        <div class="card-metrics">
          <div class="metric-item">
            <div class="metric-top"><span>CPU</span><strong :class="usageClass(row.cpu_usage)">{{ pct(row.cpu_usage) }}%<em v-if="row._sys?.cpu_cores"> {{ row._sys.cpu_cores }}核</em></strong></div>
            <div class="metric-bar"><div :style="{ width: pct(row.cpu_usage) + '%', background: usageColor(row.cpu_usage) }"></div></div>
          </div>
          <div class="metric-item">
            <div class="metric-top"><span>内存</span><strong :class="usageClass(row.memory_usage)">{{ pct(row.memory_usage) }}%<em v-if="row.mem_total_mb"> {{ mbToGB(row.mem_total_mb) }}</em></strong></div>
            <div class="metric-bar"><div :style="{ width: pct(row.memory_usage) + '%', background: usageColor(row.memory_usage) }"></div></div>
          </div>
          <div class="metric-item">
            <div class="metric-top"><span>磁盘</span><strong :class="usageClass(row.disk_usage)">{{ pct(row.disk_usage) }}%<em v-if="row.disk_total_mb"> {{ mbToGB(row.disk_total_mb) }}</em></strong></div>
            <div class="metric-bar"><div :style="{ width: pct(row.disk_usage) + '%', background: usageColor(row.disk_usage) }"></div></div>
          </div>
        </div>

        <!-- 详情 -->
        <div class="card-details">
          <div class="detail-cell">
            <span>系统</span>
            <strong :title="row.os_info">{{ row.os_info || '-' }}</strong>
          </div>
          <div class="detail-cell">
            <span>到期</span>
            <strong :class="expiryClass(row.expires_at)">{{ row.expires_at || '永久' }}</strong>
          </div>
        </div>

        <!-- 操作 -->
        <div class="card-foot">
          <el-button size="small" type="primary" @click="openTerminal(row)">终端</el-button>
          <el-button size="small" @click="execCmd(row)">执行</el-button>
          <el-button size="small" text :loading="row.testing" @click="testConn(row)">测试</el-button>
          <el-dropdown trigger="click" @command="cmd => handleCardAction(cmd, row)">
            <el-button size="small" text :icon="More" />
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="test" :disabled="row.testing"><el-icon><Connection /></el-icon>测试连接</el-dropdown-item>
                <el-dropdown-item command="monitor" :disabled="row.monitoring"><el-icon><DataLine /></el-icon>采集状态</el-dropdown-item>
                <el-dropdown-item command="edit"><el-icon><Edit /></el-icon>编辑</el-dropdown-item>
                <el-dropdown-item divided v-for="m in [1,3,6,12]" :key="m" :command="'renew_' + m">续费 {{ m }} 个月</el-dropdown-item>
                <el-dropdown-item divided command="delete"><el-icon><Delete /></el-icon>删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </div>

    <!-- 导入对话框 -->
    <el-dialog v-model="showImportDialog" title="导入服务器配置" width="760px" destroy-on-close>
      <el-alert type="warning" show-icon :closable="false" class="import-alert">
        <template #title>支持 CSV 或 JSON。密码/私钥会在后端加密保存。</template>
      </el-alert>
      <div class="import-actions">
        <el-button @click="downloadTemplate">下载CSV模板</el-button>
        <label class="file-button">选择文件<input type="file" accept=".csv,.json,.txt" @change="readImportFile" /></label>
      </div>
      <el-input v-model="importContent" type="textarea" :rows="14" placeholder="可直接粘贴CSV或JSON内容" />
      <div class="import-help">
        <div>常用字段：name、host、port、username、auth_type、password、private_key、group_name、tags、expires_at</div>
      </div>
      <div v-if="importResult" class="import-result">
        <el-divider>导入结果</el-divider>
        <p>总数：{{ importResult.total }}，成功：{{ importResult.success }}，失败：{{ importResult.failed }}</p>
      </div>
      <template #footer>
        <el-button @click="showImportDialog = false">取消</el-button>
        <el-button type="primary" :loading="importing" @click="submitImport">开始导入</el-button>
      </template>
    </el-dialog>

    <!-- 快速执行 -->
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
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { More, Search, Upload, Download, Plus, Box, Connection, Edit, Delete, DataLine } from '@element-plus/icons-vue'
import api from '../../api'
import { ElMessage, ElMessageBox } from 'element-plus'

const router = useRouter()
const servers = ref([])
const groups = ref([])
const keyword = ref('')
const groupId = ref('')
const statusFilter = ref('')
const loading = ref(false)
const showExecDialog = ref(false)
const quickCommand = ref('')
const execResult = ref(null)
const execLoading = ref(false)
const currentServer = ref(null)
const showImportDialog = ref(false)
const importContent = ref('')
const importResult = ref(null)
const importing = ref(false)

const onlineCount = computed(() => servers.value.filter(s => s.status === 'online').length)
const offlineCount = computed(() => servers.value.filter(s => s.status === 'offline').length)
const criticalCount = computed(() => servers.value.filter(s => s.cpu_usage >= 90 || s.memory_usage >= 90 || s.disk_usage >= 90).length)

onMounted(() => { loadData(); loadGroups() })

async function loadData() {
  loading.value = true
  try {
    const params = {}
    if (keyword.value) params.keyword = keyword.value
    if (groupId.value) params.group_id = groupId.value
    if (statusFilter.value) params.status = statusFilter.value
    const res = await api.get('/api/servers', { params })
    if (res.code === 0) servers.value = res.data.map(s => {
      let sysInfo = s.system_info
      if (typeof sysInfo === 'string') { try { sysInfo = JSON.parse(sysInfo) } catch { sysInfo = {} } }
      return { ...s, testing: false, monitoring: false, _sys: sysInfo || {} }
    })
  } finally { loading.value = false }
}

async function loadGroups() {
  const res = await api.get('/api/server-groups')
  if (res.code === 0) groups.value = res.data
}

function pct(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.min(100, Math.round(n * 10) / 10) : 0 }
function mbToGB(mb) { const n = Number(mb); if (!n || n <= 0) return ''; return n >= 1024 ? (n / 1024).toFixed(0) + 'GB' : n + 'MB' }
function usageColor(v) { const n = pct(v); if (n >= 90) return '#ef4444'; if (n >= 70) return '#f59e0b'; return '#0891b2' }
function usageClass(v) { const n = pct(v); if (n >= 90) return 'high'; if (n >= 70) return 'warn'; return 'normal' }
function cardClass(row) {
  if (row.status !== 'online') return 'is-offline'
  if (pct(row.cpu_usage) >= 90 || pct(row.memory_usage) >= 90 || pct(row.disk_usage) >= 90) return 'is-critical'
  if (pct(row.cpu_usage) >= 70 || pct(row.memory_usage) >= 70 || pct(row.disk_usage) >= 70) return 'is-warning'
  return 'is-normal'
}
function expiryClass(date) {
  if (!date) return ''
  const days = Math.ceil((new Date(date) - new Date()) / 86400000)
  if (days < 0) return 'expired'
  if (days <= 30) return 'warn'
  return ''
}

function handleCardAction(cmd, row) {
  if (cmd === 'test') testConn(row)
  else if (cmd === 'monitor') refreshMonitor(row)
  else if (cmd === 'edit') router.push('/servers/edit/' + row.id)
  else if (cmd === 'delete') deleteServer(row)
  else if (cmd.startsWith('renew_')) renewServer(row, Number(cmd.slice(6)))
}

async function testConn(row) {
  row.testing = true
  const res = await api.post(`/api/servers/${row.id}/test`)
  row.testing = false
  if (res.code === 0) { ElMessage.success('连接成功'); loadData() }
  else {
    const d = res.data?.diagnostics
    const lines = [res.message, d?.tcp ? `TCP：${d.tcp.ok ? '成功' : '失败'} - ${d.tcp.message}` : '', d?.ssh ? `SSH：${d.ssh.ok ? '成功' : '失败'} - ${d.ssh.message}` : ''].filter(Boolean)
    ElMessageBox.alert(lines.join('\n'), '测试连接失败', { type: 'error' })
  }
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
  const res = await api.post('/api/commands/exec', { server_id: currentServer.value.id, command: quickCommand.value }, { timeout: 70000 })
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

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = filename
  document.body.appendChild(link); link.click(); link.remove()
  URL.revokeObjectURL(url)
}

async function downloadTemplate() {
  const blob = await api.get('/api/servers/import/template', { responseType: 'blob' })
  saveBlob(blob, 'servers_import_template.csv')
}

async function exportServers(command = 'json:credentials') {
  const [format, mode] = String(command || 'csv').split(':')
  const includeCredentials = mode === 'credentials'
  try {
    if (includeCredentials) {
      await ElMessageBox.confirm('即将导出当前筛选结果，文件含 SSH 密码/私钥等明文敏感信息。请妥善保存。', '确认导出完整配置', { type: 'warning', confirmButtonText: '导出', cancelButtonText: '取消' })
    }
    const query = new URLSearchParams()
    if (keyword.value) query.set('keyword', keyword.value)
    if (groupId.value) query.set('group_id', groupId.value)
    if (statusFilter.value) query.set('status', statusFilter.value)
    query.set('format', format === 'json' ? 'json' : 'csv')
    if (includeCredentials) query.set('include_credentials', '1')
    const blob = await api.get(`/api/servers/export?${query.toString()}`, { responseType: 'blob' })
    const ext = format === 'json' ? 'json' : 'csv'
    saveBlob(blob, includeCredentials ? `servers_migration.${ext}` : `servers_export.${ext}`)
  } catch (e) { /* 用户取消 */ }
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
  if (res.code === 0) { importResult.value = res.data; ElMessage.success(res.message || '导入完成'); loadData(); loadGroups() }
  else ElMessage.error(res.message || '导入失败')
}
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; gap: 12px; flex-wrap: wrap; }
.toolbar-left { display: flex; gap: 12px; flex-wrap: wrap; }
.toolbar-actions { display: flex; gap: 10px; flex-wrap: wrap; }

/* 统计概览 */
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 20px;
}
.stat-item {
  padding: 14px 18px;
  background: var(--surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--card-shadow);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.stat-item span { color: var(--text-muted); font-size: 11px; font-weight: 600; }
.stat-item strong { font-size: 24px; font-weight: 750; color: var(--text-primary); letter-spacing: -0.03em; }
.stat-item.success strong { color: #16a34a; }
.stat-item.muted strong { color: var(--text-muted); }
.stat-item.danger strong { color: #ef4444; }

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: var(--text-muted);
  gap: 12px;
}
.empty-state p { font-size: 14px; margin: 0; }

/* 列表行 */
.server-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.server-card {
  display: grid;
  grid-template-columns: minmax(200px, 1.4fr) minmax(260px, 1.8fr) minmax(150px, 0.9fr) auto;
  align-items: center;
  background: var(--surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--card-shadow);
  overflow: hidden;
  transition: box-shadow var(--transition-normal), border-color var(--transition-normal);
}
.server-card:hover {
  box-shadow: var(--card-shadow-hover);
  border-color: var(--border-strong);
}
.server-card.is-offline { opacity: 0.65; }
.server-card.is-critical { border-left: 3px solid #ef4444; }
.server-card.is-warning { border-left: 3px solid #f59e0b; }
.server-card.is-normal { border-left: 3px solid #0891b2; }

/* 第 1 列：头部信息 */
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  gap: 8px;
  border-right: 1px solid var(--border-color);
}
.card-head-info { min-width: 0; flex: 1; }
.card-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.card-title-row strong {
  font-size: 14px;
  font-weight: 650;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-tag {
  flex-shrink: 0;
  padding: 1px 7px;
  background: var(--primary-bg);
  color: var(--primary-color);
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
}
.card-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 11px;
}
.card-host { font-family: 'JetBrains Mono', monospace; font-size: 11px; }
.card-user { color: var(--text-muted); font-size: 11px; }

/* 状态点 */
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--text-muted);
}
.status-dot.online { background: #16a34a; box-shadow: 0 0 6px rgba(22,163,74,0.4); }
.status-dot.offline { background: #ef4444; }
.status-dot.unknown { background: var(--text-muted); }

/* 第 2 列：指标横向排列 */
.card-metrics {
  display: flex;
  flex-direction: row;
  gap: 16px;
  padding: 10px 16px;
  border-right: 1px solid var(--border-color);
}
.metric-item { flex: 1; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.metric-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.metric-top span { color: var(--text-muted); font-size: 10px; font-weight: 600; }
.metric-top strong { font-size: 12px; font-weight: 700; }
.metric-top strong em { font-style: normal; font-size: 10px; color: var(--text-muted); font-weight: 500; margin-left: 3px; }
.metric-top strong.high { color: #ef4444; }
.metric-top strong.warn { color: #f59e0b; }
.metric-top strong.normal { color: var(--text-primary); }
.metric-bar {
  height: 3px;
  background: var(--border-color);
  border-radius: 99px;
  overflow: hidden;
}
.metric-bar > div {
  height: 100%;
  border-radius: inherit;
  transition: width 0.3s ease;
}

/* 第 3 列：详情 */
.card-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 16px;
  border-right: 1px solid var(--border-color);
}
.detail-cell { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.detail-cell span { color: var(--text-muted); font-size: 10px; font-weight: 600; flex-shrink: 0; }
.detail-cell strong {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-cell strong.expired { color: #ef4444; }
.detail-cell strong.warn { color: #f59e0b; }

/* 第 4 列：操作 */
.card-foot {
  display: flex;
  gap: 6px;
  padding: 10px 14px;
}

/* 导入 */
.import-alert { margin-bottom: 14px; }
.import-actions { display: flex; gap: 12px; align-items: center; margin-bottom: 14px; }
.file-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  padding: 0 14px;
  height: 32px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 14px;
  background: var(--surface);
}
.file-button:hover { color: var(--primary-color); border-color: var(--primary-color); }
.file-button input { display: none; }
.import-help { margin-top: 10px; color: var(--text-muted); line-height: 1.8; font-size: 12px; }
.import-result { margin-top: 8px; }

/* 响应式：窄屏退回竖向卡片 */
@media (max-width: 1100px) {
  .server-card {
    grid-template-columns: 1fr;
  }
  .card-head, .card-metrics, .card-details { border-right: none; border-bottom: 1px solid var(--border-color); }
  .card-metrics { flex-direction: column; gap: 8px; }
  .card-details { flex-direction: row; gap: 16px; }
}

@media (max-width: 768px) {
  .stats-row { grid-template-columns: repeat(2, 1fr); }
  .card-details { flex-direction: column; }
}
</style>
