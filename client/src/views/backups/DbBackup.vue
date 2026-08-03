<template>
  <div class="page-container">
    <el-card shadow="hover">
      <div class="toolbar">
        <span class="page-title">数据库备份</span>
        <el-button type="primary" @click="showConfigDialog(null)"><el-icon><Plus /></el-icon>新增配置</el-button>
      </div>
      <el-table :data="configs" stripe>
        <el-table-column prop="name" label="配置名称" width="160" />
        <el-table-column prop="server_name" label="服务器" width="140" />
        <el-table-column prop="db_type" label="类型" width="80">
          <template #default="{ row }"><el-tag size="small" effect="plain">{{ row.db_type }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="db_host" label="主机" width="120" />
        <el-table-column prop="db_name" label="数据库" width="120" />
        <el-table-column prop="backup_dir" label="备份目录" show-overflow-tooltip />
        <el-table-column prop="retention_count" label="保留份数" width="80" />
        <el-table-column label="操作" width="220">
          <template #default="{ row }">
            <el-button size="small" type="primary" @click="runBackup(row)" :loading="row.running">备份</el-button>
            <el-button size="small" @click="showConfigDialog(row)">编辑</el-button>
            <el-button size="small" type="danger" @click="delConfig(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="hover" style="margin-top:16px">
      <template #header><span class="card-title">备份文件</span></template>
      <el-table :data="files" stripe>
        <el-table-column prop="file_name" label="文件名" />
        <el-table-column prop="file_size" label="大小" width="100">
          <template #default="{ row }">{{ row.file_size ? (row.file_size / 1024 / 1024).toFixed(2) + ' MB' : '-' }}</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="80">
          <template #default="{ row }"><el-tag :type="row.status==='success'?'success':'danger'" size="small" effect="plain">{{ row.status }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="created_at" label="时间" width="170" />
        <el-table-column label="操作" width="160">
          <template #default="{ row }">
            <el-button v-if="row.status === 'success'" size="small" @click="downloadFile(row)">下载</el-button>
            <el-button v-if="row.status === 'success'" size="small" type="warning" @click="restoreFile(row)">恢复</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="hover" style="margin-top:16px">
      <template #header><span class="card-title">面板数据库（SSHWeb 自身）</span></template>
      <el-alert type="warning" :closable="false" show-icon style="margin-bottom: 16px">
        导出文件含全部数据（服务器凭据、用户密码哈希等敏感信息），请妥善保管。导入会覆盖当前面板所有数据。
      </el-alert>
      <div style="display:flex; gap:12px">
        <el-button type="primary" @click="exportPanel" :loading="exporting">导出面板数据库</el-button>
        <el-upload :show-file-list="false" :before-upload="importPanel" accept=".gz,.sql,.sql.gz">
          <el-button type="warning" :loading="importing">导入面板数据库</el-button>
        </el-upload>
      </div>
    </el-card>

    <el-dialog v-model="configDialogVisible" :title="editing ? '编辑配置' : '新增配置'" width="500px">
      <el-form :model="configForm" label-width="100px">
        <el-form-item label="名称"><el-input v-model="configForm.name" /></el-form-item>
        <el-form-item label="服务器"><el-select v-model="configForm.server_id" clearable filterable><el-option v-for="s in servers" :key="s.id" :label="s.name" :value="s.id" /></el-select></el-form-item>
        <el-form-item label="类型"><el-select v-model="configForm.db_type"><el-option label="MySQL" value="mysql" /><el-option label="MariaDB" value="mariadb" /></el-select></el-form-item>
        <el-form-item label="主机"><el-input v-model="configForm.db_host" /></el-form-item>
        <el-form-item label="端口"><el-input-number v-model="configForm.db_port" /></el-form-item>
        <el-form-item label="用户名"><el-input v-model="configForm.db_username" /></el-form-item>
        <el-form-item label="密码"><el-input v-model="configForm.db_password" type="password" /></el-form-item>
        <el-form-item label="数据库名"><el-input v-model="configForm.db_name" /></el-form-item>
        <el-form-item label="备份目录"><el-input v-model="configForm.backup_dir" /></el-form-item>
        <el-form-item label="保留份数"><el-input-number v-model="configForm.retention_count" :min="1" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="configDialogVisible=false">取消</el-button><el-button type="primary" @click="saveConfig">确定</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../../api'
import { ElMessage, ElMessageBox } from 'element-plus'
const configs = ref([]); const files = ref([]); const servers = ref([])
const configDialogVisible = ref(false); const editing = ref(null)
const exporting = ref(false); const importing = ref(false)
const configForm = ref({ name: '', server_id: null, db_type: 'mysql', db_host: 'localhost', db_port: 3306, db_username: 'root', db_password: '', db_name: '', backup_dir: '/tmp/backups', retention_count: 7 })

onMounted(async () => {
  const [cRes, fRes, sRes] = await Promise.all([api.get('/api/backups/db/configs'), api.get('/api/backups/files', { params: { backup_type: 'database' } }), api.get('/api/servers')])
  if (cRes.code === 0) configs.value = cRes.data; if (fRes.code === 0) files.value = fRes.data; if (sRes.code === 0) servers.value = sRes.data
})

function showConfigDialog(row) {
  editing.value = row
  configForm.value = row ? { name: row.name, server_id: row.server_id, db_type: row.db_type, db_host: row.db_host, db_port: row.db_port, db_username: row.db_username, db_password: '', db_name: row.db_name, backup_dir: row.backup_dir, retention_count: row.retention_count } : { name: '', server_id: null, db_type: 'mysql', db_host: 'localhost', db_port: 3306, db_username: 'root', db_password: '', db_name: '', backup_dir: '/tmp/backups', retention_count: 7 }
  configDialogVisible.value = true
}

async function saveConfig() {
  const res = editing.value ? await api.put(`/api/backups/db/configs/${editing.value.id}`, configForm.value) : await api.post('/api/backups/db/configs', configForm.value)
  if (res.code === 0) { ElMessage.success('保存成功'); configDialogVisible.value = false; loadData() }
}

async function runBackup(row) {
  row.running = true
  const res = await api.post(`/api/backups/db/configs/${row.id}/run`)
  row.running = false
  ElMessage[res.code === 0 ? 'success' : 'error'](res.message); loadFiles()
}

async function delConfig(row) { await ElMessageBox.confirm('确定删除？', '确认'); const r = await api.delete(`/api/backups/db/configs/${row.id}`); if (r.code === 0) { ElMessage.success('已删除'); loadData() } }
async function loadData() { const r = await api.get('/api/backups/db/configs'); if (r.code === 0) configs.value = r.data }
async function loadFiles() { const r = await api.get('/api/backups/files', { params: { backup_type: 'database' } }); if (r.code === 0) files.value = r.data }

async function downloadFile(row) {
  try {
    const res = await fetch(`/api/backups/files/${row.id}/download`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
    if (!res.ok) throw new Error('下载失败')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = row.file_name || 'backup.sql.gz'
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    ElMessage.error('下载失败')
  }
}

async function restoreFile(row) {
  await ElMessageBox.confirm(`确定用 "${row.file_name}" 恢复数据库？当前数据将被覆盖！`, '危险操作', { type: 'error', confirmButtonText: '确认恢复', cancelButtonText: '取消' })
  const res = await api.post(`/api/backups/files/${row.id}/restore`)
  ElMessage[res.code === 0 ? 'success' : 'error'](res.message)
}

async function exportPanel() {
  exporting.value = true
  try {
    const res = await fetch('/api/backups/panel/export', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
    if (!res.ok) throw new Error('导出失败')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sshweb_panel_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.sql.gz`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('导出成功')
  } catch (err) {
    ElMessage.error('导出失败')
  } finally {
    exporting.value = false
  }
}

async function importPanel(file) {
  importing.value = true
  try {
    await ElMessageBox.confirm('导入将覆盖当前面板所有数据（服务器、用户、设置等），操作不可逆！确定继续？', '危险操作', { type: 'error', confirmButtonText: '确认导入', cancelButtonText: '取消' })
    const formData = new FormData()
    formData.append('file', file)
    const res = await api.post('/api/backups/panel/import', formData)
    ElMessage[res.code === 0 ? 'success' : 'error'](res.message)
    if (res.code === 0) setTimeout(() => window.location.reload(), 2000)
  } catch (err) {
    if (err !== 'cancel' && err?.message !== 'cancel') ElMessage.error('导入失败')
  } finally {
    importing.value = false
  }
  return false
}
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-title { font-weight: 600; font-size: 16px; color: #1e293b; }
.card-title { font-weight: 600; color: #1e293b; font-size: 15px; }
</style>
