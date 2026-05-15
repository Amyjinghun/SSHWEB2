<template>
  <div class="page-container">
    <el-card shadow="hover">
      <div class="toolbar">
        <span class="page-title">配置文件备份</span>
        <el-button type="primary" @click="showDialog(null)"><el-icon><Plus /></el-icon>新增任务</el-button>
      </div>
      <el-table :data="tasks" stripe>
        <el-table-column prop="name" label="任务名称" width="160" />
        <el-table-column prop="server_name" label="服务器" width="140" />
        <el-table-column prop="paths" label="备份路径" show-overflow-tooltip>
          <template #default="{ row }">{{ JSON.parse(row.paths || '[]').join(', ') }}</template>
        </el-table-column>
        <el-table-column prop="backup_dir" label="备份目录" show-overflow-tooltip />
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button size="small" type="primary" @click="runBackup(row)">立即备份</el-button>
            <el-button size="small" type="danger" @click="del(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑' : '新增'" width="500px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="服务器"><el-select v-model="form.server_id" filterable><el-option v-for="s in servers" :key="s.id" :label="s.name" :value="s.id" /></el-select></el-form-item>
        <el-form-item label="备份路径"><el-select v-model="form.paths" multiple filterable allow-create style="width:100%" placeholder="输入路径后回车添加"><el-option v-for="p in commonPaths" :key="p" :label="p" :value="p" /></el-select></el-form-item>
        <el-form-item label="备份目录"><el-input v-model="form.backup_dir" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogVisible=false">取消</el-button><el-button type="primary" @click="save">确定</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../../api'
import { ElMessage, ElMessageBox } from 'element-plus'
const tasks = ref([]); const servers = ref([]); const dialogVisible = ref(false); const editing = ref(null)
const commonPaths = ['/etc/nginx/nginx.conf', '/etc/ssh/sshd_config', '/etc/mysql/my.cnf', '/etc/redis/redis.conf']
const form = ref({ name: '', server_id: null, paths: [], backup_dir: '/tmp/config-backups', retention_count: 10 })

onMounted(async () => {
  const [tRes, sRes] = await Promise.all([api.get('/api/backups/config/tasks'), api.get('/api/servers')])
  if (tRes.code === 0) tasks.value = tRes.data; if (sRes.code === 0) servers.value = sRes.data
})

function showDialog(row) { editing.value = row; form.value = row ? { name: row.name, server_id: row.server_id, paths: JSON.parse(row.paths || '[]'), backup_dir: row.backup_dir } : { name: '', server_id: null, paths: [], backup_dir: '/tmp/config-backups' }; dialogVisible.value = true }
async function save() {
  const res = editing.value ? await api.put(`/api/backups/config/tasks/${editing.value.id}`, form.value) : await api.post('/api/backups/config/tasks', form.value)
  if (res.code === 0) { ElMessage.success('保存成功'); dialogVisible.value = false; loadData() }
}
async function runBackup(row) { const r = await api.post(`/api/backups/config/tasks/${row.id}/run`); ElMessage[r.code === 0 ? 'success' : 'error'](r.message) }
async function del(row) { await ElMessageBox.confirm('确定删除？', '确认'); const r = await api.delete(`/api/backups/config/tasks/${row.id}`); if (r.code === 0) { ElMessage.success('已删除'); loadData() } }
async function loadData() { const r = await api.get('/api/backups/config/tasks'); if (r.code === 0) tasks.value = r.data }
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-title { font-weight: 600; font-size: 16px; color: #1e293b; }
</style>
