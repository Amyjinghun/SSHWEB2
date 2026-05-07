<template>
  <div class="page-container">
    <el-card shadow="hover">
      <div class="toolbar">
        <span style="font-weight:600;font-size:16px">计划任务</span>
        <el-button type="primary" @click="showDialog(null)"><el-icon><Plus /></el-icon>新增任务</el-button>
      </div>
      <el-table :data="tasks" stripe>
        <el-table-column prop="name" label="任务名称" width="180" />
        <el-table-column prop="server_name" label="服务器" width="140" />
        <el-table-column prop="cron_expr" label="Cron表达式" width="140" />
        <el-table-column prop="command" label="命令" show-overflow-tooltip />
        <el-table-column prop="enabled" label="状态" width="80">
          <template #default="{ row }"><el-switch v-model="row.enabled" :active-value="1" :inactive-value="0" @change="toggle(row)" /></template>
        </el-table-column>
        <el-table-column prop="last_run_at" label="上次执行" width="170" />
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button size="small" @click="runTask(row)">执行</el-button>
            <el-button size="small" @click="showDialog(row)">编辑</el-button>
            <el-button size="small" type="danger" @click="del(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
    <el-dialog v-model="dialogVisible" :title="editing ? '编辑任务' : '新增任务'" width="500px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="任务名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="目标服务器">
          <el-select v-model="form.server_id" placeholder="选择服务器" filterable><el-option v-for="s in servers" :key="s.id" :label="`${s.name} (${s.host})`" :value="s.id" /></el-select>
        </el-form-item>
        <el-form-item label="Cron表达式"><el-input v-model="form.cron_expr" placeholder="例如: */5 * * * *" /></el-form-item>
        <el-form-item label="执行命令"><el-input v-model="form.command" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" /></el-form-item>
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
const form = ref({ name: '', server_id: null, cron_expr: '', command: '', remark: '' })
onMounted(async () => {
  const [tRes, sRes] = await Promise.all([api.get('/api/scheduled-tasks'), api.get('/api/servers')])
  if (tRes.code === 0) tasks.value = tRes.data; if (sRes.code === 0) servers.value = sRes.data
})
function showDialog(row) {
  editing.value = row; form.value = row ? { name: row.name, server_id: row.server_id, cron_expr: row.cron_expr, command: row.command, remark: row.remark } : { name: '', server_id: null, cron_expr: '', command: '', remark: '' }; dialogVisible.value = true
}
async function save() {
  const res = editing.value ? await api.put(`/api/scheduled-tasks/${editing.value.id}`, form.value) : await api.post('/api/scheduled-tasks', form.value)
  if (res.code === 0) { ElMessage.success('保存成功'); dialogVisible.value = false; loadData() }
}
async function loadData() { const r = await api.get('/api/scheduled-tasks'); if (r.code === 0) tasks.value = r.data }
async function toggle(row) { await api.post(`/api/scheduled-tasks/${row.id}/${row.enabled ? 'enable' : 'disable'}`) }
async function runTask(row) { const r = await api.post(`/api/scheduled-tasks/${row.id}/run`); ElMessage[r.code === 0 ? 'success' : 'error'](r.code === 0 ? '执行完成' : r.message) }
async function del(row) { await ElMessageBox.confirm('确定删除？', '确认'); const r = await api.delete(`/api/scheduled-tasks/${row.id}`); if (r.code === 0) { ElMessage.success('已删除'); loadData() } }
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
</style>
