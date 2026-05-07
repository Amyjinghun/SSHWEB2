<template>
  <div class="page-container">
    <el-card shadow="hover">
      <div class="toolbar">
        <el-select v-model="currentServerId" placeholder="选择服务器" style="width:300px" filterable>
          <el-option v-for="s in servers" :key="s.id" :label="`${s.name} (${s.host})`" :value="s.id" />
        </el-select>
        <div>
          <el-button type="primary" @click="addTerminal">打开终端</el-button>
          <el-button type="danger" @click="closeAll">关闭全部</el-button>
        </div>
      </div>
    </el-card>

    <div class="terminals-container">
      <el-tabs v-model="activeTab" type="card" closable @tab-remove="closeTerminal" v-if="terminals.length">
        <el-tab-pane v-for="t in terminals" :key="t.id" :label="t.name" :name="t.id">
          <div :ref="el => setTermRef(t.id, el)" class="terminal-box"></div>
          <div v-if="t.error" class="term-error">{{ t.error }}</div>
        </el-tab-pane>
      </el-tabs>
      <el-empty v-else description="请选择服务器并点击「打开终端」" />
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
    theme: { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#409EFF' },
    fontSize: 14,
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
.toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.terminals-container { margin-top: 16px; }
.terminal-box { height: calc(100vh - 260px); background: #1e1e1e; border-radius: 8px; overflow: hidden; padding: 4px; }
.term-error { color: #F56C6C; padding: 8px; }
</style>
