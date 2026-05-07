<template>
  <div class="page-container">
    <el-card shadow="hover">
      <div style="display:flex;justify-content:space-between;margin-bottom:16px">
        <span style="font-weight:600;font-size:16px">分组管理</span>
        <el-button type="primary" @click="showDialog(null)"><el-icon><Plus /></el-icon>新增分组</el-button>
      </div>
      <el-table :data="groups" stripe>
        <el-table-column prop="name" label="分组名称" />
        <el-table-column prop="server_count" label="服务器数量" width="120" />
        <el-table-column prop="sort_order" label="排序" width="80" />
        <el-table-column label="操作" width="180">
          <template #default="{ row }">
            <el-button size="small" @click="showDialog(row)">编辑</el-button>
            <el-button size="small" type="danger" @click="del(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
    <el-dialog v-model="dialogVisible" :title="editing ? '编辑分组' : '新增分组'" width="400px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="form.sort_order" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogVisible=false">取消</el-button><el-button type="primary" @click="save">确定</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../../api'
import { ElMessage, ElMessageBox } from 'element-plus'
const groups = ref([])
const dialogVisible = ref(false)
const editing = ref(null)
const form = ref({ name: '', sort_order: 0 })
onMounted(() => loadData())
async function loadData() { const r = await api.get('/api/server-groups'); if (r.code === 0) groups.value = r.data }
function showDialog(row) { editing.value = row; form.value = row ? { name: row.name, sort_order: row.sort_order } : { name: '', sort_order: 0 }; dialogVisible.value = true }
async function save() {
  const res = editing.value ? await api.put(`/api/server-groups/${editing.value.id}`, form.value) : await api.post('/api/server-groups', form.value)
  if (res.code === 0) { ElMessage.success('保存成功'); dialogVisible.value = false; loadData() } else ElMessage.error(res.message)
}
async function del(row) {
  await ElMessageBox.confirm(`确定删除分组 "${row.name}"？`, '确认')
  const res = await api.delete(`/api/server-groups/${row.id}`)
  if (res.code === 0) { ElMessage.success('已删除'); loadData() }
}
</script>
