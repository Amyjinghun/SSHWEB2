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
            <el-radio label="password">密码</el-radio>
            <el-radio label="private_key">私钥</el-radio>
            <el-radio label="password_private_key">密码+私钥</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.auth_type!=='private_key'" label="密码">
          <el-input v-model="form.password" type="password" show-password :placeholder="passwordPlaceholder" />
          <div v-if="isEdit" class="credential-tip">{{ form.has_password ? '已保存密码，留空则不修改；填写新密码后会覆盖旧密码' : '未保存密码，请填写密码后保存' }}</div>
        </el-form-item>
        <el-form-item v-if="form.auth_type!=='password'" label="私钥">
          <el-input v-model="form.private_key" type="textarea" :rows="4" placeholder="粘贴私钥内容" />
          <div v-if="isEdit" class="credential-tip">{{ form.has_private_key ? '已保存私钥，留空则不修改；填写新私钥后会覆盖旧私钥' : '未保存私钥，请填写私钥后保存' }}</div>
        </el-form-item>
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
          <el-button v-if="!isEdit" type="success" plain @click="saveAndTest" :loading="testing">保存并测试连接</el-button>
          <el-button v-if="isEdit" type="success" plain @click="testCurrent" :loading="testing">测试连接</el-button>
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
import { ElMessage, ElMessageBox } from 'element-plus'

const route = useRoute()
const router = useRouter()
const isEdit = computed(() => !!route.params.id)
const groups = ref([])
const saving = ref(false)
const testing = ref(false)
const form = ref({ name: '', host: '', port: 22, username: 'root', auth_type: 'password', password: '', private_key: '', private_key_passphrase: '', has_password: false, has_private_key: false, group_id: null, tags: [], expires_at: '', os_info: '', remark: '' })
const passwordPlaceholder = computed(() => {
  if (!isEdit.value) return '请输入SSH密码'
  return form.value.has_password ? '留空不修改' : '请输入SSH密码'
})

function normalizeAuthType(value) {
  const map = {
    '密码': 'password',
    '私钥': 'private_key',
    '密码+私钥': 'password_private_key',
    password: 'password',
    private_key: 'private_key',
    password_private_key: 'password_private_key'
  }
  return map[value] || 'password'
}

onMounted(async () => {
  const gRes = await api.get('/api/server-groups')
  if (gRes.code === 0) groups.value = gRes.data
  if (isEdit.value) {
    const res = await api.get(`/api/servers/${route.params.id}`, { params: { include_credentials: 1 } })
    if (res.code === 0) {
      const d = res.data
      form.value = { ...form.value, name: d.name, host: d.host, port: d.port, username: d.username, auth_type: normalizeAuthType(d.auth_type), password: d.password || '', private_key: d.private_key || '', private_key_passphrase: d.private_key_passphrase || '', has_password: !!d.has_password, has_private_key: !!d.has_private_key, group_id: d.group_id, tags: d.tags || [], expires_at: d.expires_at || '', os_info: d.os_info || '', remark: d.remark || '' }
    }
  }
})

function buildPayload() {
  const authType = normalizeAuthType(form.value.auth_type)
  const payload = { ...form.value, auth_type: authType }
  delete payload.has_password
  delete payload.has_private_key
  if (isEdit.value) {
    if (!payload.password) delete payload.password
    if (!payload.private_key) delete payload.private_key
    if (!payload.private_key_passphrase) delete payload.private_key_passphrase
  }
  return payload
}

function validateForm() {
  if (!form.value.name || !form.value.host || !form.value.username) return ElMessage.warning('请填写必填项')
  const authType = normalizeAuthType(form.value.auth_type)
  if (authType !== 'private_key' && !form.value.password && !form.value.has_password) return ElMessage.warning('请填写SSH密码')
  if (authType !== 'password' && !form.value.private_key && !form.value.has_private_key) return ElMessage.warning('请填写SSH私钥')
  return true
}

async function saveAndTest() {
  if (validateForm() !== true) return
  saving.value = true
  const payload = buildPayload()
  const res = await api.post('/api/servers', payload)
  saving.value = false
  if (res.code !== 0) return ElMessage.error(res.message)
  const newId = res.data.id
  testing.value = true
  const testRes = await api.post(`/api/servers/${newId}/test`)
  testing.value = false
  if (testRes.code === 0) {
    ElMessage.success('保存成功，SSH 连接正常')
    router.push('/servers')
  } else {
    const d = testRes.data?.diagnostics
    const lines = [
      '服务器已保存，但 SSH 连接失败：',
      testRes.message,
      d?.target ? `目标：${d.target}` : '',
      d?.tcp ? `TCP：${d.tcp.ok ? '成功' : '失败'} - ${d.tcp.message}` : '',
      d?.ssh ? `SSH：${d.ssh.ok ? '成功' : '失败'} - ${d.ssh.message}` : ''
    ].filter(Boolean)
    if (d?.steps?.length) {
      lines.push('—— 连接步骤 ——')
      d.steps.forEach(s => lines.push(`· ${s.step}${s.detail ? '：' + s.detail : ''}`))
    }
    ElMessageBox.alert(lines.join('\n'), '连接测试失败', { type: 'warning', confirmButtonText: '去修改' })
    router.push('/servers/edit/' + newId)
  }
}

async function testCurrent() {
  if (validateForm() !== true) return
  testing.value = true
  const res = await api.post(`/api/servers/${route.params.id}/test`, buildPayload())
  testing.value = false
  if (res.code === 0) ElMessage.success('连接成功')
  else {
    const d = res.data?.diagnostics
    const lines = [
      res.message,
      d?.target ? `目标：${d.target}` : '',
      d?.tcp ? `TCP：${d.tcp.ok ? '成功' : '失败'} - ${d.tcp.message}` : '',
      d?.ssh ? `SSH：${d.ssh.ok ? '成功' : '失败'} - ${d.ssh.message}` : ''
    ].filter(Boolean)
    if (d?.steps?.length) {
      lines.push('—— 连接步骤 ——')
      d.steps.forEach(s => lines.push(`· ${s.step}${s.detail ? '：' + s.detail : ''}`))
    }
    ElMessageBox.alert(lines.join('\n'), '测试连接失败', { type: 'error' })
  }
}

async function save() {
  if (validateForm() !== true) return
  saving.value = true
  const payload = buildPayload()
  const res = isEdit.value ? await api.put(`/api/servers/${route.params.id}`, payload) : await api.post('/api/servers', payload)
  saving.value = false
  if (res.code === 0) { ElMessage.success('保存成功'); router.push('/servers') }
  else ElMessage.error(res.message)
}
</script>

<style scoped>
.card-title { font-weight: 600; color: #1e293b; font-size: 16px; }
.credential-tip { width: 100%; margin-top: 6px; color: #64748b; font-size: 12px; line-height: 1.4; }
</style>
