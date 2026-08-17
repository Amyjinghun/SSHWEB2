<template>
  <div class="page-container log-page">
    <div class="log-toolbar">
      <el-select v-model="serverId" placeholder="选择服务器" filterable class="server-select" @change="onServerChange">
        <template #prefix><el-icon><Monitor /></el-icon></template>
        <el-option v-for="s in servers" :key="s.id" :label="`${s.name} (${s.host})`" :value="s.id" />
      </el-select>
      <div class="toolbar-right">
        <el-input v-model="logPath" placeholder="日志文件路径" class="path-input" clearable>
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

    <div class="log-container" :class="{ connected }">
      <div v-if="connected" class="log-status-bar">
        <span class="status-dot online"></span>
        <span>实时监听中: {{ logPath }}</span>
        <span class="line-count">共 {{ lineCount }} 行</span>
        <div class="log-search">
          <el-input v-model="searchKeyword" placeholder="搜索日志…" size="small" style="width:180px" clearable @keyup.enter="doSearch(true)" />
          <el-button size="small" @click="doSearch(false)">上一个</el-button>
          <el-button size="small" type="primary" @click="doSearch(true)">下一个</el-button>
        </div>
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
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import api from '../../api'
import { getTerminalPrefs, terminalTheme } from '../../utils/terminal-prefs'

const servers = ref([])
const serverId = ref('')
const logPath = ref('')
const connected = ref(false)
const terminalEl = ref(null)
const lineCount = ref(0)
let terminal = null
let fitAddon = null
let searchAddon = null
let socket = null
// 终端主题/字号来自系统设置，onMounted 时加载
let termPrefs = { fontSize: 13, theme: 'dark' }

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

// 服务端传输的是 UTF-8 字节的 base64；按字节解码交给 xterm 的 UTF-8 解码器，中文才不会乱码
function decodeBase64(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

onMounted(async () => {
  const [r, prefs] = await Promise.all([api.get('/api/servers'), getTerminalPrefs()])
  if (r.code === 0) servers.value = r.data
  termPrefs = prefs
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
    theme: terminalTheme(termPrefs.theme),
    fontSize: termPrefs.fontSize,
    fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    cursorBlink: false,
    disableStdin: true,
    convertEol: true,
    scrollback: 10000
  })
  fitAddon = new FitAddon()
  searchAddon = new SearchAddon()
  terminal.loadAddon(fitAddon)
  terminal.loadAddon(searchAddon)
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
    const bytes = decodeBase64(data)
    terminal.write(bytes)
    lineCount.value += (new TextDecoder().decode(bytes).match(/\n/g) || []).length
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
  searchAddon = null
  connected.value = false
  if (terminal) { terminal.dispose(); terminal = null }
}

// 终端内搜索：高亮匹配并跳转
const searchKeyword = ref('')
function doSearch(forward) {
  if (!searchAddon || !searchKeyword.value.trim()) return
  const opts = { decorations: { matchBackground: '#f59e0b', activeMatchBackground: '#fb923c', activeMatchColor: '#0b1214' } }
  if (forward) searchAddon.findNext(searchKeyword.value, opts)
  else searchAddon.findPrevious(searchKeyword.value, opts)
}
</script>

<style scoped>
.log-page {
  height: calc(100vh - 56px);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.log-toolbar {
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
.toolbar-right { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.path-input { width: min(460px, 38vw); }
.log-container {
  margin-top: 12px;
  position: relative;
  flex: 1;
  min-height: 0;
}
.log-status-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px; background: #1e293b; color: #94a3b8; font-size: 13px;
  border-radius: 10px 10px 0 0;
}
.status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.status-dot.online { background: #22c55e; box-shadow: 0 0 6px #22c55e; }
.line-count { margin-left: auto; color: #64748b; }
.log-search { display: flex; gap: 8px; align-items: center; }
.log-terminal {
  height: 100%;
  min-height: 0;
  background: #0f172a; border-radius: 0 0 10px 10px;
  padding: 8px; overflow: hidden;
}
.log-container.connected .log-terminal {
  height: calc(100% - 37px);
}
.log-container:not(.connected) .log-terminal {
  border-radius: 10px;
}
.empty-state {
  position: absolute;
  inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  color: #94a3b8; background: #f8fafc; border-radius: 10px; border: 2px dashed #e2e8f0; p { margin-top: 12px; }
}
@media (max-width: 1100px) {
  .log-toolbar { align-items: stretch; flex-direction: column; }
  .server-select,
  .path-input { width: 100%; }
  .toolbar-right { width: 100%; }
}
@media (max-width: 768px) {
  .toolbar-right { align-items: stretch; flex-direction: column; }
  .toolbar-right .el-button { width: 100%; }
}
</style>
