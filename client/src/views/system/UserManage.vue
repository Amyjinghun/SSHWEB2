<template>
  <div class="page-container">
    <el-card shadow="hover">
      <div class="toolbar">
        <span class="page-title">用户管理</span>
        <el-button type="primary" @click="showDialog(null)"><el-icon><Plus /></el-icon>新增用户</el-button>
      </div>
      <el-table :data="users" stripe>
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column prop="username" label="用户名" width="120" />
        <el-table-column prop="role" label="角色" width="120">
          <template #default="{ row }">
            <el-tag :type="row.role==='superadmin'?'danger':'primary'" size="small" effect="plain">{{ row.role === 'superadmin' ? '超级管理员' : '管理员' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="80">
          <template #default="{ row }"><el-tag :type="row.status?'success':'danger'" size="small" effect="plain">{{ row.status ? '启用' : '禁用' }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="last_login_at" label="最后登录" width="170" />
        <el-table-column prop="created_at" label="创建时间" width="170" />
        <el-table-column label="操作" width="220">
          <template #default="{ row }">
            <el-button size="small" @click="showDialog(row)">编辑</el-button>
            <el-button size="small" @click="resetPwd(row)">重置密码</el-button>
            <el-button size="small" type="danger" @click="del(row)" :disabled="row.id === currentUserId">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑用户' : '新增用户'" width="400px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="用户名"><el-input v-model="form.username" :disabled="!!editing" /></el-form-item>
        <el-form-item v-if="!editing" label="密码"><el-input v-model="form.password" type="password" /></el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.role"><el-option label="管理员" value="admin" /><el-option label="超级管理员" value="superadmin" /></el-select>
        </el-form-item>
        <el-form-item label="状态"><el-switch v-model="form.status" :active-value="1" :inactive-value="0" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogVisible=false">取消</el-button><el-button type="primary" @click="save">确定</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '../../api'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUserStore } from '../../stores/user'
const userStore = useUserStore()
const currentUserId = computed(() => userStore.userInfo?.id)
const users = ref([]); const dialogVisible = ref(false); const editing = ref(null)
const form = ref({ username: '', password: '', role: 'admin', status: 1 })
onMounted(() => loadData())
async function loadData() { const r = await api.get('/api/users'); if (r.code === 0) users.value = r.data }
function showDialog(row) { editing.value = row; form.value = row ? { username: row.username, password: '', role: row.role, status: row.status } : { username: '', password: '', role: 'admin', status: 1 }; dialogVisible.value = true }
async function save() {
  const res = editing.value ? await api.put(`/api/users/${editing.value.id}`, form.value) : await api.post('/api/users', form.value)
  if (res.code === 0) { ElMessage.success('保存成功'); dialogVisible.value = false; loadData() } else ElMessage.error(res.message)
}
async function resetPwd(row) {
  const { value } = await ElMessageBox.prompt('请输入新密码', '重置密码', { inputType: 'password' })
  if (value) { const r = await api.post(`/api/users/${row.id}/reset-password`, { newPassword: value }); ElMessage[r.code === 0 ? 'success' : 'error'](r.message) }
}
async function del(row) { await ElMessageBox.confirm('确定删除？', '确认'); const r = await api.delete(`/api/users/${row.id}`); if (r.code === 0) { ElMessage.success('已删除'); loadData() } }
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-title { font-weight: 600; font-size: 16px; color: #1e293b; }
</style>
