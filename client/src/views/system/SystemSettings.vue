<template>
  <div class="page-container">
    <el-card shadow="hover">
      <template #header><span class="card-title">系统设置</span></template>
      <el-tabs>
        <el-tab-pane label="基础设置">
          <el-form :model="settings" label-width="160px" style="max-width:600px">
            <el-form-item label="系统名称"><el-input v-model="settings.system_name" /></el-form-item>
            <el-form-item label="登录页标题"><el-input v-model="settings.login_title" /></el-form-item>
            <el-form-item label="默认分页数量"><el-input-number v-model="settings.default_page_size" :min="10" :max="100" /></el-form-item>
            <el-form-item label="终端主题"><el-select v-model="settings.terminal_theme"><el-option label="暗色" value="dark" /><el-option label="亮色" value="light" /></el-select></el-form-item>
            <el-form-item label="终端字体大小"><el-input-number v-model="settings.terminal_font_size" :min="10" :max="24" /></el-form-item>
            <el-form-item label="SSH连接超时(ms)"><el-input-number v-model="settings.ssh_connect_timeout" :min="5000" :max="60000" :step="1000" /></el-form-item>
            <el-form-item label="命令执行超时(ms)"><el-input-number v-model="settings.command_exec_timeout" :min="10000" :max="300000" :step="10000" /></el-form-item>
            <el-form-item label="监控采集模式">
              <el-radio-group v-model="settings.server_monitor_mode" @change="applyMonitorMode">
                <el-radio-button label="realtime">实时模式</el-radio-button>
                <el-radio-button label="normal">常规模式</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="状态检测间隔(秒)">
              <el-input-number v-model="settings.server_check_interval" :min="monitorIntervalMin" :max="monitorIntervalMax" />
              <span class="setting-hint">{{ monitorIntervalHint }}</span>
            </el-form-item>
            <el-form-item label="状态检测并发数"><el-input-number v-model="settings.server_monitor_concurrency" :min="1" :max="30" /></el-form-item>
          </el-form>
        </el-tab-pane>
        <el-tab-pane label="公开监控">
          <el-form :model="settings" label-width="160px" style="max-width:760px">
            <el-alert
              title="公开监控页无需登录即可查看，只展示脱敏后的实时状态，不包含 SSH 用户名、IP、端口和凭据。"
              type="warning"
              show-icon
              :closable="false"
              class="setting-alert"
            />
            <el-form-item label="启用公开监控">
              <el-switch v-model="settings.public_monitor_enabled" active-value="true" inactive-value="false" />
            </el-form-item>
            <el-form-item label="分享密钥">
              <div class="public-key-row">
                <el-input v-model="settings.public_monitor_key" placeholder="点击生成分享密钥" />
                <el-button @click="generatePublicMonitorKey">生成</el-button>
              </div>
            </el-form-item>
            <el-form-item label="公开访问地址">
              <div class="public-key-row">
                <el-input :model-value="publicMonitorUrl" readonly placeholder="保存设置后生效" />
                <el-button @click="copyPublicMonitorUrl" :disabled="!publicMonitorUrl">复制</el-button>
              </div>
            </el-form-item>
          </el-form>
        </el-tab-pane>
        <el-tab-pane label="安全设置">
          <el-form :model="settings" label-width="160px" style="max-width:600px">
            <el-form-item label="登录失败次数限制"><el-input-number v-model="settings.login_fail_limit" :min="3" :max="20" /></el-form-item>
            <el-form-item label="登录锁定时间(秒)"><el-input-number v-model="settings.login_lock_time" :min="60" :max="3600" /></el-form-item>
            <el-form-item label="Token有效期"><el-input v-model="settings.jwt_expires_in" placeholder="如 7d, 24h" /></el-form-item>
            <el-form-item label="启用危险命令拦截"><el-switch v-model="settings.enable_dangerous_block" active-value="true" inactive-value="false" /></el-form-item>
            <el-form-item label="危险命令处理方式">
              <el-select v-model="settings.dangerous_action"><el-option label="直接禁止" value="block" /><el-option label="二次确认" value="confirm" /></el-select>
            </el-form-item>
            <el-form-item label="允许批量危险命令"><el-switch v-model="settings.allow_batch_dangerous" active-value="true" inactive-value="false" /></el-form-item>
          </el-form>
        </el-tab-pane>
        <el-tab-pane label="数据清理">
          <el-form :model="cleanupForm" label-width="160px" style="max-width:600px">
            <el-form-item label="清理审计日志(天)"><el-input-number v-model="cleanupForm.audit_days" :min="7" /></el-form-item>
            <el-form-item label="清理执行历史(天)"><el-input-number v-model="cleanupForm.command_log_days" :min="7" /></el-form-item>
            <el-form-item label="清理告警记录(天)"><el-input-number v-model="cleanupForm.alert_days" :min="7" /></el-form-item>
            <el-form-item><el-button type="danger" @click="doCleanup">执行清理</el-button></el-form-item>
          </el-form>
        </el-tab-pane>
      </el-tabs>
      <el-divider />
      <el-button type="primary" @click="saveSettings" :loading="saving">保存设置</el-button>
    </el-card>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import api from '../../api'
import { ElMessage, ElMessageBox } from 'element-plus'
const settings = ref({})
const cleanupForm = ref({ audit_days: 90, command_log_days: 90, alert_days: 90 })
const saving = ref(false)
const publicMonitorUrl = computed(() => {
  const key = String(settings.value.public_monitor_key || '').trim()
  if (!key) return ''
  return `${window.location.origin}/public/monitor/${key}`
})
const monitorIntervalMin = computed(() => settings.value.server_monitor_mode === 'normal' ? 120 : 5)
const monitorIntervalMax = computed(() => settings.value.server_monitor_mode === 'normal' ? 180 : 60)
const monitorIntervalHint = computed(() => (
  settings.value.server_monitor_mode === 'normal'
    ? '常规模式建议 120-180 秒，压力更低'
    : '实时模式建议 5-10 秒，服务器多时可调高'
))

onMounted(async () => {
  const res = await api.get('/api/settings')
  if (res.code === 0) settings.value = res.data
})

async function saveSettings() {
  saving.value = true
  const res = await api.put('/api/settings', settings.value)
  saving.value = false
  if (res.code === 0) ElMessage.success('设置已保存')
}

function applyMonitorMode(mode) {
  settings.value.server_check_interval = mode === 'normal' ? 180 : 10
}

function generatePublicMonitorKey() {
  const bytes = new Uint8Array(24)
  window.crypto.getRandomValues(bytes)
  settings.value.public_monitor_key = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

async function copyPublicMonitorUrl() {
  if (!publicMonitorUrl.value) return
  await navigator.clipboard.writeText(publicMonitorUrl.value)
  ElMessage.success('公开访问地址已复制')
}

async function doCleanup() {
  await ElMessageBox.confirm('确定执行数据清理？此操作不可恢复', '确认', { type: 'warning' })
  const res = await api.post('/api/settings/cleanup', cleanupForm.value)
  if (res.code === 0) ElMessage.success('清理完成')
}
</script>

<style scoped>
.card-title { font-weight: 600; color: #1e293b; font-size: 16px; }
.setting-alert { margin-bottom: 16px; }
.public-key-row {
  width: 100%;
  display: flex;
  gap: 10px;
}
.public-key-row .el-input { flex: 1; }
@media (max-width: 768px) {
  .public-key-row { flex-direction: column; }
}
</style>
