<template>
  <div class="page-container">
    <el-card shadow="hover">
      <div class="toolbar">
        <el-select v-model="serverId" placeholder="选择服务器" filterable style="width: 320px" @change="loadFiles">
          <el-option v-for="s in servers" :key="s.id" :label="`${s.name} (${s.host})`" :value="s.id" />
        </el-select>
        <div class="toolbar-actions">
          <el-button @click="goUp" :disabled="!currentPath || currentPath === '/'">上级目录</el-button>
          <el-button type="primary" @click="showUploadDialog = true" :disabled="!serverId"><el-icon><Upload /></el-icon>上传</el-button>
          <el-button @click="showNewDialog = true" :disabled="!serverId"><el-icon><FolderAdd /></el-icon>新建</el-button>
        </div>
      </div>

      <div class="path-box">
        <el-input v-model="pathInput" class="path-input" placeholder="输入服务器绝对路径，例如 /root、/etc/nginx/nginx.conf、/var/log" @keyup.enter="openPath">
          <template #prepend>服务器路径</template>
        </el-input>
        <el-button type="primary" @click="openPath" :disabled="!serverId">打开路径</el-button>
        <el-button @click="refresh" :disabled="!serverId">刷新</el-button>
      </div>

      <div class="quick-paths">
        <span class="quick-label">快捷路径：</span>
        <el-button v-for="p in quickPaths" :key="p" size="small" text type="primary" @click="jumpTo(p)">{{ p }}</el-button>
      </div>

      <el-alert
        v-if="currentType === 'file'"
        type="info"
        show-icon
        :closable="false"
        style="margin-bottom: 12px"
        title="当前路径是文件，已自动打开查看/编辑窗口。"
      />

      <el-table :data="files" stripe v-loading="loading" @row-dblclick="enterDir">
        <el-table-column prop="permissions" label="权限" width="120" />
        <el-table-column label="名称" min-width="320">
          <template #default="{ row }">
            <el-icon v-if="row.isDir" style="color:#E6A23C;margin-right:4px"><Folder /></el-icon>
            <el-icon v-else style="color:#409EFF;margin-right:4px"><Document /></el-icon>
            <span style="cursor:pointer" @click="row.isDir ? enterDir(row) : viewFile(row)">{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="size" label="大小" width="110">
          <template #default="{ row }">{{ row.isDir ? '-' : formatSize(row.size) }}</template>
        </el-table-column>
        <el-table-column prop="owner" label="UID" width="80" />
        <el-table-column prop="group" label="GID" width="80" />
        <el-table-column prop="modifyTime" label="修改时间" width="180" />
        <el-table-column label="操作" width="270">
          <template #default="{ row }">
            <el-button v-if="!row.isDir" size="small" @click="viewFile(row)">查看</el-button>
            <el-button v-if="!row.isDir" size="small" @click="editFile(row)">编辑</el-button>
            <el-button v-if="!row.isDir" size="small" type="success" @click="downloadFile(row)">下载</el-button>
            <el-button size="small" type="danger" @click="deleteFile(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="editVisible" title="查看 / 编辑文件" width="860px" :close-on-click-modal="false">
      <div class="edit-path">{{ editPath }}</div>
      <el-input v-model="editContent" type="textarea" :rows="24" class="code-editor" />
      <template #footer>
        <el-button @click="editVisible=false">取消</el-button>
        <el-button type="primary" @click="saveFile">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showUploadDialog" title="上传文件" width="460px">
      <el-upload :auto-upload="false" :on-change="onFileChange" :limit="1"><el-button type="primary">选择文件</el-button></el-upload>
      <div class="hint">上传到目录：{{ directoryPath }}</div>
      <template #footer><el-button @click="showUploadDialog=false">取消</el-button><el-button type="primary" @click="uploadSelectedFile">上传</el-button></template>
    </el-dialog>

    <el-dialog v-model="showNewDialog" title="新建" width="420px">
      <el-radio-group v-model="newType"><el-radio value="file">文件</el-radio><el-radio value="dir">文件夹</el-radio></el-radio-group>
      <el-input v-model="newName" placeholder="名称" style="margin-top:12px" />
      <div class="hint">创建位置：{{ directoryPath }}</div>
      <template #footer><el-button @click="showNewDialog=false">取消</el-button><el-button type="primary" @click="createNew">创建</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '../../api'
import { ElMessage, ElMessageBox } from 'element-plus'

const servers = ref([])
const serverId = ref('')
const currentPath = ref('/')
const pathInput = ref('/')
const currentType = ref('directory')
const files = ref([])
const loading = ref(false)
const editVisible = ref(false)
const editPath = ref('')
const editContent = ref('')
const showUploadDialog = ref(false)
const showNewDialog = ref(false)
const selectedUploadFile = ref(null)
const newType = ref('file')
const newName = ref('')
const quickPaths = ['/', '/root', '/home', '/etc', '/etc/nginx', '/var/log', '/tmp', '/usr/local']

const directoryPath = computed(() => currentType.value === 'directory' ? currentPath.value : parentPath(currentPath.value))

onMounted(async () => {
  const r = await api.get('/api/servers')
  if (r.code === 0) servers.value = r.data
})

function normalizePath(p) {
  let value = String(p || '/').trim()
  if (!value) value = '/'
  value = value.replace(/\\/g, '/').replace(/\/+/g, '/')
  if (!value.startsWith('/')) value = '/' + value
  if (value.length > 1 && value.endsWith('/')) value = value.slice(0, -1)
  return value
}

function joinPath(base, name) {
  const b = normalizePath(base)
  return b === '/' ? `/${name}` : `${b}/${name}`
}

function parentPath(p) {
  const value = normalizePath(p)
  if (value === '/') return '/'
  const parts = value.split('/').filter(Boolean)
  parts.pop()
  return '/' + parts.join('/') || '/'
}

async function loadFiles(path = currentPath.value) {
  if (!serverId.value) return
  loading.value = true
  try {
    const targetPath = normalizePath(path)
    const res = await api.get('/api/files/list', { params: { server_id: serverId.value, path: targetPath } })
    if (res.code === 0) {
      currentPath.value = res.data.path
      pathInput.value = res.data.path
      currentType.value = res.data.type || 'directory'
      files.value = res.data.files || []
      if (res.data.type === 'file' && res.data.file) {
        await openFilePath(res.data.path)
      }
    } else {
      ElMessage.error(res.message || '读取目录失败')
    }
  } catch (error) {
    ElMessage.error(error.message || '读取目录失败')
  } finally {
    loading.value = false
  }
}

function openPath() { loadFiles(pathInput.value) }
function refresh() { loadFiles(currentPath.value) }
function jumpTo(path) { pathInput.value = path; loadFiles(path) }
function enterDir(row) { if (row.isDir) loadFiles(row.path || joinPath(currentPath.value, row.name)) }
function goUp() { loadFiles(parentPath(currentPath.value)) }

function formatSize(bytes) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i]
}

async function openFilePath(filepath) {
  const res = await api.get('/api/files/read', { params: { server_id: serverId.value, filepath } })
  if (res.code === 0) {
    editPath.value = filepath
    editContent.value = res.data.content
    editVisible.value = true
  } else {
    ElMessage.error(res.message || '读取文件失败')
  }
}

function viewFile(row) { openFilePath(row.path || joinPath(currentPath.value, row.name)) }
function editFile(row) { viewFile(row) }

async function saveFile() {
  const res = await api.post('/api/files/write', { server_id: serverId.value, path: editPath.value, content: editContent.value })
  if (res.code === 0) {
    ElMessage.success('保存成功')
    editVisible.value = false
    loadFiles(directoryPath.value)
  } else {
    ElMessage.error(res.message || '保存失败')
  }
}

function onFileChange(file) { selectedUploadFile.value = file.raw }

async function uploadSelectedFile() {
  if (!serverId.value) return ElMessage.warning('请选择服务器')
  if (!selectedUploadFile.value) return ElMessage.warning('请选择文件')
  const formData = new FormData()
  const targetPath = joinPath(directoryPath.value, selectedUploadFile.value.name)
  formData.append('file', selectedUploadFile.value)
  formData.append('server_id', serverId.value)
  formData.append('path', targetPath)
  const res = await api.post('/api/files/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
  if (res.code === 0) {
    ElMessage.success('上传成功')
    showUploadDialog.value = false
    selectedUploadFile.value = null
    loadFiles(directoryPath.value)
  } else {
    ElMessage.error(res.message || '上传失败')
  }
}

function downloadFile(row) {
  const filepath = row.path || joinPath(currentPath.value, row.name)
  const token = localStorage.getItem('token')
  window.open(`/api/files/download?server_id=${serverId.value}&filepath=${encodeURIComponent(filepath)}&token=${encodeURIComponent(token || '')}`, '_blank')
}

async function deleteFile(row) {
  const filepath = row.path || joinPath(currentPath.value, row.name)
  await ElMessageBox.confirm(`确定删除 "${filepath}"？目录只能删除空目录。`, '确认删除', { type: 'warning' })
  const res = await api.delete('/api/files/delete', { data: { server_id: serverId.value, path: filepath } })
  if (res.code === 0) {
    ElMessage.success('已删除')
    loadFiles(directoryPath.value)
  } else {
    ElMessage.error(res.message || '删除失败')
  }
}

async function createNew() {
  if (!serverId.value) return ElMessage.warning('请选择服务器')
  if (!newName.value) return ElMessage.warning('请输入名称')
  if (newName.value.includes('/')) return ElMessage.warning('名称不能包含 /')
  const path = joinPath(directoryPath.value, newName.value)
  const res = newType.value === 'dir'
    ? await api.post('/api/files/mkdir', { server_id: serverId.value, path })
    : await api.post('/api/files/write', { server_id: serverId.value, path, content: '' })
  if (res.code === 0) {
    ElMessage.success('创建成功')
    showNewDialog.value = false
    newName.value = ''
    loadFiles(directoryPath.value)
  } else {
    ElMessage.error(res.message || '创建失败')
  }
}
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; gap: 12px; flex-wrap: wrap; }
.toolbar-actions { display: flex; gap: 8px; }
.path-box { display: flex; gap: 10px; margin-bottom: 10px; }
.path-input { flex: 1; min-width: 360px; }
.quick-paths { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-bottom: 14px; color: #64748b; }
.quick-label { font-size: 13px; margin-right: 4px; }
.edit-path { margin-bottom: 8px; color: #64748b; word-break: break-all; }
.code-editor :deep(textarea) { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace; }
.hint { margin-top: 10px; color: #909399; font-size: 13px; word-break: break-all; }
@media (max-width: 768px) { .path-box { flex-direction: column; } .path-input { min-width: auto; } }
</style>
