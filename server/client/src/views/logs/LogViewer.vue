<template>
  <div class="page-container">
    <el-card shadow="hover">
      <div class="toolbar">
        <el-select v-model="serverId" placeholder="选择服务器" filterable style="width:300px" @change="onServerChange">
          <template #prefix><el-icon><Monitor /></el-icon></template>
          <el-option v-for="s in servers" :key="s.id" :label="`${s.name} (${s.host})`" :value="s.id" />
        </el-select>
        <div class="toolbar-right">
          <el-input v-model="logPath" placeholder="日志文件路径" style="width:360px" clearable>
            <template #prepend>文件路径</template>
          </el-input>
          <el-dropdown trigger="click" @command="quickPath">
            <el-button>常用日志<el-icon><ArrowDown /></el-icon></el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-for="p in commonLogs" :key="p.path" :command="p.path">{{ p.label }}</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button type="primary" @click="startTail" :disabled="!serverId || !logPath || connected">开始监听</el-button>
          <el-button type="danger" @click="stopTail" :disabled="!connected">停止</el-button>
        </div>
      </div>
    </el-card>

    <div class="log-container">
      <div v-if="connected" class="log-status-bar">
        <span class="status-dot online"></span>
        <span>实时监听中: {{ logPath }}</span>
        <span class="line-count">共 {{ lineCount }} 行</span>
      </div>
      <div ref="terminalEl" class="log-terminal"></div>
      <div v-if="!connected && !logContent" class="empty-state">
        <el-icon :size="48" color="#cbd5e1"><Document /></el-icon>
        <p>选择服务器和日志路径，点击「开始监听」</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { io } from 'socket.io-client'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import api from '../../api'

const servers = ref([])
const serverId = ref('')
const logPath = ref('')
const connected = ref(false)
const terminalEl = ref(null)
const lineCount = ref(0)
let terminal = null
let fitAddon = null
let socket = null

const commonLogs = [
  { label: '/var/log/syslog', path: '/var/log/syslog' },
  { label: '/var/log/auth.log', path: '/var/log/auth.log' },
  { label: '/var/log/nginx/access.log', path: '/var/log/nginx/access.log' },
  { label: '/var/log/nginx/error.log', path: '/var/log/nginx/error.log' },
  { label: '/var/log/mysql/error.log', path: '/var/log/mysql/error.log' },
  { label: '/var/log/dmesg', path: '/var/log/dmesg' },
  { label: '/var/log/kern.log', path: '/var/log/kern.log' },
]

const logContent = ref('')

onMounted(async () => {
  const r = await api.get('/api/servers')
  if (r.code === 0) servers.value = r.data
})

onBeforeUnmount(() => { stopTail() })

function onServerChange() {
  stopTail()
}

function quickPath(path) {
  logPath.value = path
}

function startTail() {
  if (!serverId.value || !logPath.value) return
  stopTail()

  terminal = new Terminal({
    theme: { background: '#0f172a', foreground: '#e2e8f0', cursor: '#4f6ef7', selectionBackground: 'rgba(79,110,247,0.3)' },
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    cursorBlink: false,
    disableStdin: true,
    convertEol: true,
    scrollback: 10000
  })
  fitAddon = new FitAddon()
  terminal.open(terminalEl.value)
  fitAddon.fit()

  lineCount.value = 0
  logContent.value = ''

  const token = localStorage.getItem('token')
  socket = io('/log-tail', { auth: { token }, transports: ['websocket'] })

  socket.on('connect', () => {
    socket.emit('open', { serverId: serverId.value, path: logPath.value })
  })

  socket.on('connected', () => {
    connected.value = true
  })

  socket.on('data', (data) => {
    const text = atob(data)
    terminal.write(text)
    lineCount.value += (text.match(/\n/g) || []).length
  })

  socket.on('error', (msg) => {
    terminal.write(`\r\n\x1b[31m错误: ${msg}\x1b[0m\r\n`)
    connected.value = false
  })

  socket.on('closed', () => {
    terminal.write('\r\n\x1b[33m--- 日志监听已停止 ---\x1b[0m\r\n')
    connected.value = false
  })

  const resizeObs = new ResizeObserver(() => { try { fitAddon.fit() } catch {} })
  resizeObs.observe(terminalEl.value)
}

function stopTail() {
  try { socket?.emit('close') } catch {}
  try { socket?.disconnect() } catch {}
  socket = null
  connected.value = false
  if (terminal) { terminal.dispose(); terminal = null }
}
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.toolbar-right { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.log-container { margin-top: 16px; position: relative; }
.log-status-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px; background: #1e293b; color: #94a3b8; font-size: 13px;
  border-radius: 10px 10px 0 0;
}
.status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.status-dot.online { background: #22c55e; box-shadow: 0 0 6px #22c55e; }
.line-count { margin-left: auto; color: #64748b; }
.log-terminal {
  height: calc(100vh - 280px); min-height: 300px;
  background: #0f172a; border-radius: 0 0 10px 10px;
  padding: 8px; overflow: hidden;
}
.empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  height: calc(100vh - 280px); min-height: 300px;
  color: #94a3b8; background: #f8fafc; border-radius: 10px; border: 2px dashed #e2e8f0; p { margin-top: 12px; }
}
</style>
