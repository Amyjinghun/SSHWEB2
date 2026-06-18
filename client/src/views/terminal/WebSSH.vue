<template>
  <div class="page-container terminal-page">
    <div class="terminal-toolbar">
      <el-select v-model="currentServerId" placeholder="选择服务器" class="server-select" filterable size="large">
        <template #prefix><el-icon><Monitor /></el-icon></template>
        <el-option v-for="s in servers" :key="s.id" :label="`${s.name} (${s.host})`" :value="s.id" />
      </el-select>
      <div class="toolbar-actions">
        <el-button type="primary" @click="addTerminal"><el-icon><Plus /></el-icon>打开终端</el-button>
        <el-button type="danger" @click="closeAll"><el-icon><Close /></el-icon>关闭全部</el-button>
      </div>
    </div>

    <div class="terminals-container">
      <el-tabs v-model="activeTab" type="card" closable @tab-remove="closeTerminal" v-if="terminals.length" class="terminal-tabs">
        <el-tab-pane v-for="t in terminals" :key="t.id" :label="t.name" :name="t.id">
          <div :ref="el => setTermRef(t.id, el)" class="terminal-box"></div>
          <div v-if="t.error" class="term-error"><el-icon><WarningFilled /></el-icon> {{ t.error }}</div>
        </el-tab-pane>
      </el-tabs>
      <div v-else class="empty-state">
        <el-icon :size="48" color="#cbd5e1"><Monitor /></el-icon>
        <p>请选择服务器并点击「打开终端」</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { io } from 'socket.io-client'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import api from '../../api'

const route = useRoute()
const servers = ref([])
const currentServerId = ref('')
const terminals = ref([])
const activeTab = ref('')
const termRefs = {}
const termInstances = {}
const sockets = {}
const resizeObservers = {}

onMounted(async () => {
  const res = await api.get('/api/servers')
  if (res.code === 0) servers.value = res.data
  if (route.query.server_id) {
    currentServerId.value = Number(route.query.server_id)
    addTerminal()
  }
})

onBeforeUnmount(() => { closeAll() })

function setTermRef(id, el) { if (el) termRefs[id] = el }

function addTerminal() {
  if (!currentServerId.value) return
  const server = servers.value.find(s => Number(s.id) === Number(currentServerId.value))
  if (!server) return
  const id = `term_${Date.now()}_${Math.random().toString(16).slice(2)}`
  const term = { id, name: `${server.name} (${server.host})`, serverId: server.id, error: '' }
  terminals.value.push(term)
  activeTab.value = id
  nextTick(() => initTerminal(term))
}

function initTerminal(term) {
  const el = termRefs[term.id]
  if (!el) return

  const terminal = new Terminal({
    theme: { background: '#0f172a', foreground: '#e2e8f0', cursor: '#4f6ef7', selectionBackground: 'rgba(79,110,247,0.3)', black: '#1e293b', green: '#22c55e', red: '#ef4444', yellow: '#f59e0b', blue: '#4f6ef7', cyan: '#06b6d4', white: '#e2e8f0' },
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    cursorBlink: true,
    convertEol: true
  })
  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(el)
  fitAddon.fit()
  termInstances[term.id] = { terminal, fitAddon }

  const token = localStorage.getItem('token')
  const socket = io('/ssh', { auth: { token }, transports: ['websocket'] })
  sockets[term.id] = socket

  socket.on('connect', () => {
    terminal.write('\r\n\x1b[36m正在连接服务器...\x1b[0m\r\n')
    socket.emit('open', term.serverId)
  })
  socket.on('connected', () => {
    term.error = ''
    terminal.write('\r\n\x1b[32m--- 已连接到服务器 ---\x1b[0m\r\n')
    try { fitAddon.fit() } catch {}
  })
  socket.on('data', (data) => { terminal.write(atob(data)) })
  socket.on('error', (msg) => {
    term.error = typeof msg === 'string' ? msg : (msg?.message || '连接失败')
    terminal.write(`\r\n\x1b[31m错误: ${term.error}\x1b[0m\r\n`)
  })
  socket.on('connect_error', (err) => {
    term.error = err.message || 'WebSocket 连接失败'
    terminal.write(`\r\n\x1b[31m错误: ${term.error}\x1b[0m\r\n`)
  })
  socket.on('closed', () => { terminal.write('\r\n\x1b[33m--- 连接已关闭 ---\x1b[0m\r\n') })

  terminal.onData((data) => { socket.emit('data', btoa(data)) })
  terminal.onResize(({ cols, rows }) => { socket.emit('resize', { cols, rows }) })

  const resizeObs = new ResizeObserver(() => {
    try {
      fitAddon.fit()
      const { cols, rows } = terminal
      socket.emit('resize', { cols, rows })
    } catch {}
  })
  resizeObs.observe(el)
  resizeObservers[term.id] = resizeObs
}

function closeTerminal(id) {
  try { sockets[id]?.emit('close') } catch {}
  try { sockets[id]?.disconnect() } catch {}
  delete sockets[id]

  try { resizeObservers[id]?.disconnect() } catch {}
  delete resizeObservers[id]

  if (termInstances[id]) {
    termInstances[id].terminal.dispose()
    delete termInstances[id]
  }
  delete termRefs[id]

  terminals.value = terminals.value.filter(t => t.id !== id)
  if (activeTab.value === id) activeTab.value = terminals.value[0]?.id || ''
}

function closeAll() {
  terminals.value.map(t => t.id).forEach(closeTerminal)
  terminals.value = []
  activeTab.value = ''
}
</script>

<style scoped>
.terminal-page {
  min-height: calc(100vh - 56px);
  display: flex;
  flex-direction: column;
}
.terminal-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid #e8ecf4;
  border-radius: 10px;
}
.server-select { width: 320px; max-width: 100%; }
.toolbar-actions { display: flex; gap: 10px; }
.terminals-container { margin-top: 12px; flex: 1; min-height: 0; }
.terminal-tabs :deep(.el-tabs__header) { margin-bottom: 0; }
.terminal-tabs :deep(.el-tabs__content) {
  background: #0f172a;
  border: 1px solid #1e293b;
  border-top: none;
  border-radius: 0 0 10px 10px;
}
.terminal-box {
  height: calc(100vh - 202px);
  background: #0f172a;
  border-radius: 0 0 10px 10px;
  overflow: hidden;
  padding: 8px;
}
.term-error { color: #ef4444; padding: 10px 12px; background: rgba(239,68,68,0.06); border-radius: 6px; margin-top: 8px; display: flex; align-items: center; gap: 6px; }
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: calc(100vh - 202px);
  color: #94a3b8;
  background: #f8fafc;
  border-radius: 12px;
  border: 2px dashed #e2e8f0;
  p { margin-top: 12px; font-size: 15px; }
}
@media (max-width: 768px) {
  .terminal-toolbar { align-items: stretch; flex-direction: column; }
  .server-select { width: 100%; }
  .toolbar-actions { width: 100%; }
  .toolbar-actions .el-button { flex: 1; }
}
</style>
