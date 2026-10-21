<template>
  <div class="page-container">
    <el-card shadow="hover">
      <template #header><span class="card-title">系统设置</span></template>
      <el-tabs>
        <el-tab-pane label="基础设置">
          <el-form :model="settings" label-width="160px" style="max-width:600px">
            <el-form-item label="系统名称"><el-input v-model="settings.system_name" /></el-form-item>
            <el-form-item label="登录页标题"><el-input v-model="settings.login_title" /></el-form-item>
            <el-form-item label="终端主题"><el-select v-model="settings.terminal_theme"><el-option label="暗色" value="dark" /><el-option label="亮色" value="light" /></el-select></el-form-item>
            <el-form-item label="终端字体大小"><el-input-number v-model="settings.terminal_font_size" :min="10" :max="24" /><span class="setting-hint">保存后重新打开终端页生效</span></el-form-item>
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
            <el-form-item label="IP查询服务">
              <el-select v-model="settings.ip_query_provider" style="width:280px">
                <el-option label="ipinfo.io（国外 / HTTPS）" value="ipinfo" />
                <el-option label="ip-api.com（国内 / HTTP）" value="ipapi" />
              </el-select>
              <span class="setting-hint">用于采集公网IP/位置/运营商，国内服务器选 ip-api.com</span>
            </el-form-item>
            <el-form-item label="Agent 上报间隔(秒)">
              <el-input-number v-model="settings.agent_interval" :min="2" :max="60" />
              <span class="setting-hint">Agent 会自动跟随此间隔，改完无需重装；建议 3-5 秒</span>
            </el-form-item>
            <el-form-item label="Agent 面板地址">
              <el-input v-model="settings.agent_panel_url" placeholder="留空自动按访问地址推断，如 http://1.2.3.4:18080" />
              <span class="setting-hint">面板在反代/内网多地址环境下建议显式配置，Agent 用它回报指标</span>
            </el-form-item>
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
            <el-form-item label="启用危险命令拦截"><el-switch v-model="settings.enable_dangerous_block" active-value="true" inactive-value="false" /></el-form-item>
            <el-form-item label="允许批量危险命令"><el-switch v-model="settings.allow_batch_dangerous" active-value="true" inactive-value="false" /></el-form-item>
          </el-form>
        </el-tab-pane>
        <el-tab-pane label="AI 助手">
          <el-form :model="settings" label-width="160px" style="max-width:640px">
            <el-alert
              title="为终端提供 AI 命令解释/生成/纠错能力。支持 OpenAI 兼容接口（DeepSeek、通义、Kimi、OpenAI 等）与 Anthropic Claude。API Key 保存在服务器数据库中，前端不落盘。"
              type="info" show-icon :closable="false" class="setting-alert"
            />
            <el-form-item label="启用 AI 助手"><el-switch v-model="settings.ai_enabled" active-value="true" inactive-value="false" /></el-form-item>
            <el-form-item label="接口类型">
              <el-select v-model="settings.ai_provider" style="width:320px">
                <el-option label="OpenAI 兼容（DeepSeek / 通义 / Kimi / OpenAI…）" value="openai" />
                <el-option label="Anthropic Claude" value="anthropic" />
              </el-select>
            </el-form-item>
            <el-form-item label="接口地址">
              <el-input v-model="settings.ai_base_url" :placeholder="settings.ai_provider === 'anthropic' ? '留空使用 https://api.anthropic.com' : '如 https://api.deepseek.com'" />
              <span class="setting-hint">
                DeepSeek https://api.deepseek.com · 智谱OpenAI兼容 https://open.bigmodel.cn/api/paas/v4 ·
                智谱Anthropic协议 https://open.bigmodel.cn/api/anthropic（类型须选 Anthropic） ·
                通义 https://dashscope.aliyuncs.com/compatible-mode/v1
              </span>
            </el-form-item>
            <el-form-item label="API Key"><el-input v-model="settings.ai_api_key" type="password" show-password placeholder="sk-…" /></el-form-item>
            <el-form-item label="模型">
              <el-input v-model="settings.ai_model" :placeholder="settings.ai_provider === 'anthropic' ? '如 claude-sonnet-4-5' : '如 deepseek-chat'" />
            </el-form-item>
            <el-form-item label="最大输出 Token"><el-input-number v-model="settings.ai_max_tokens" :min="128" :max="8192" :step="128" /></el-form-item>
            <el-form-item>
              <el-button @click="testAI" :loading="testingAI">测试连接</el-button>
              <span v-if="aiTestResult" class="setting-hint" style="margin-left:10px">{{ aiTestResult }}</span>
            </el-form-item>
          </el-form>
        </el-tab-pane>
        <el-tab-pane label="终端录制">
          <el-form :model="settings" label-width="160px" style="max-width:640px">
            <el-alert
              title="开启后每个终端会话的输出会录制为 asciicast 文件，可在「终端录制」页回放。只录制输出，不录制用户输入（保护密码等敏感信息）。"
              type="info" show-icon :closable="false" class="setting-alert"
            />
            <el-form-item label="启用会话录制"><el-switch v-model="settings.term_record_enabled" active-value="true" inactive-value="false" /></el-form-item>
            <el-form-item label="录制保留天数">
              <el-input-number v-model="settings.term_record_retention_days" :min="1" :max="365" />
              <span class="setting-hint">每天 03:30 自动清理过期录制，修改后需保存设置</span>
            </el-form-item>
          </el-form>
        </el-tab-pane>
        <el-tab-pane label="数据清理">
          <el-form :model="settings" label-width="160px" style="max-width:600px">
            <el-form-item label="清理审计日志(天)"><el-input-number v-model="settings.cleanup_audit_days" :min="7" /></el-form-item>
            <el-form-item label="清理执行历史(天)"><el-input-number v-model="settings.cleanup_command_log_days" :min="7" /></el-form-item>
            <el-form-item label="清理告警记录(天)">
              <el-input-number v-model="settings.cleanup_alert_days" :min="7" />
              <span class="setting-hint">每天 03:30 自动按此天数清理，修改后需保存设置</span>
            </el-form-item>
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
import { useSettingsStore } from '../../stores/settings'
import { ElMessage, ElMessageBox } from 'element-plus'
const settings = ref({})
const saving = ref(false)
const settingsStore = useSettingsStore()
const testingAI = ref(false)
const aiTestResult = ref('')
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
  if (res.code === 0) {
    ElMessage.success('设置已保存')
    // 刷新全局设置缓存，终端字号/主题、系统名称等随后生效
    settingsStore.load(true).catch(() => {})
  }
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

async function testAI() {
  testingAI.value = true
  aiTestResult.value = ''
  try {
    const res = await api.post('/api/ai/test', {
      ai_provider: settings.value.ai_provider,
      ai_base_url: settings.value.ai_base_url,
      ai_api_key: settings.value.ai_api_key,
      ai_model: settings.value.ai_model
    }, { timeout: 60000 })
    aiTestResult.value = res.code === 0 ? `✓ ${res.message}（${res.data?.reply || ''}）` : `✗ ${res.message}`
  } catch (e) {
    aiTestResult.value = `✗ ${e.message || '请求失败'}`
  } finally {
    testingAI.value = false
  }
}

async function doCleanup() {
  await ElMessageBox.confirm('确定执行数据清理？此操作不可恢复', '确认', { type: 'warning' })
  const res = await api.post('/api/settings/cleanup', {
    audit_days: Number(settings.value.cleanup_audit_days) || 90,
    command_log_days: Number(settings.value.cleanup_command_log_days) || 90,
    alert_days: Number(settings.value.cleanup_alert_days) || 90
  })
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
