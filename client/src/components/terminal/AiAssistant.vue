<template>
  <div class="ai-assistant">
    <div class="ai-status">
      <span class="ai-dot" :class="enabled ? 'on' : 'off'"></span>
      <span>{{ enabled ? `${model} · 已启用` : 'AI 未启用（系统设置 → AI 助手）' }}</span>
      <el-button text size="small" style="margin-left:auto" @click="clearChat" :disabled="!messages.length">清空对话</el-button>
    </div>

    <div class="ai-messages" ref="listEl">
      <div v-for="(m, i) in messages" :key="i" class="ai-msg" :class="m.role">
        <div class="ai-bubble">
          <div v-if="m.thinking && !m.content" class="ai-thinking"><span class="ai-thinking-dot"></span>思考中…</div>
          <div class="ai-text" v-html="render(m)"></div>
          <div class="ai-msg-actions" v-if="m.role === 'assistant' && m.content && !m.pending">
            <el-button text size="small" @click="copyMsg(m.content)">复制</el-button>
            <el-button v-if="canInsert" text size="small" @click="insertCommand(m.content)">插入终端</el-button>
          </div>
        </div>
      </div>
      <div v-if="!messages.length" class="ai-empty">
        <p>让 AI 帮你写命令、解释输出、排查错误。</p>
        <p class="hint">例如：「找出占用内存最高的 5 个进程」「这段报错是什么意思？」</p>
      </div>
    </div>

    <form class="ai-input" @submit.prevent="send">
      <el-input v-model="input" type="textarea" :rows="2" resize="none" placeholder="询问 AI…（Enter 发送 / Shift+Enter 换行）" @keydown.enter.exact.prevent="send" />
      <div class="ai-input-foot">
        <el-checkbox v-model="attachServer" size="small">附带当前服务器信息</el-checkbox>
        <el-button v-if="streaming" type="warning" size="small" @click="stop">停止</el-button>
        <el-button v-else type="primary" size="small" native-type="submit" :disabled="!enabled">发送</el-button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { ref, nextTick, onMounted } from 'vue'
import { marked } from 'marked'
import { ElMessage } from 'element-plus'
import api from '../../api'

const props = defineProps({
  // 传入当前终端上下文：{ serverName, host, osInfo }
  server: { type: Object, default: () => ({}) },
  canInsert: { type: Boolean, default: false }
})
const emit = defineEmits(['insert'])

const enabled = ref(false)
const model = ref('')
const input = ref('')
const attachServer = ref(false)
const streaming = ref(false)
const messages = ref([])
const listEl = ref(null)
let controller = null

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function render(m) {
  // 用户消息原样显示；AI 回复按 markdown 渲染（内容先转义，杜绝注入）
  if (m.role === 'user') return `<p style="white-space:pre-wrap">${escapeHtml(m.content)}</p>`
  return marked.parse(escapeHtml(m.content || ''), { breaks: true })
}

async function checkStatus() {
  try {
    const res = await api.get('/api/ai/status')
    if (res.code === 0) { enabled.value = res.data.enabled; model.value = res.data.model }
  } catch {}
}

function scrollBottom() {
  nextTick(() => { if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight })
}

function systemPrompt() {
  let p = '你是嵌入式 Linux 运维终端里的 AI 助手。回答要简洁、给出可直接执行的命令（用代码块），中文回复。'
  if (attachServer.value && props.server?.host) {
    p += `\n当前服务器：${props.server.serverName || ''} (${props.server.host}) ${props.server.osInfo || ''}`
  }
  return p
}

// 对外：直接带一个问题进来（右键解释命令 / 分析输出）
function ask(text) {
  if (!enabled.value) { ElMessage.warning('AI 未启用'); return }
  messages.value.push({ role: 'user', content: text })
  stream()
}

function send() {
  const text = input.value.trim()
  if (!text || streaming.value) return
  input.value = ''
  messages.value.push({ role: 'user', content: text })
  stream()
}

async function stream() {
  streaming.value = true
  const reply = { role: 'assistant', content: '', pending: true }
  messages.value.push(reply)
  scrollBottom()

  const payload = [{ role: 'system', content: systemPrompt() }, ...messages.value.filter(m => !m.pending).slice(-10).map(m => ({ role: m.role, content: m.content }))]

  controller = new AbortController()
  try {
    const token = localStorage.getItem('token')
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages: payload }),
      signal: controller.signal
    })
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j.message || `HTTP ${res.status}`)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue
        try {
          const json = JSON.parse(data)
          if (json.error) throw new Error(json.error)
          if (json.reasoning) {
            // 推理模型的思考阶段：正文还没开始,显示思考中状态
            reply.thinking = true
          } else if (json.delta) {
            reply.thinking = false
            reply.content += json.delta
            scrollBottom()
          }
        } catch {}
      }
    }
    if (!reply.content) reply.content = '（AI 未返回内容）'
  } catch (err) {
    if (err.name === 'AbortError') reply.content += '\n\n（已停止）'
    else reply.content = `⚠️ ${err.message}`
  } finally {
    reply.pending = false
    reply.thinking = false
    streaming.value = false
    controller = null
    scrollBottom()
  }
}

function stop() { try { controller?.abort() } catch {} }

function clearChat() { messages.value = [] }

function copyMsg(text) {
  const doCopy = () => ElMessage.success('已复制')
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(doCopy).catch(() => {})
  else doCopy()
}

// 从 AI 回复里提取第一个代码块作为命令插入终端
function insertCommand(text) {
  const m = String(text).match(/```[a-z]*\n([\s\S]*?)```/)
  const cmd = (m ? m[1] : text).trim().split('\n')[0]
  if (cmd) emit('insert', cmd)
}

defineExpose({ ask, stop })

onMounted(checkStatus)
</script>

<style scoped>
.ai-assistant { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.ai-status { display: flex; align-items: center; gap: 6px; padding: 0 0 8px; font-size: 12px; color: var(--text-muted, #8a9695); }
.ai-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.ai-dot.on { background: #16a34a; box-shadow: 0 0 6px rgba(22, 163, 74, 0.4); }
.ai-dot.off { background: #94a3b8; }
.ai-messages { flex: 1; overflow-y: auto; min-height: 0; display: flex; flex-direction: column; gap: 10px; padding: 4px 2px; }
.ai-msg { display: flex; }
.ai-msg.user { justify-content: flex-end; }
.ai-bubble { max-width: 92%; border-radius: 10px; padding: 8px 11px; font-size: 13px; line-height: 1.6; background: var(--surface-subtle, rgba(8, 145, 178, 0.08)); }
.ai-msg.user .ai-bubble { background: var(--primary-bg, rgba(8, 145, 178, 0.15)); }
.ai-msg.assistant .ai-bubble { background: transparent; border: 1px solid var(--border-color, rgba(128, 128, 128, 0.25)); width: 92%; max-width: none; }
.ai-text :deep(p) { margin: 4px 0; }
.ai-text :deep(pre) { background: rgba(0, 0, 0, 0.25); padding: 8px 10px; border-radius: 6px; overflow-x: auto; margin: 6px 0; }
.ai-text :deep(code) { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; }
.ai-text :deep(pre code) { background: transparent; padding: 0; }
.ai-text :deep(table) { border-collapse: collapse; font-size: 12px; }
.ai-text :deep(th), .ai-text :deep(td) { border: 1px solid var(--border-color, rgba(128,128,128,0.3)); padding: 3px 7px; }
.ai-thinking { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted, #8a9695); margin-bottom: 4px; }
.ai-thinking-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--primary-color, #0891b2); animation: aiblink 1s infinite; }
@keyframes aiblink { 50% { opacity: 0.25; } }
.ai-msg-actions { display: flex; gap: 2px; margin-top: 4px; }
.ai-empty { margin: auto; text-align: center; color: var(--text-muted, #8a9695); font-size: 13px; }
.ai-empty .hint { font-size: 12px; opacity: 0.75; }
.ai-input { display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 1px solid var(--border-color, rgba(128,128,128,0.2)); }
.ai-input-foot { display: flex; align-items: center; justify-content: space-between; }
</style>
