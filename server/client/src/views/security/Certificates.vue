<template>
  <div class="page-container">
    <el-card shadow="hover">
      <div class="toolbar">
        <span class="page-title">SSL证书监控</span>
        <el-button type="primary" @click="showDialog(null)"><el-icon><Plus /></el-icon>添加监控</el-button>
      </div>
      <el-table :data="certs" stripe>
        <el-table-column prop="domain" label="域名" width="200" />
        <el-table-column prop="port" label="端口" width="80" />
        <el-table-column prop="issuer" label="颁发机构" width="200" />
        <el-table-column prop="valid_to" label="到期时间" width="170" />
        <el-table-column prop="days_left" label="剩余天数" width="100">
          <template #default="{ row }">
            <el-tag :type="row.days_left <= 0 ? 'danger' : row.days_left <= 7 ? 'danger' : row.days_left <= 30 ? 'warning' : 'success'" size="small" effect="plain">
              {{ row.days_left ?? '-' }} 天
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status==='valid'?'success':row.status==='expired'?'danger':'warning'" size="small" effect="plain">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button size="small" @click="checkCert(row)">检测</el-button>
            <el-button size="small" @click="showDialog(row)">编辑</el-button>
            <el-button size="small" type="danger" @click="del(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
    <el-dialog v-model="dialogVisible" :title="editing ? '编辑' : '添加'" width="400px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="域名"><el-input v-model="form.domain" /></el-form-item>
        <el-form-item label="端口"><el-input-number v-model="form.port" /></el-form-item>
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
const certs = ref([]); const dialogVisible = ref(false); const editing = ref(null)
const form = ref({ domain: '', port: 443, remark: '' })
onMounted(() => loadData())
async function loadData() { const r = await api.get('/api/certificates'); if (r.code === 0) certs.value = r.data }
function showDialog(row) { editing.value = row; form.value = row ? { domain: row.domain, port: row.port, remark: row.remark } : { domain: '', port: 443, remark: '' }; dialogVisible.value = true }
async function save() {
  const res = editing.value ? await api.put(`/api/certificates/${editing.value.id}`, form.value) : await api.post('/api/certificates', form.value)
  if (res.code === 0) { ElMessage.success('保存成功'); dialogVisible.value = false; loadData() }
}
async function checkCert(row) { const r = await api.post(`/api/certificates/${row.id}/check`); ElMessage[r.code === 0 ? 'success' : 'error'](r.code === 0 ? '检测完成' : r.message); loadData() }
async function del(row) { await ElMessageBox.confirm('确定删除？', '确认'); const r = await api.delete(`/api/certificates/${row.id}`); if (r.code === 0) { ElMessage.success('已删除'); loadData() } }
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-title { font-weight: 600; font-size: 16px; color: #1e293b; }
</style>
