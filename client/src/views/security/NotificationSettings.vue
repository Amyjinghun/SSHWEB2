<template>
  <div class="page-container notification-page">
    <el-card shadow="hover" class="page-card">
      <template #header>
        <div class="card-header">
          <div>
            <div class="title">告警通知</div>
            <div class="desc">统一管理 Telegram 通知、服务器监控告警和通知模板。模板编辑区已优化为更大的可视化编辑样式。</div>
          </div>
          <div class="header-actions">
            <el-button @click="loadSettings">刷新</el-button>
            <el-button type="success" @click="testTelegram" :loading="testing">发送TG测试消息</el-button>
            <el-button type="primary" @click="saveSettings" :loading="saving">保存配置</el-button>
          </div>
        </div>
      </template>

      <el-alert
        type="warning"
        show-icon
        :closable="false"
        title="到期通知内容可以使用服务器备注变量 {{remark}}。如果某台服务器备注里写了套餐、供应商、续费地址等信息，TG 到期提醒会一起发送。"
        style="margin-bottom: 16px"
      />

      <el-tabs v-model="activeTab">
        <el-tab-pane label="Telegram 配置" name="telegram">
          <el-form :model="settings" label-width="190px" class="form-block">
            <el-form-item label="启用 Telegram 通知">
              <el-switch v-model="settings.tg_enabled" active-value="true" inactive-value="false" />
            </el-form-item>
            <el-form-item label="TG Bot Token">
              <el-input v-model="settings.tg_bot_token" show-password placeholder="例如：123456:ABC-DEF..." />
            </el-form-item>
            <el-form-item label="TG Chat ID">
              <el-input v-model="settings.tg_chat_id" placeholder="个人/群组 chat_id，例如：123456789 或 -100xxxx" />
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="监控告警" name="monitor">
          <el-form :model="settings" label-width="210px" class="form-block">
            <el-alert
              title="面板会通过 SSH 主动扫描所有已添加服务器，不需要在被控机器安装脚本。"
              type="info"
              show-icon
              :closable="false"
              style="margin-bottom: 16px"
            />
            <el-form-item label="监控采集模式">
              <el-radio-group v-model="settings.server_monitor_mode" @change="applyMonitorMode">
                <el-radio-button label="realtime">实时模式</el-radio-button>
                <el-radio-button label="normal">常规模式</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="监控扫描间隔(秒)">
              <el-input-number v-model="settings.server_check_interval" :min="monitorIntervalMin" :max="monitorIntervalMax" />
              <span class="hint">{{ monitorIntervalHint }}</span>
            </el-form-item>
            <el-form-item label="监控并发数量">
              <el-input-number v-model="settings.server_monitor_concurrency" :min="1" :max="30" />
            </el-form-item>
            <el-divider content-position="left">告警开关</el-divider>
            <el-form-item label="服务器离线告警">
              <el-switch v-model="settings.alert_enable_offline" active-value="true" inactive-value="false" />
            </el-form-item>
            <el-form-item label="CPU 告警">
              <el-switch v-model="settings.alert_enable_cpu" active-value="true" inactive-value="false" />
            </el-form-item>
            <el-form-item label="CPU 告警阈值(%)">
              <el-input-number v-model="settings.alert_cpu_threshold" :min="1" :max="100" />
            </el-form-item>
            <el-form-item label="内存告警">
              <el-switch v-model="settings.alert_enable_memory" active-value="true" inactive-value="false" />
            </el-form-item>
            <el-form-item label="内存告警阈值(%)">
              <el-input-number v-model="settings.alert_memory_threshold" :min="1" :max="100" />
            </el-form-item>
            <el-form-item label="磁盘告警">
              <el-switch v-model="settings.alert_enable_disk" active-value="true" inactive-value="false" />
            </el-form-item>
            <el-form-item label="磁盘告警阈值(%)">
              <el-input-number v-model="settings.alert_disk_threshold" :min="1" :max="100" />
            </el-form-item>
            <el-divider content-position="left">到期提醒</el-divider>
            <el-form-item label="服务器到期通知">
              <el-switch v-model="settings.alert_enable_expiry" active-value="true" inactive-value="false" />
              <span class="hint">关闭后不会发送即将到期/已到期 TG 消息</span>
            </el-form-item>
            <el-form-item label="到期提前提醒(天)">
              <el-input-number v-model="settings.alert_server_expiry_days" :min="1" :max="365" />
              <span class="hint">你要求的是提前 2 天，默认值已设为 2</span>
            </el-form-item>
            <el-form-item label="重复告警间隔(小时)">
              <el-input-number v-model="settings.alert_repeat_hours" :min="1" :max="168" />
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="通知模板" name="templates">
          <el-alert
            type="success"
            show-icon
            :closable="false"
            title="模板支持 Telegram HTML 标签（<b>加粗</b>、<code>等宽</code>、<i>斜体</i>）和变量（如 {{server_name}}、{{host}}）。使用 {{bar:cpu_usage}} 可插入动态进度条。留空则使用系统默认模板。"
            style="margin-bottom: 16px"
          />

          <el-collapse v-model="openTemplates">
            <el-collapse-item title="服务器离线通知模板" name="offline">
              <TemplateEditor v-model="settings.alert_template_offline" :default-template="defaultTemplates.alert_template_offline" @reset="settings.alert_template_offline = defaultTemplates.alert_template_offline" />
            </el-collapse-item>
            <el-collapse-item title="CPU 告警通知模板" name="cpu">
              <TemplateEditor v-model="settings.alert_template_cpu" :default-template="defaultTemplates.alert_template_cpu" @reset="settings.alert_template_cpu = defaultTemplates.alert_template_cpu" />
            </el-collapse-item>
            <el-collapse-item title="内存告警通知模板" name="memory">
              <TemplateEditor v-model="settings.alert_template_memory" :default-template="defaultTemplates.alert_template_memory" @reset="settings.alert_template_memory = defaultTemplates.alert_template_memory" />
            </el-collapse-item>
            <el-collapse-item title="磁盘告警通知模板" name="disk">
              <TemplateEditor v-model="settings.alert_template_disk" :default-template="defaultTemplates.alert_template_disk" @reset="settings.alert_template_disk = defaultTemplates.alert_template_disk" />
            </el-collapse-item>
            <el-collapse-item title="服务器即将到期通知模板" name="expiry">
              <TemplateEditor v-model="settings.alert_template_expiry" :default-template="defaultTemplates.alert_template_expiry" @reset="settings.alert_template_expiry = defaultTemplates.alert_template_expiry" />
            </el-collapse-item>
            <el-collapse-item title="服务器已到期通知模板" name="expired">
              <TemplateEditor v-model="settings.alert_template_expired" :default-template="defaultTemplates.alert_template_expired" @reset="settings.alert_template_expired = defaultTemplates.alert_template_expired" />
            </el-collapse-item>
          </el-collapse>

          <el-divider content-position="left">可用变量</el-divider>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="服务器名称"><code v-pre>{{server_name}}</code></el-descriptions-item>
            <el-descriptions-item label="主机/IP"><code v-pre>{{host}}</code></el-descriptions-item>
            <el-descriptions-item label="SSH端口"><code v-pre>{{port}}</code></el-descriptions-item>
            <el-descriptions-item label="用户名"><code v-pre>{{username}}</code></el-descriptions-item>
            <el-descriptions-item label="分组"><code v-pre>{{group_name}}</code></el-descriptions-item>
            <el-descriptions-item label="标签"><code v-pre>{{tags}}</code></el-descriptions-item>
            <el-descriptions-item label="服务器备注"><code v-pre>{{remark}}</code></el-descriptions-item>
            <el-descriptions-item label="系统版本"><code v-pre>{{os_info}}</code></el-descriptions-item>
            <el-descriptions-item label="CPU使用率"><code v-pre>{{cpu_usage}}</code></el-descriptions-item>
            <el-descriptions-item label="内存使用率"><code v-pre>{{memory_usage}}</code></el-descriptions-item>
            <el-descriptions-item label="磁盘使用率"><code v-pre>{{disk_usage}}</code></el-descriptions-item>
            <el-descriptions-item label="到期日期"><code v-pre>{{expires_at}}</code></el-descriptions-item>
            <el-descriptions-item label="剩余天数"><code v-pre>{{days_left}}</code></el-descriptions-item>
            <el-descriptions-item label="过期天数"><code v-pre>{{expired_days}}</code></el-descriptions-item>
            <el-descriptions-item label="当前时间"><code v-pre>{{time}}</code></el-descriptions-item>
            <el-descriptions-item label="进度条(CPU)"><code v-pre>{{bar:cpu_usage}}</code></el-descriptions-item>
            <el-descriptions-item label="进度条(内存)"><code v-pre>{{bar:memory_usage}}</code></el-descriptions-item>
            <el-descriptions-item label="进度条(磁盘)"><code v-pre>{{bar:disk_usage}}</code></el-descriptions-item>
            <el-descriptions-item label="告警阈值"><code v-pre>{{threshold}}</code></el-descriptions-item>
            <el-descriptions-item label="失败原因"><code v-pre>{{error}}</code></el-descriptions-item>
          </el-descriptions>
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<script setup>
import { computed, defineComponent, h, ref, onMounted } from 'vue'
import api from '../../api'
import { ElMessage } from 'element-plus'

const defaultTemplates = {
  alert_template_offline: `🚨 <b>服务器离线告警</b>

━━━━━━━━━━━━━━━━━━
🖥 <b>服务器</b>：{{server_name}}
🌐 <b>IP地址</b>：<code>{{host}}:{{port}}</code>
❌ <b>失败原因</b>：{{error}}
📝 <b>备注</b>：{{remark}}
━━━━━━━━━━━━━━━━━━
🕐 {{time}}`,

  alert_template_cpu: `🔴 <b>CPU 占用过高告警</b>

━━━━━━━━━━━━━━━━━━
🖥 <b>服务器</b>：{{server_name}}
🌐 <b>IP地址</b>：<code>{{host}}</code>
🖥 <b>系统</b>：{{os_info}}
━━━━━━━━━━━━━━━━━━
🔥 <b>CPU 使用率</b>：<code>{{cpu_usage}}%</code>
<code>{{bar:cpu_usage}}</code>
⚠️ <b>告警阈值</b>：{{threshold}}%
📝 <b>备注</b>：{{remark}}
━━━━━━━━━━━━━━━━━━
🕐 {{time}}`,

  alert_template_memory: `🟠 <b>内存占用过高告警</b>

━━━━━━━━━━━━━━━━━━
🖥 <b>服务器</b>：{{server_name}}
🌐 <b>IP地址</b>：<code>{{host}}</code>
🖥 <b>系统</b>：{{os_info}}
━━━━━━━━━━━━━━━━━━
💾 <b>内存使用率</b>：<code>{{memory_usage}}%</code>  ({{memory_used}} MB / {{memory_total}} MB)
<code>{{bar:memory_usage}}</code>
⚠️ <b>告警阈值</b>：{{threshold}}%
📝 <b>备注</b>：{{remark}}
━━━━━━━━━━━━━━━━━━
🕐 {{time}}`,

  alert_template_disk: `🟡 <b>磁盘占用过高告警</b>

━━━━━━━━━━━━━━━━━━
🖥 <b>服务器</b>：{{server_name}}
🌐 <b>IP地址</b>：<code>{{host}}</code>
🖥 <b>系统</b>：{{os_info}}
━━━━━━━━━━━━━━━━━━
💿 <b>磁盘使用率</b>：<code>{{disk_usage}}%</code>  ({{disk_used}} MB / {{disk_total}} MB)
<code>{{bar:disk_usage}}</code>
⚠️ <b>告警阈值</b>：{{threshold}}%
📝 <b>备注</b>：{{remark}}
━━━━━━━━━━━━━━━━━━
🕐 {{time}}`,

  alert_template_expiry: `⏰ <b>服务器即将到期提醒</b>

┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
🖥 <b>服务器</b>：{{server_name}}
🌐 <b>IP地址</b>：<code>{{host}}:{{port}}</code>
👤 <b>用户名</b>：{{username}}
📂 <b>分组</b>：{{group_name}}
🏷 <b>标签</b>：{{tags}}
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─

📅 <b>到期时间</b>：<code>{{expires_at}}</code>
⏳ <b>剩余天数</b>：🔥 <b>{{days_left}} 天</b>
📝 <b>备注</b>：{{remark}}

💡 <i>请及时续费，避免服务器业务中断</i>
━━━━━━━━━━━━━━━━━━
🕐 {{time}}`,

  alert_template_expired: `🚨 <b>服务器已到期通知</b>

┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
🖥 <b>服务器</b>：{{server_name}}
🌐 <b>IP地址</b>：<code>{{host}}:{{port}}</code>
👤 <b>用户名</b>：{{username}}
📂 <b>分组</b>：{{group_name}}
🏷 <b>标签</b>：{{tags}}
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─

📅 <b>到期时间</b>：<code>{{expires_at}}</code>
⏳ <b>已过期</b>：❌ <b>{{expired_days}} 天</b>
📝 <b>备注</b>：{{remark}}

⚠️ <i>该服务器已过期，相关业务可能已受影响，请尽快处理！</i>
━━━━━━━━━━━━━━━━━━
🕐 {{time}}`
}

function renderBar(percent) {
  const p = Math.min(100, Math.max(0, Number(percent) || 0))
  const filled = Math.round(p / 5)
  return '▓'.repeat(filled) + '░'.repeat(20 - filled)
}

const previewData = {
  server_name: '生产Web-01',
  host: '192.168.1.100',
  port: '22',
  username: 'root',
  group_name: '生产环境',
  tags: 'nginx, web',
  remark: '阿里云华东1区 2核4G',
  os_info: 'Ubuntu 22.04 LTS',
  cpu_usage: '92.50',
  memory_usage: '87.30',
  memory_used: '3492',
  memory_total: '4096',
  disk_usage: '75.60',
  disk_used: '15428',
  disk_total: '20480',
  load_avg: '3.21',
  error: 'SSH 连接超时',
  threshold: '90',
  expires_at: '2026-06-15',
  days_left: '31',
  expired_days: '7',
  time: new Date().toLocaleString('zh-CN', { hour12: false })
}

function renderPreview(template) {
  let text = template
  text = text.replace(/\{\{bar:([a-zA-Z0-9_]+)\}\}/g, (_, key) => renderBar(previewData[key] || 0))
  text = text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => previewData[key] || '-')
  return text
}

const TemplateEditor = defineComponent({
  props: {
    modelValue: { type: String, default: '' },
    defaultTemplate: { type: String, default: '' }
  },
  emits: ['update:modelValue', 'reset'],
  setup(props, { emit }) {
    const showPreview = ref(false)
    const activeContent = () => props.modelValue || props.defaultTemplate

    return () => h('div', { class: 'template-editor' }, [
      h('div', { class: 'template-toolbar' }, [
        h('div', { class: 'template-toolbar-left' }, [
          h('div', { class: 'template-title' }, [
            h('span', '通知内容模板'),
            h('span', { class: 'template-badge' }, 'Telegram HTML')
          ]),
          h('div', { class: 'template-subtitle' }, '支持 Telegram HTML 标签（<b>加粗</b>、<code>等宽</code>、<i>斜体</i>），变量 {{xxx}} 会自动替换。留空使用默认模板。')
        ]),
        h('div', { class: 'template-actions' }, [
          h('button', { class: 'preview-toggle', type: 'button', onClick: () => { showPreview.value = !showPreview.value } },
            showPreview.value ? '编辑模板' : '预览效果'),
          h('button', { class: 'reset-btn', type: 'button', onClick: () => emit('reset') }, '填入默认模板'),
          h('button', { class: 'reset-btn light', type: 'button', onClick: () => emit('update:modelValue', '') }, '清空内容')
        ])
      ]),
      showPreview.value
        ? h('div', { class: 'preview-panel' }, [
            h('div', { class: 'preview-header' }, [
              h('span', { class: 'preview-label' }, '📱 Telegram 预览效果'),
              h('span', { class: 'preview-hint' }, '示例数据预览，实际发送时变量会替换为真实值')
            ]),
            h('div', { class: 'preview-content' },
              activeContent().split('\n').map(line =>
                h('div', { class: 'preview-line' }, line || ' ')
              )
            )
          ])
        : h('div', { class: 'template-input-wrap' }, [
            h('textarea', {
              class: 'template-textarea',
              value: props.modelValue,
              placeholder: props.defaultTemplate,
              onInput: e => emit('update:modelValue', e.target.value)
            })
          ])
    ])
  }
})

const settings = ref({})
const saving = ref(false)
const testing = ref(false)
const monitorIntervalMin = computed(() => settings.value.server_monitor_mode === 'normal' ? 120 : 5)
const monitorIntervalMax = computed(() => settings.value.server_monitor_mode === 'normal' ? 180 : 60)
const monitorIntervalHint = computed(() => (
  settings.value.server_monitor_mode === 'normal'
    ? '常规模式建议 120-180 秒，压力更低'
    : '实时模式建议 5-10 秒，服务器多时可调高'
))
const activeTab = ref('telegram')
const openTemplates = ref(['expiry'])

async function loadSettings() {
  const res = await api.get('/api/settings')
  if (res.code === 0) settings.value = { ...defaultValue(), ...res.data }
  else ElMessage.error(res.message || '读取设置失败')
}

function defaultValue() {
  return {
    tg_enabled: 'false',
    tg_bot_token: '',
    tg_chat_id: '',
    alert_enable_offline: 'true',
    alert_enable_cpu: 'true',
    alert_enable_memory: 'true',
    alert_enable_disk: 'false',
    alert_enable_expiry: 'true',
    alert_cpu_threshold: 90,
    alert_memory_threshold: 90,
    alert_disk_threshold: 90,
    alert_server_expiry_days: 2,
    alert_repeat_hours: 12,
    server_monitor_mode: 'realtime',
    server_check_interval: 10,
    server_monitor_concurrency: 5,
    alert_template_offline: '',
    alert_template_cpu: '',
    alert_template_memory: '',
    alert_template_disk: '',
    alert_template_expiry: '',
    alert_template_expired: ''
  }
}

async function saveSettings() {
  saving.value = true
  try {
    const res = await api.put('/api/settings', settings.value)
    if (res.code === 0) ElMessage.success('告警通知配置已保存')
    else ElMessage.error(res.message || '保存失败')
  } finally {
    saving.value = false
  }
}

function applyMonitorMode(mode) {
  settings.value.server_check_interval = mode === 'normal' ? 180 : 10
}

async function testTelegram() {
  testing.value = true
  try {
    const res = await api.post('/api/settings/test-telegram', {
      tg_bot_token: settings.value.tg_bot_token,
      tg_chat_id: settings.value.tg_chat_id
    })
    if (res.code === 0) ElMessage.success(res.message || '测试消息已发送')
    else ElMessage.error(res.message || '发送失败')
  } finally {
    testing.value = false
  }
}

onMounted(loadSettings)
</script>

<style scoped lang="scss">
.notification-page {
  .page-card {
    border-radius: 10px;
    overflow: hidden;
    border: 1px solid #e5eaf3;
  }

  :deep(.el-card__header) {
    padding: 18px 20px;
    border-bottom: 1px solid #e8edf5;
    background: #fff;
  }

  :deep(.el-card__body) {
    padding: 20px;
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: center;

    .title {
      font-size: 18px;
      font-weight: 700;
      color: #111827;
    }

    .desc {
      margin-top: 6px;
      color: #64748b;
      font-size: 13px;
      line-height: 1.6;
    }

    .header-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
  }

  :deep(.el-alert) {
    border-radius: 8px;
  }

  :deep(.el-tabs__header) {
    margin-bottom: 16px;
  }

  .form-block {
    max-width: 920px;
  }

  .hint {
    margin-left: 10px;
    color: #909399;
    font-size: 12px;
  }

  :deep(.template-editor) {
    border-radius: 10px;
    background: #f8fafc;
    border: 1px solid #e3eaf3;
    overflow: hidden;
    box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
  }

  :deep(.template-toolbar) {
    padding: 16px 18px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    border-bottom: 1px solid #e3eaf3;
    background: #fff;
  }

  :deep(.template-toolbar-left) {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  :deep(.template-title) {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    font-weight: 700;
    color: #172033;
  }

  :deep(.template-badge) {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 999px;
    background: #eef4ff;
    color: #4f6ef7;
    font-size: 12px;
    font-weight: 600;
  }

  :deep(.template-subtitle) {
    font-size: 12px;
    line-height: 1.6;
    color: #64748b;
    max-width: 680px;
  }

  :deep(.template-actions) {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  :deep(.preview-toggle),
  :deep(.reset-btn) {
    height: 32px;
    border-radius: 6px;
    padding: 0 12px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    line-height: 30px;
    transition: all .18s ease;
  }

  :deep(.preview-toggle) {
    border: 1px solid #4f6ef7;
    color: #fff;
    background: #4f6ef7;

    &:hover {
      border-color: #3f5fe8;
      background: #3f5fe8;
      box-shadow: 0 6px 14px rgba(79, 110, 247, 0.22);
    }
  }

  :deep(.reset-btn) {
    border: 1px solid #d6deeb;
    color: #334155;
    background: #fff;

    &:hover {
      color: #4f6ef7;
      border-color: #b7c5ff;
      background: #f5f7ff;
    }

    &.light {
      color: #64748b;
      border-color: #d6deeb;
      background: #fff;
    }
  }

  :deep(.template-input-wrap) {
    padding: 16px;
  }

  :deep(.template-textarea) {
    display: block;
    width: 100%;
    min-height: 280px;
    resize: vertical;
    border: 1px solid #d9e2ef;
    border-radius: 8px;
    padding: 14px 16px;
    background: #ffffff;
    color: #172033;
    font-size: 14px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
    line-height: 1.75;
    outline: none;
    box-sizing: border-box;
    transition: all .2s ease;

    &:focus {
      border-color: #4f6ef7;
      box-shadow: 0 0 0 3px rgba(79, 110, 247, 0.12);
    }

    &::placeholder {
      color: #94a3b8;
      white-space: pre-wrap;
    }
  }

  :deep(.preview-panel) {
    padding: 0 16px 16px;
  }

  :deep(.preview-header) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  :deep(.preview-label) {
    font-size: 13px;
    font-weight: 700;
    color: #1e293b;
  }

  :deep(.preview-hint) {
    font-size: 11px;
    color: #94a3b8;
  }

  :deep(.preview-content) {
    background: #111827;
    border-radius: 8px;
    padding: 18px 20px;
    color: #e2e8f0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.7;
    max-height: 400px;
    overflow-y: auto;
    box-shadow: inset 0 2px 8px rgba(0,0,0,0.2);
  }

  :deep(.preview-line) {
    min-height: 22px;
    white-space: pre-wrap;
    word-break: break-all;
  }

  :deep(.el-collapse) {
    border-top: none;
    border-bottom: none;
  }
  :deep(.el-collapse-item) {
    margin-bottom: 12px;
    border: 1px solid #e3eaf3;
    border-radius: 10px;
    overflow: hidden;
    background: #fff;
  }

  :deep(.el-collapse-item__header) {
    height: auto;
    min-height: 54px;
    padding: 14px 18px;
    font-size: 15px;
    font-weight: 700;
    color: #172033;
    background: #fbfcfe;
    border-bottom: 1px solid #edf2f7;
  }

  :deep(.el-collapse-item__wrap) {
    border-bottom: none;
  }

  :deep(.el-collapse-item__content) {
    padding: 0 16px 14px;
    background: #fff;
  }

  :deep(code) {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 6px;
    background: #f3f7fb;
    color: #2563eb;
    font-size: 12px;
  }

  @media (max-width: 768px) {
    :deep(.el-card__body) {
      padding: 14px;
    }

    .card-header {
      align-items: flex-start;
      flex-direction: column;
    }

    :deep(.template-toolbar) {
      flex-direction: column;
      align-items: stretch;
    }

    :deep(.template-actions) {
      justify-content: flex-start;
    }

    :deep(.template-input-wrap) {
      padding: 14px;
    }

    :deep(.template-textarea) {
      min-height: 220px;
    }
  }
}
</style>
