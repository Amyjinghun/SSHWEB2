<template>
  <div class="page-container">
    <el-card shadow="hover">
      <template #header><span class="card-title">{{ isEdit ? '编辑服务器' : '添加服务器' }}</span></template>
      <el-form :model="form" label-width="120px" style="max-width:600px">
        <el-form-item label="服务器名称" required><el-input v-model="form.name" placeholder="例如：生产Web-01" /></el-form-item>
        <el-form-item label="主机地址" required><el-input v-model="form.host" placeholder="IP 或域名" /></el-form-item>
        <el-form-item v-if="isEdit" label="系统版本"><el-input v-model="form.os_info" disabled placeholder="测试连接或后台监控后自动采集" /></el-form-item>
        <el-form-item label="SSH端口"><el-input-number v-model="form.port" :min="1" :max="65535" /></el-form-item>
        <el-form-item label="用户名" required><el-input v-model="form.username" placeholder="root" /></el-form-item>
        <el-form-item label="认证方式">
          <el-radio-group v-model="form.auth_type">
            <el-radio value="password">密码</el-radio>
            <el-radio value="private_key">私钥</el-radio>
            <el-radio value="password_private_key">密码+私钥</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.auth_type!=='private_key'" label="密码"><el-input v-model="form.password" type="password" show-password :placeholder="isEdit?'留空不修改':''" /></el-form-item>
        <el-form-item v-if="form.auth_type!=='password'" label="私钥"><el-input v-model="form.private_key" type="textarea" :rows="4" placeholder="粘贴私钥内容" /></el-form-item>
        <el-form-item v-if="form.auth_type!=='password'" label="私钥密码"><el-input v-model="form.private_key_passphrase" type="password" show-password /></el-form-item>
        <el-form-item label="分组">
          <el-select v-model="form.group_id" placeholder="选择分组" clearable>
            <el-option v-for="g in groups" :key="g.id" :label="g.name" :value="g.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="标签">
          <el-select v-model="form.tags" multiple filterable allow-create placeholder="添加标签" style="width:100%">
            <el-option v-for="t in ['nginx','mysql','redis','海外节点','国内节点','高防节点','业务服务器']" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="到期日期"><el-date-picker v-model="form.expires_at" type="date" value-format="YYYY-MM-DD" placeholder="选择服务器到期日期" style="width:100%" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" type="textarea" :rows="2" /></el-form-item>
        <el-form-item>
          <el-button type="primary" @click="save" :loading="saving">保存</el-button>
          <el-button @click="$router.back()">返回</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../../api'
import { ElMessage } from 'element-plus'

const route = useRoute()
const router = useRouter()
const isEdit = computed(() => !!route.params.id)
const groups = ref([])
const saving = ref(false)
const form = ref({ name: '', host: '', port: 22, username: 'root', auth_type: 'password', password: '', private_key: '', private_key_passphrase: '', group_id: null, tags: [], expires_at: '', os_info: '', remark: '' })

onMounted(async () => {
  const gRes = await api.get('/api/server-groups')
  if (gRes.code === 0) groups.value = gRes.data
  if (isEdit.value) {
    const res = await api.get(`/api/servers/${route.params.id}`)
    if (res.code === 0) {
      const d = res.data
      form.value = { ...form.value, name: d.name, host: d.host, port: d.port, username: d.username, auth_type: d.auth_type, group_id: d.group_id, tags: d.tags || [], expires_at: d.expires_at || '', os_info: d.os_info || '', remark: d.remark || '' }
    }
  }
})

async function save() {
  if (!form.value.name || !form.value.host || !form.value.username) return ElMessage.warning('请填写必填项')
  saving.value = true
  const payload = { ...form.value }
  if (isEdit.value && !payload.password) delete payload.password
  const res = isEdit.value ? await api.put(`/api/servers/${route.params.id}`, payload) : await api.post('/api/servers', payload)
  saving.value = false
  if (res.code === 0) { ElMessage.success('保存成功'); router.push('/servers') }
  else ElMessage.error(res.message)
}
</script>

<style scoped>
.card-title { font-weight: 600; color: #1e293b; font-size: 16px; }
</style>
