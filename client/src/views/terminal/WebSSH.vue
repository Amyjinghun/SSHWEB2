<template>
  <div class="terminal-layout">
    <!-- 左侧：连接列表 -->
    <aside class="term-sidebar">
      <div class="sidebar-top">
        <el-select v-model="currentServerId" placeholder="选择服务器" filterable size="small" style="width:100%">
          <el-option v-for="s in servers" :key="s.id" :label="`${s.name} (${s.host})`" :value="s.id" />
        </el-select>
        <el-button type="primary" size="small" :icon="Plus" @click="addTerminal" :disabled="!currentServerId" style="margin-top:8px;width:100%">连接</el-button>
      </div>
      <div class="sidebar-search">
        <el-input v-model="searchKeyword" placeholder="搜索已连接主机…" size="small" :prefix-icon="Search" clearable />
      </div>
      <div class="sidebar-list">
        <div v-for="t in filteredTerminals" :key="t.id" class="session-item" :class="{ active: t.id === activeTab }" @click="switchTerminal(t.id)">
          <span class="session-dot" :class="t.error ? 'error' : 'connected'"></span>
          <div class="session-info">
            <strong :title="t.name">{{ t.name }}</strong>
            <small v-if="t.error" style="color:var(--color-danger)">连接失败</small>
            <small v-else class="session-ip" @click.stop="copyIp(t.host)" title="点击复制 IP">{{ t.host }}</small>
          </div>
          <el-icon class="session-close" @click.stop="closeTerminal(t.id)"><Close /></el-icon>
        </div>
        <div v-if="!terminals.length" class="sidebar-empty">暂无连接</div>
        <div v-else-if="!filteredTerminals.length" class="sidebar-empty">无匹配结果</div>
      </div>
      <div class="sidebar-bottom">
        <el-button text type="danger" size="small" :icon="Close" @click="closeAll" :disabled="!terminals.length">关闭全部</el-button>
      </div>
    </aside>

    <!-- 右侧：终端区域 -->
    <div class="term-main">
      <div v-if="!terminals.length" class="empty-state">
        <el-icon :size="48"><Monitor /></el-icon>
        <p>选择服务器并点击「连接」</p>
      </div>
      <template v-else>
        <div v-for="t in terminals" :key="t.id" v-show="t.id === activeTab" class="term-shell">
          <div class="term-screen-wrapper">
            <div :ref="el => setTermRef(t.id, el)" class="term-screen" @click="focusTerm(t.id)"></div>
            <div v-if="searchVisible && activeTab === t.id" class="term-search-bar">
              <input ref="searchInputEl" v-model="searchText" placeholder="搜索终端内容…" @keyup.enter="doSearch(true)" @keyup.esc="closeSearch" />
              <button type="button" @click="doSearch(false)" title="上一个">↑</button>
              <button type="button" @click="doSearch(true)" title="下一个">↓</button>
              <button type="button" @click="closeSearch" title="关闭">✕</button>
            </div>
            <button class="scroll-bottom-btn" style="right:50px" title="搜索 (Ctrl+F)" @click.stop="openSearch">
              <el-icon><Search /></el-icon>
            </button>
            <button class="scroll-bottom-btn" title="滚动到底部" @click.stop="scrollToBottom(t.id)">
              <el-icon><ArrowDown /></el-icon>
            </button>
          </div>
          <form class="term-composer" @submit.prevent="sendComposer(t)">
            <input v-model="t.composerText" :placeholder="broadcastMode ? '广播模式：命令将同时发送到 ' + terminals.length + ' 个会话…' : '输入命令后回车发送…'" autocomplete="off" spellcheck="false" />
            <button type="button" class="broadcast-btn" :class="{ on: broadcastMode }" :title="broadcastMode ? '点击关闭广播' : '开启广播：输入将发送到所有会话'" @click="broadcastMode = !broadcastMode">
              <el-icon><Promotion /></el-icon>广播
            </button>
            <button type="submit">发送</button>
          </form>
          <div v-if="t.error" class="term-error"><el-icon><WarningFilled /></el-icon> {{ t.error }}</div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { io } from 'socket.io-client'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Plus, Search, Close, Monitor, ArrowDown, WarningFilled, Promotion } from '@element-plus/icons-vue'
import '@xterm/xterm/css/xterm.css'
import { ElMessage } from 'element-plus'
import api from '../../api'
import { getTerminalPrefs, terminalTheme } from '../../utils/terminal-prefs'

const route = useRoute()
const servers = ref([])
const currentServerId = ref('')
const terminals = ref([])
const activeTab = ref('')
const searchKeyword = ref('')
const termRefs = {}
const termInstances = {}
const sockets = {}
const resizeObservers = {}

// 终端主题/字号来自系统设置，onMounted 时加载
let termPrefs = { fontSize: 13, theme: 'dark' }

// 广播模式：composer 输入同时发送到所有已连接会话
const broadcastMode = ref(false)
// 终端内搜索（Ctrl+F 或右上角按钮）
const searchVisible = ref(false)
const searchText = ref('')
const searchInputEl = ref(null)
const SEARCH_OPTIONS = { decorations: { matchBackground: '#f59e0b', matchOverviewRuler: '#f59e0b', activeMatchBackground: '#fb923c', activeMatchColor: '#0b1214' } }

const filteredTerminals = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  if (!kw) return terminals.value
  return terminals.value.filter(t => t.name.toLowerCase().includes(kw))
})

// btoa/atob 只支持 Latin-1：中文输入会让 btoa 抛错，中文输出会被当 Latin-1 显示成乱码。
// 服务端传输的是 UTF-8 字节的 base64，这里按字节编解码，交给 xterm 的 UTF-8 解码器处理。
function encodeBase64(str) {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}
function decodeBase64(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

onMounted(async () => {
  const [res, prefs] = await Promise.all([api.get('/api/servers'), getTerminalPrefs()])
  if (res.code === 0) servers.value = res.data
  termPrefs = prefs
  if (route.query.server_id) { currentServerId.value = Number(route.query.server_id); addTerminal() }
})
onBeforeUnmount(() => { closeAll() })

function setTermRef(id, el) { if (el) termRefs[id] = el }

function addTerminal() {
  if (!currentServerId.value) return
  const server = servers.value.find(s => Number(s.id) === Number(currentServerId.value))
  if (!server) return
  const id = `term_${Date.now()}_${Math.random().toString(16).slice(2)}`
  terminals.value.push({ id, name: server.name, host: server.host, serverId: server.id, error: '', composerText: '' })
  activeTab.value = id
  nextTick(() => initTerminal(terminals.value.find(t => t.id === id)))
}

function initTerminal(term) {
  const el = termRefs[term.id]
  if (!el) return
  const terminal = new Terminal({ theme: terminalTheme(termPrefs.theme), fontSize: termPrefs.fontSize, fontFamily: '"Cascadia Code","JetBrains Mono","Fira Code",ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace', lineHeight: 1.25, cursorBlink: true, cursorStyle: 'bar', scrollback: 5000, convertEol: true })
  const fitAddon = new FitAddon()
  const searchAddon = new SearchAddon()
  terminal.loadAddon(fitAddon)
  terminal.loadAddon(searchAddon)
  terminal.loadAddon(new WebLinksAddon())
  terminal.open(el)
  fitAddon.fit()
  termInstances[term.id] = { terminal, fitAddon, searchAddon }
  // Ctrl+F 唤起终端内搜索
  terminal.attachCustomKeyEventHandler(ev => {
    if (ev.type === 'keydown' && ev.ctrlKey && !ev.altKey && !ev.metaKey && ev.key.toLowerCase() === 'f') {
      openSearch()
      return false
    }
    return true
  })

  const token = localStorage.getItem('token')
  const socket = io('/ssh', { auth: { token }, transports: ['websocket'] })
  sockets[term.id] = socket
  socket.on('connect', () => { terminal.write('\r\n\x1b[36m正在连接...\x1b[0m\r\n'); socket.emit('open', term.serverId) })
  socket.on('connected', () => { term.error = ''; terminal.write('\r\n\x1b[32m--- 已连接 ---\x1b[0m\r\n'); try { fitAddon.fit() } catch {}; terminal.focus() })
  socket.on('data', (data) => terminal.write(decodeBase64(data)))
  socket.on('error', (msg) => { term.error = typeof msg === 'string' ? msg : (msg?.message || '连接失败'); terminal.write(`\r\n\x1b[31m错误: ${term.error}\x1b[0m\r\n`) })
  socket.on('connect_error', (err) => { term.error = err.message || '连接失败' })
  socket.on('closed', () => terminal.write('\r\n\x1b[33m--- 连接已关闭 ---\x1b[0m\r\n'))
  terminal.onData((data) => socket.emit('data', encodeBase64(data)))
  terminal.onResize(({ cols, rows }) => socket.emit('resize', { cols, rows }))

  const resizeObs = new ResizeObserver(() => { try { fitAddon.fit(); socket.emit('resize', { cols: terminal.cols, rows: terminal.rows }) } catch {} })
  resizeObs.observe(el)
  resizeObservers[term.id] = resizeObs
}

function switchTerminal(id) {
  activeTab.value = id
  nextTick(() => { try { termInstances[id]?.fitAddon?.fit(); termInstances[id]?.terminal?.focus() } catch {} })
}

function sendComposer(term) {
  const text = term.composerText; if (!text) return
  if (broadcastMode.value) {
    // 广播：同一命令发到所有已连接会话
    terminals.value.forEach(t => sockets[t.id]?.emit('data', encodeBase64(text + '\r')))
  } else {
    sockets[term.id]?.emit('data', encodeBase64(text + '\r'))
  }
  term.composerText = ''
  termInstances[term.id]?.terminal?.focus()
}

function scrollToBottom(id) { const t = termInstances[id]; if (t) { t.terminal.scrollToBottom(); t.terminal.focus() } }

function openSearch() {
  searchVisible.value = true
  nextTick(() => searchInputEl.value?.focus())
}
function doSearch(forward) {
  const inst = termInstances[activeTab.value]
  if (!inst?.searchAddon || !searchText.value) return
  if (forward) inst.searchAddon.findNext(searchText.value, SEARCH_OPTIONS)
  else inst.searchAddon.findPrevious(searchText.value, SEARCH_OPTIONS)
}
function closeSearch() {
  searchVisible.value = false
  const inst = termInstances[activeTab.value]
  try { inst?.searchAddon?.clearDecorations() } catch {}
  inst?.terminal?.focus()
}
function focusTerm(id) { termInstances[id]?.terminal?.focus() }

function closeTerminal(id) {
  try { sockets[id]?.emit('close') } catch {}
  try { sockets[id]?.disconnect() } catch {}
  delete sockets[id]
  try { resizeObservers[id]?.disconnect() } catch {}
  delete resizeObservers[id]
  if (termInstances[id]) { termInstances[id].terminal.dispose(); delete termInstances[id] }
  delete termRefs[id]
  terminals.value = terminals.value.filter(t => t.id !== id)
  if (activeTab.value === id) activeTab.value = terminals.value[0]?.id || ''
}

function closeAll() {
  terminals.value.map(t => t.id).forEach(closeTerminal)
  terminals.value = []; activeTab.value = ''
}

function copyIp(ip) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(ip).then(() => ElMessage.success(`已复制 ${ip}`)).catch(() => doFallbackCopy(ip))
  } else {
    doFallbackCopy(ip)
  }
}
function doFallbackCopy(text) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try { document.execCommand('copy'); ElMessage.success(`已复制 ${text}`) } catch {}
  document.body.removeChild(ta)
}
</script>

<style scoped>
.terminal-layout {
  display: grid;
  grid-template-columns: 260px 1fr;
  height: calc(100vh - 56px);
  gap: 0;
}

/* 左侧栏 */
.term-sidebar {
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-right: 1px solid var(--border-color);
  overflow: hidden;
}
.sidebar-top { padding: 14px 12px 10px; border-bottom: 1px solid var(--border-color); }
.sidebar-search { padding: 10px 12px; }
.sidebar-list { flex: 1; overflow-y: auto; padding: 0 8px; }

.session-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s;
  position: relative;
}
.session-item:hover { background: var(--surface-subtle); }
.session-item.active { background: var(--primary-bg); }
.session-item.active::before {
  content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%);
  width: 3px; height: 20px; background: var(--primary-color); border-radius: 0 3px 3px 0;
}
.session-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.session-dot.connected { background: #16a34a; box-shadow: 0 0 6px rgba(22,163,74,0.4); }
.session-dot.error { background: #ef4444; }
.session-info { flex: 1; min-width: 0; }
.session-info strong { display: block; font-size: 13px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.session-info small { font-size: 11px; color: var(--text-muted); }
.session-ip { font-family: 'JetBrains Mono', ui-monospace, monospace; cursor: pointer; transition: color 0.15s; }
.session-ip:hover { color: var(--primary-color); }
.session-close { color: var(--text-muted); cursor: pointer; padding: 4px; border-radius: 4px; flex-shrink: 0; }
.session-close:hover { color: var(--color-danger); background: var(--color-danger-soft); }
.sidebar-empty { padding: 40px 0; text-align: center; color: var(--text-muted); font-size: 13px; }
.sidebar-bottom { padding: 10px 12px; border-top: 1px solid var(--border-color); }

/* 右侧终端 */
.term-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }

.empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  height: 100%; color: var(--text-muted); gap: 12px;
}
.empty-state p { font-size: 15px; margin: 0; }

.term-shell {
  display: grid; grid-template-rows: minmax(0, 1fr) auto;
  min-height: 0; flex: 1; overflow: hidden;
  border: 1px solid #29383a; border-radius: 0; background: #0b1214;
}
.term-screen-wrapper { position: relative; min-width: 0; min-height: 0; overflow: hidden; padding: 10px 6px; }
.term-screen { height: 100%; }
.term-screen :deep(.xterm) { height: 100%; }
.term-screen :deep(.xterm-viewport) { overflow-y: scroll !important; }

.scroll-bottom-btn {
  position: absolute; z-index: 3; top: 9px; right: 10px;
  display: grid; width: 32px; height: 32px; place-items: center;
  border: 1px solid #29383a; border-radius: 8px; color: #8a9695;
  background: rgba(17,26,29,0.92); backdrop-filter: blur(6px);
  cursor: pointer; opacity: 0.72; transition: opacity 0.15s, color 0.15s, border-color 0.15s;
}
.scroll-bottom-btn:hover { color: #d8dddc; border-color: var(--primary-color); opacity: 1; }

.term-composer {
  position: relative; z-index: 2; display: grid; grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px; padding: 9px 10px; border-top: 1px solid #29383a; background: #111a1d;
}
.term-composer input {
  min-width: 0; border: 1px solid #29383a; border-radius: 8px; padding: 9px 11px;
  color: #d8dddc; background: #0b1214; font: 12px ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, Consolas, monospace;
  outline: none; transition: border-color 0.15s;
}
.term-composer input:focus { border-color: var(--primary-color); }
.term-composer input::placeholder { color: #5a6a68; }
.term-composer button { border: 0; border-radius: 8px; padding: 0 16px; color: #05251c; background: var(--primary-color); font-weight: 700; font-size: 13px; cursor: pointer; }

.term-composer .broadcast-btn {
  border: 1px solid #29383a; border-radius: 8px; padding: 0 12px;
  color: #8a9695; background: transparent; font-weight: 600; font-size: 12px;
  display: inline-flex; align-items: center; gap: 4px; cursor: pointer;
  transition: color .15s, background .15s, border-color .15s;
}
.term-composer .broadcast-btn:hover { color: #d8dddc; border-color: var(--primary-color); }
.term-composer .broadcast-btn.on { color: #05251c; background: #f59e0b; border-color: #f59e0b; }

.term-search-bar {
  position: absolute; z-index: 4; top: 9px; left: 10px;
  display: flex; gap: 6px; align-items: center;
  padding: 5px 7px; border: 1px solid #29383a; border-radius: 8px;
  background: rgba(17,26,29,0.95); backdrop-filter: blur(6px);
}
.term-search-bar input {
  width: 200px; border: 1px solid #29383a; border-radius: 6px; padding: 6px 9px;
  color: #d8dddc; background: #0b1214; font: 12px ui-monospace, "JetBrains Mono", monospace; outline: none;
}
.term-search-bar input:focus { border-color: var(--primary-color); }
.term-search-bar button {
  border: 0; border-radius: 6px; padding: 5px 9px; color: #8a9695; background: transparent;
  font-size: 12px; line-height: 1; cursor: pointer;
}
.term-search-bar button:hover { color: #d8dddc; background: rgba(8,145,178,0.18); }

.term-error { color: #ef4444; padding: 16px; background: rgba(239,68,68,0.06); display: flex; align-items: center; gap: 8px; font-size: 14px; }

.term-shell :deep(.xterm-viewport) { scrollbar-color: #35474a #0b1214; scrollbar-width: thin; }
.term-shell :deep(.xterm-viewport::-webkit-scrollbar) { width: 8px; }
.term-shell :deep(.xterm-viewport::-webkit-scrollbar-thumb) { background: #35474a; border-radius: 99px; }
.term-shell :deep(.xterm-viewport::-webkit-scrollbar-track) { background: transparent; }

@media (max-width: 768px) {
  .terminal-layout { grid-template-columns: 1fr; }
  .term-sidebar { display: none; }
}
</style>
