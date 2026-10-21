<template>
  <div class="terminal-layout" :class="{ 'with-panel': panelOpen }">
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
            <strong :title="t.name">{{ t.name }} <span v-if="t.recording" class="rec-dot" title="会话录制中">●</span></strong>
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

    <!-- 中间：终端区域 -->
    <div class="term-main">
      <!-- 工具栏：快速命令 + 功能按钮 -->
      <div class="term-toolbar" v-if="terminals.length">
        <div class="quick-commands">
          <span class="qc-label">快速命令</span>
          <button v-for="c in quickCommands" :key="c.id" type="button" class="qc-chip" :title="c.command" @click="applyQuickCommand(c)">
            {{ c.name }}
          </button>
          <el-dropdown trigger="click" @command="onQuickMenu">
            <button type="button" class="qc-chip qc-manage" title="管理快速命令"><el-icon><ArrowDown /></el-icon></button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item disabled>点击条目插入终端，★ 收藏 / 取消收藏</el-dropdown-item>
                <el-dropdown-item v-for="c in templates" :key="c.id" :command="c" divided>
                  <span class="qc-star" @click.stop.prevent="toggleFav(c)">{{ isFav(c) ? '★' : '☆' }}</span>
                  {{ c.name }}
                </el-dropdown-item>
                <el-dropdown-item divided command="__manage">管理模板…</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <div class="term-toolbar-actions">
          <el-tooltip content="本地命令历史（↑/↓ 翻阅）" placement="bottom">
            <button type="button" class="tool-btn" :class="{ on: userPrefs.localHistory }" @click="toggleLocalHistory"><el-icon><Clock /></el-icon></button>
          </el-tooltip>
          <el-tooltip content="命令大全" placement="bottom">
            <button type="button" class="tool-btn" :class="{ on: panelOpen && panelTab === 'manual' }" @click="togglePanel('manual')"><el-icon><Notebook /></el-icon></button>
          </el-tooltip>
          <el-tooltip v-if="aiEnabled" content="AI 助手" placement="bottom">
            <button type="button" class="tool-btn" :class="{ on: panelOpen && panelTab === 'ai' }" @click="togglePanel('ai')"><el-icon><MagicStick /></el-icon></button>
          </el-tooltip>
          <el-select v-model="userPrefs.theme" size="small" style="width:86px" @change="applyTheme">
            <el-option label="暗色" value="dark" /><el-option label="亮色" value="light" />
          </el-select>
          <el-select v-model="userPrefs.fontSize" size="small" style="width:74px" @change="applyFontSize">
            <el-option v-for="n in [11,12,13,14,15,16,18,20]" :key="n" :label="`${n}px`" :value="n" />
          </el-select>
          <el-tooltip content="全屏" placement="bottom">
            <button type="button" class="tool-btn" @click="toggleFullscreen"><el-icon><FullScreen /></el-icon></button>
          </el-tooltip>
        </div>
      </div>

      <div v-if="!terminals.length" class="empty-state">
        <el-icon :size="48"><Monitor /></el-icon>
        <p>选择服务器并点击「连接」</p>
        <p class="empty-tips">支持：命令历史（↑/↓）· 智能补全（Tab 采纳）· 命令大全 · AI 助手 · 拖文件进终端即 rz 上传 · sz 直接下载</p>
      </div>
      <template v-else>
        <div v-for="t in terminals" :key="t.id" v-show="t.id === activeTab" class="term-shell" :ref="el => setShellRef(t.id, el)">
          <div class="term-screen-wrapper" @contextmenu.prevent="openContextMenu($event, t)">
            <div :ref="el => setTermRef(t.id, el)" class="term-screen" @click="focusTerm(t.id)"></div>
            <!-- 终端内智能补全浮层 -->
            <div v-if="suggest.visible && suggest.terminalId === t.id && suggest.items.length" class="term-suggest">
              <div v-for="(s, i) in suggest.items" :key="s.text + i" class="suggest-item" :class="{ active: i === suggest.index }"
                   @mouseenter="suggest.index = i" @mousedown.prevent="adoptSuggestion(s)">
                <code>{{ s.text }}</code>
                <small>{{ s.source }}<template v-if="s.desc"> · {{ s.desc }}</template></small>
              </div>
              <div class="suggest-tip">Tab 采纳 · Esc 关闭</div>
            </div>
            <div v-if="zmodem.active && zmodem.terminalId === t.id" class="zmodem-bar">
              <el-icon class="zmodem-spin"><Loading /></el-icon>
              ZMODEM 传输中{{ zmodem.file ? `：${zmodem.file}` : '' }}<template v-if="zmodem.percent !== null">（{{ zmodem.percent }}%）</template>
            </div>
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
            <!-- composer 输入建议 -->
            <div v-if="suggest.visible && suggest.terminalId === '__composer' && activeTab === t.id && suggest.items.length" class="composer-suggest">
              <div v-for="(s, i) in suggest.items" :key="s.text + i" class="suggest-item" :class="{ active: i === suggest.index }"
                   @mouseenter="suggest.index = i" @mousedown.prevent="composerAdopt()">
                <code>{{ s.text }}</code>
                <small>{{ s.source }}<template v-if="s.desc"> · {{ s.desc }}</template></small>
              </div>
              <div class="suggest-tip">↑↓ 选择 · Tab 采纳 · Esc 关闭</div>
            </div>
            <input v-model="t.composerText" :placeholder="broadcastMode ? '广播模式：命令将同时发送到 ' + connectedCount + ' 个会话…' : '输入命令后回车发送…（Tab 补全）'" autocomplete="off" spellcheck="false" @keydown="composerKeydown" />
            <select class="encoding-select" v-model="t.encoding" @change="changeEncoding(t)" title="终端编码：自动为探测到的服务器编码，老机器中文乱码时可手动选 GBK">
              <option value="auto">{{ t.encoding === 'auto' && t.detectedEncoding ? `自动 (${t.detectedEncoding})` : '自动' }}</option>
              <option value="utf-8">UTF-8</option>
              <option value="gbk">GBK</option>
              <option value="gb18030">GB18030</option>
              <option value="big5">BIG5</option>
              <option value="shift_jis">Shift_JIS</option>
              <option value="euc-kr">EUC-KR</option>
            </select>
            <button type="button" class="broadcast-btn" :class="{ on: broadcastMode }" :title="broadcastMode ? '点击关闭广播' : '开启广播：输入将发送到所有会话'" @click="toggleBroadcast">
              <el-icon><Promotion /></el-icon>广播
            </button>
            <button type="submit">发送</button>
          </form>
          <div v-if="t.error" class="term-error"><el-icon><WarningFilled /></el-icon> {{ t.error }}</div>
        </div>
      </template>
    </div>

    <!-- 右侧：命令大全 / AI 助手 -->
    <aside class="term-panel" v-if="panelOpen">
      <div class="panel-head">
        <button type="button" class="panel-tab" :class="{ on: panelTab === 'manual' }" @click="panelTab = 'manual'">命令大全</button>
        <button v-if="aiEnabled" type="button" class="panel-tab" :class="{ on: panelTab === 'ai' }" @click="panelTab = 'ai'">AI 助手</button>
        <el-icon class="panel-close" @click="panelOpen = false"><Close /></el-icon>
      </div>
      <div class="panel-body" v-show="panelTab === 'manual'">
        <CommandManual ref="manualRef" mode="panel" :can-insert="!!activeTerm" @insert="insertToComposer" />
      </div>
      <div class="panel-body" v-show="panelTab === 'ai'">
        <AiAssistant ref="aiRef" :server="aiServerCtx" :can-insert="!!activeTerm" @insert="insertToComposer" />
      </div>
    </aside>

    <!-- 右键菜单 -->
    <teleport to="body">
      <div v-if="ctxMenu.visible" class="ctx-menu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }">
        <button v-if="ctxMenu.selection" type="button" @click="ctxAction('copy')">复制</button>
        <button type="button" @click="ctxAction('paste')">粘贴</button>
        <button type="button" @click="ctxAction('search')">搜索…</button>
        <button type="button" @click="ctxAction('clear')">清屏</button>
        <template v-if="aiEnabled">
          <div class="ctx-divider"></div>
          <button v-if="ctxMenu.selection" type="button" @click="ctxAction('ai-explain')">AI 解释选中内容</button>
          <button type="button" @click="ctxAction('ai-output')">AI 分析最近输出</button>
        </template>
      </div>
    </teleport>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { io } from 'socket.io-client'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import Zmodem from 'zmodem.js'
import Fuse from 'fuse.js'
import { Plus, Search, Close, Monitor, ArrowDown, WarningFilled, Promotion, Clock, Notebook, MagicStick, FullScreen, Loading } from '@element-plus/icons-vue'
import '@xterm/xterm/css/xterm.css'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../../api'
import { getTerminalPrefs, saveUserPrefs, terminalTheme, TERMINAL_THEMES } from '../../utils/terminal-prefs'
import { loadHistory, pushHistory, clearHistory } from '../../utils/command-history'
import CommandManual from '../../components/terminal/CommandManual.vue'
import AiAssistant from '../../components/terminal/AiAssistant.vue'

const route = useRoute()
const router = useRouter()
const servers = ref([])
const currentServerId = ref('')
const terminals = ref([])
const activeTab = ref('')
const searchKeyword = ref('')
const termRefs = {}
const shellRefs = {}
const termInstances = {}
const sockets = {}
const resizeObservers = {}
const ackTimers = {}

// 终端偏好：系统设置为默认，用户可在工具栏覆盖（localStorage）
const userPrefs = reactive({ theme: 'dark', fontSize: 13, localHistory: true })

// 当前用户名（命令历史按用户隔离）
const currentUsername = (() => {
  try {
    const payload = localStorage.getItem('token').split('.')[1]
    return JSON.parse(decodeURIComponent(escape(window.atob(payload.replace(/-/g, '+').replace(/_/g, '/'))))).username || ''
  } catch { return '' }
})()
let historyList = []

// 广播模式：composer 输入同时发送到所有已连接会话
const broadcastMode = ref(false)
const connectedCount = computed(() => terminals.value.filter(t => !t.error && sockets[t.id]).length)
// 终端编码可选项（与服务端白名单一致）
const ENCODING_OPTIONS = ['utf-8', 'gbk', 'gb18030', 'big5', 'shift_jis', 'euc-kr']
// 终端内搜索（Ctrl+F 或右上角按钮）
const searchVisible = ref(false)
const searchText = ref('')
const searchInputEl = ref(null)
const SEARCH_OPTIONS = { decorations: { matchBackground: '#f59e0b', matchOverviewRuler: '#f59e0b', activeMatchBackground: '#fb923c', activeMatchColor: '#0b1214' } }

// ---- 右侧面板（命令大全 / AI）----
const panelOpen = ref(false)
const panelTab = ref('manual')
const manualRef = ref(null)
const aiRef = ref(null)
const aiEnabled = ref(false)
const aiServerCtx = reactive({ serverName: '', host: '', osInfo: '' })
const activeTerm = computed(() => terminals.value.find(t => t.id === activeTab.value))

// ---- 快速命令栏 ----
const templates = ref([])
const favIds = ref([])
const FAV_KEY = `term_fav_templates_${currentUsername || 'default'}`
const quickCommands = computed(() => templates.value.filter(c => favIds.value.includes(c.id)))
function isFav(c) { return favIds.value.includes(c.id) }
function loadFavs() { try { favIds.value = JSON.parse(localStorage.getItem(FAV_KEY)) || [] } catch { favIds.value = [] } }
function toggleFav(c) {
  const idx = favIds.value.indexOf(c.id)
  if (idx === -1) favIds.value.push(c.id)
  else favIds.value.splice(idx, 1)
  try { localStorage.setItem(FAV_KEY, JSON.stringify(favIds.value)) } catch {}
}
function onQuickMenu(cmd) {
  if (cmd === '__manage') { router.push('/templates'); return }
  applyQuickCommand(cmd)
}
function applyQuickCommand(c) {
  const term = activeTerm.value
  if (!term) { ElMessage.info('请先连接一个会话'); return }
  term.composerText = (term.composerText ? term.composerText + ' ' : '') + c.command
  termInstances[term.id]?.terminal?.focus()
}

// ---- 智能补全 ----
const suggest = reactive({ visible: false, items: [], index: 0, terminalId: '' })
let fuse = null
let suggestionSources = []

function buildSuggestionEngine() {
  const seen = new Set()
  suggestionSources = []
  for (const cmd of historyList) {
    if (!seen.has(cmd)) { seen.add(cmd); suggestionSources.push({ text: cmd, source: '历史', desc: '' }) }
  }
  for (const c of templates.value) {
    if (c.command && !seen.has(c.command)) { seen.add(c.command); suggestionSources.push({ text: c.command, source: '模板', desc: c.name }) }
  }
  for (const m of manualMeta.value) {
    if (!seen.has(m.name)) { seen.add(m.name); suggestionSources.push({ text: m.name, source: '大全', desc: m.desc }) }
  }
  fuse = new Fuse(suggestionSources, { keys: ['text'], threshold: 0.4, ignoreLocation: true })
}

function getSuggestions(q) {
  if (!q) return []
  const ql = q.toLowerCase()
  const byText = new Map()
  for (const s of suggestionSources) {
    if (s.text.toLowerCase().startsWith(ql)) byText.set(s.text, s)
    if (byText.size >= 8) break
  }
  if (byText.size < 8 && fuse) {
    for (const r of fuse.search(q)) {
      if (!byText.has(r.item.text)) byText.set(r.item.text, r.item)
      if (byText.size >= 8) break
    }
  }
  return [...byText.values()]
}

const lastToken = (buf) => {
  const m = buf.match(/(\S+)$/)
  return m ? m[1] : ''
}

function showTerminalSuggestions(termId, buf) {
  const token = lastToken(buf)
  if (userPrefs.localHistory && !termInstances[termId]?.state.distrust && token.length >= 2) {
    const items = getSuggestions(token).filter(s => s.text.toLowerCase() !== token.toLowerCase())
    suggest.items = items
    suggest.index = 0
    suggest.visible = items.length > 0
    suggest.terminalId = termId
  } else {
    suggest.visible = false
  }
}

// Tab 采纳：把建议的剩余部分发给 shell，并同步本地行缓冲
function adoptSuggestion(s) {
  const term = activeTerm.value
  if (!term) return
  const inst = termInstances[term.id]
  const token = lastToken(inst?.state.lineBuf || '')
  const socket = sockets[term.id]
  if (!socket) return
  const enc = new TextEncoder()
  if (token && s.text.toLowerCase().startsWith(token.toLowerCase())) {
    const rest = s.text.slice(token.length)
    socket.emit('data', enc.encode(rest))
    inst.state.lineBuf += rest
  } else {
    socket.emit('data', enc.encode('\x15' + s.text))
    inst.state.lineBuf = s.text
  }
  suggest.visible = false
  inst?.terminal?.focus()
}

// ---- 行缓冲与本地历史（↑/↓）----
function trackInput(term, data, socket) {
  const inst = termInstances[term.id]
  if (!inst) return
  if (inst.zsession) return
  // 转义序列（方向键/功能键）无法可靠同步行缓冲，标记失真
  if (data.includes('\x1b')) { inst.state.distrust = true; suggest.visible = false; return }
  const enc = new TextEncoder()
  for (const ch of data) {
    if (ch === '\r') {
      const cmd = inst.state.lineBuf
      if (cmd.trim()) { pushHistory(currentUsername, cmd); historyList = loadHistory(currentUsername); buildSuggestionEngine() }
      inst.state.lineBuf = ''
      inst.state.histIdx = -1
      inst.state.distrust = false
      suggest.visible = false
    } else if (ch === '\x7f') {
      inst.state.lineBuf = inst.state.lineBuf.slice(0, -1)
    } else if (ch === '\x03' || ch === '\x15' || ch === '\x0c') {
      inst.state.lineBuf = ''
      inst.state.histIdx = -1
      inst.state.distrust = false
      suggest.visible = false
    } else if (ch >= ' ' && ch < '\x7f') {
      inst.state.lineBuf += ch
    } else {
      inst.state.distrust = true
    }
  }
  showTerminalSuggestions(term.id, inst.state.lineBuf)
}

function historyNav(term, direction) {
  const inst = termInstances[term.id]
  const socket = sockets[term.id]
  if (!inst || !socket) return false
  // 行缓冲失真（用户移动过光标编辑）时不接管，交回 shell 自己的历史
  if (!userPrefs.localHistory || inst.state.distrust || inst.zsession || !historyList.length) return false
  let idx = inst.state.histIdx
  if (direction === 'up') {
    if (idx === -1) { inst.state.draft = inst.state.lineBuf; idx = 0 }
    else if (idx < historyList.length - 1) idx++
    else return true
  } else {
    if (idx === -1) return false
    idx--
    if (idx === -1) {
      inst.state.histIdx = -1
      socket.emit('data', new TextEncoder().encode('\x15' + (inst.state.draft || '')))
      inst.state.lineBuf = inst.state.draft || ''
      return true
    }
  }
  inst.state.histIdx = idx
  const entry = historyList[idx]
  // Ctrl+U 清行后回写，远端 shell 无感
  socket.emit('data', new TextEncoder().encode('\x15' + entry))
  inst.state.lineBuf = entry
  suggest.visible = false
  return true
}

// ---- ZMODEM ----
const zmodem = reactive({ active: false, terminalId: '', file: '', percent: null })

function setZmodemUI(termId, active, file = '', percent = null) {
  zmodem.active = active
  zmodem.terminalId = active ? termId : ''
  zmodem.file = file
  zmodem.percent = percent
}

function onZmodemDetect(term, detection) {
  const inst = termInstances[term.id]
  const socket = sockets[term.id]
  if (!inst || !socket) return
  const zsession = detection.confirm()
  inst.zsession = zsession
  socket.emit('set-raw', true)
  suggest.visible = false

  if (zsession.type === 'send') {
    // 服务器执行了 sz：逐个弹确认接收
    setZmodemUI(term.id, true, '接收中…')
    zsession.on('offer', xfer => {
      const details = xfer.get_details()
      const chunks = []
      let received = 0
      const total = details.size || 0
      xfer.on('input', octets => {
        chunks.push(octets)
        received += octets.length
        if (total) zmodem.percent = Math.round(received / total * 100)
      })
      xfer.accept().then(() => {
        saveBlob(new Blob(chunks), details.name || 'zmodem-file')
        ElMessage.success(`已接收 ${details.name}`)
      }).catch(() => ElMessage.error(`接收 ${details.name} 失败`))
    })
    zsession.on('session_end', () => finishZmodem(term.id))
    zsession.start()
  } else {
    // 我们主动发起的 rz：把待传文件逐个 offer 出去
    const files = inst.pendingFiles || []
    setZmodemUI(term.id, true, files[0]?.name || '上传中…', 0)
    ;(async () => {
      try {
        for (const file of files) {
          const octets = new Uint8Array(await file.arrayBuffer())
          zmodem.file = file.name
          await new Promise((resolve, reject) => {
            zsession.send_offer({ name: file.name, size: octets.length, mode: 0o644 }).then(xfer => {
              if (!xfer) { resolve(); return }
              // 分块发送，顺便更新进度
              const CHUNK = 8192
              let sent = 0
              const step = () => {
                if (sent >= octets.length) { xfer.end().then(resolve).catch(reject); return }
                const slice = octets.subarray(sent, Math.min(sent + CHUNK, octets.length))
                sent += slice.length
                zmodem.percent = Math.round(sent / octets.length * 100)
                try { xfer.send(slice); setTimeout(step, 0) } catch (e) { reject(e) }
              }
              step()
            }).catch(reject)
          })
        }
        await zsession.close()
      } catch (e) {
        ElMessage.error('ZMODEM 上传失败: ' + (e.message || e))
        try { zsession.close() } catch {}
        finishZmodem(term.id)
      }
    })()
    zsession.on('session_end', () => finishZmodem(term.id))
  }
}

function finishZmodem(termId) {
  const inst = termInstances[termId]
  const socket = sockets[termId]
  inst && (inst.zsession = null, inst.pendingFiles = null)
  socket?.emit('set-raw', false)
  setZmodemUI('', false)
}

async function zmodemUpload(term, files) {
  if (!files?.length) return
  const inst = termInstances[term.id]
  const socket = sockets[term.id]
  if (!inst || !socket) return
  try {
    await ElMessageBox.confirm(`将 ${files.map(f => f.name).join('、')} 上传到 ${term.host} 的当前目录（通过 rz）？`, 'ZMODEM 上传', { type: 'info' })
  } catch { return }
  if (!inst.zentry) { ElMessage.warning('ZMODEM 组件初始化失败'); return }
  inst.pendingFiles = files
  socket.emit('set-raw', true)
  socket.emit('data', new TextEncoder().encode('rz\r'))
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}

// ---- 右键菜单 ----
const ctxMenu = reactive({ visible: false, x: 0, y: 0, selection: '', terminalId: '' })
function openContextMenu(ev, term) {
  const inst = termInstances[term.id]
  ctxMenu.visible = true
  ctxMenu.x = Math.min(ev.clientX, window.innerWidth - 180)
  ctxMenu.y = Math.min(ev.clientY, window.innerHeight - 220)
  ctxMenu.selection = inst?.terminal?.getSelection() || ''
  ctxMenu.terminalId = term.id
}
function closeContextMenu() { ctxMenu.visible = false }
function getRecentOutput(termId, lines = 30) {
  const inst = termInstances[termId]
  if (!inst) return ''
  const buf = inst.terminal.buffer.active
  const end = buf.baseY + buf.cursorY
  const out = []
  for (let i = Math.max(0, end - lines); i < end; i++) {
    const line = buf.getLine(i)
    if (line) out.push(line.translateToString(true))
  }
  return out.join('\n')
}
async function ctxAction(action) {
  const termId = ctxMenu.terminalId
  const selection = ctxMenu.selection
  closeContextMenu()
  const term = terminals.value.find(t => t.id === termId)
  const inst = termInstances[termId]
  if (!term || !inst) return
  if (action === 'copy') {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(selection).then(() => ElMessage.success('已复制')).catch(() => {})
  } else if (action === 'paste') {
    try {
      const text = await navigator.clipboard.readText()
      if (text) sockets[termId]?.emit('data', new TextEncoder().encode(text))
    } catch { ElMessage.warning('浏览器未授权读取剪贴板，请用 Ctrl+Shift+V') }
    inst.terminal.focus()
  } else if (action === 'search') {
    openSearch()
  } else if (action === 'clear') {
    inst.terminal.clear()
    inst.terminal.focus()
  } else if (action === 'ai-explain') {
    openPanel('ai')
    nextTick(() => aiRef.value?.ask(`请解释这个命令的作用、参数和潜在风险：\n\n\`\`\`bash\n${selection}\n\`\`\``))
  } else if (action === 'ai-output') {
    openPanel('ai')
    const output = getRecentOutput(termId)
    nextTick(() => aiRef.value?.ask(`这是终端最近的输出，请分析有没有异常/报错，并给出建议：\n\n\`\`\`\n${output}\n\`\`\``))
  }
}

// ---- 面板 ----
function openPanel(tab) {
  panelTab.value = tab
  panelOpen.value = true
}
function togglePanel(tab) {
  if (panelOpen.value && panelTab.value === tab) panelOpen.value = false
  else openPanel(tab)
}
function insertToComposer(text) {
  const term = activeTerm.value
  if (!term) { ElMessage.info('请先连接一个会话'); return }
  term.composerText = (term.composerText ? term.composerText + ' ' : '') + text
  termInstances[term.id]?.terminal?.focus()
}
watch(activeTab, (id) => {
  const t = terminals.value.find(x => x.id === id)
  const server = servers.value.find(s => Number(s.id) === Number(t?.serverId))
  aiServerCtx.serverName = t?.name || ''
  aiServerCtx.host = t?.host || ''
  aiServerCtx.osInfo = server?.os_info || ''
})

// ---- 偏好 ----
function toggleLocalHistory() {
  userPrefs.localHistory = !userPrefs.localHistory
  Object.assign(userPrefs, saveUserPrefs({ localHistory: userPrefs.localHistory }))
  ElMessage.success(userPrefs.localHistory ? '本地命令历史已开启' : '本地命令历史已关闭（↑/↓ 交回远端 shell）')
}
function applyTheme() {
  Object.assign(userPrefs, saveUserPrefs({ theme: userPrefs.theme }))
  terminals.value.forEach(t => {
    const inst = termInstances[t.id]
    if (inst) inst.terminal.options.theme = terminalTheme(userPrefs.theme)
  })
}
function applyFontSize() {
  Object.assign(userPrefs, saveUserPrefs({ fontSize: userPrefs.fontSize }))
  terminals.value.forEach(t => {
    const inst = termInstances[t.id]
    if (inst) {
      inst.terminal.options.fontSize = userPrefs.fontSize
      try { inst.fitAddon.fit() } catch {}
    }
  })
}
function toggleFullscreen() {
  const el = shellRefs[activeTab.value]
  if (!el) return
  if (document.fullscreenElement) document.exitFullscreen()
  else el.requestFullscreen?.().then(() => setTimeout(() => termInstances[activeTab.value]?.fitAddon?.fit(), 120)).catch(() => {})
}

const filteredTerminals = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  if (!kw) return terminals.value
  return terminals.value.filter(t => t.name.toLowerCase().includes(kw))
})

// composer 输入框补全（复用同一数据源，↑↓/Tab/Esc 操作）
function composerKeydown(ev) {
  if (!suggest.visible || suggest.terminalId !== '__composer') return
  if (ev.key === 'ArrowDown') { suggest.index = Math.min(suggest.index + 1, suggest.items.length - 1); ev.preventDefault() }
  else if (ev.key === 'ArrowUp') { suggest.index = Math.max(suggest.index - 1, 0); ev.preventDefault() }
  else if (ev.key === 'Tab') { ev.preventDefault(); composerAdopt() }
  else if (ev.key === 'Escape') { suggest.visible = false }
}
function composerAdopt() {
  const term = activeTerm.value
  const s = suggest.items[suggest.index]
  if (!term || !s) return
  const token = lastToken(term.composerText || '')
  term.composerText = token && s.text.toLowerCase().startsWith(token.toLowerCase())
    ? term.composerText.slice(0, term.composerText.length - token.length) + s.text
    : s.text
  suggest.visible = false
}
// composer 输入变化 → 刷新建议（terminalId 用 __composer 区分终端内浮层）
watch(() => activeTerm.value?.composerText, (text) => {
  if (text == null) return
  const token = lastToken(text)
  if (token.length >= 2) {
    const items = getSuggestions(token).filter(s => s.text.toLowerCase() !== token.toLowerCase())
    suggest.items = items
    suggest.index = 0
    suggest.visible = items.length > 0
    suggest.terminalId = '__composer'
  } else if (suggest.terminalId === '__composer') {
    suggest.visible = false
  }
})

onMounted(async () => {
  const [res, prefs] = await Promise.all([api.get('/api/servers'), getTerminalPrefs()])
  if (res.code === 0) servers.value = res.data
  Object.assign(userPrefs, { theme: prefs.theme, fontSize: prefs.fontSize, localHistory: prefs.localHistory })
  historyList = loadHistory(currentUsername)

  // 建议数据源 + 快速命令 + AI 状态并行加载
  Promise.all([api.get('/api/commands/templates'), api.get('/api/command-manual/list'), api.get('/api/ai/status')])
    .then(([tpl, manual, ai]) => {
      if (tpl.code === 0) templates.value = tpl.data
      if (manual.code === 0) manualMeta.value = manual.data
      if (ai.code === 0 && ai.data?.enabled) aiEnabled.value = true
      buildSuggestionEngine()
    }).catch(() => {})
  loadFavs()

  document.addEventListener('click', closeContextMenu)
  window.addEventListener('keydown', onGlobalKeydown)
  if (route.query.server_id) { currentServerId.value = Number(route.query.server_id); addTerminal() }
})
onBeforeUnmount(() => {
  closeAll()
  document.removeEventListener('click', closeContextMenu)
  window.removeEventListener('keydown', onGlobalKeydown)
})

function onGlobalKeydown(ev) {
  if (ev.key === 'Escape' && suggest.visible) suggest.visible = false
}

// 命令大全元数据（补全数据源），延迟填充
const manualMeta = ref([])

function setTermRef(id, el) { if (el) termRefs[id] = el }
function setShellRef(id, el) { if (el) shellRefs[id] = el }

function addTerminal() {
  if (!currentServerId.value) return
  const server = servers.value.find(s => Number(s.id) === Number(currentServerId.value))
  if (!server) return
  const id = `term_${Date.now()}_${Math.random().toString(16).slice(2)}`
  terminals.value.push({ id, name: server.name, host: server.host, serverId: server.id, error: '', composerText: '', encoding: 'auto', detectedEncoding: '', recvBytes: 0, ackedBytes: 0, recording: false })
  activeTab.value = id
  // 「发送到终端」：命令只填入输入框，不自动执行
  if (route.query.cmd) {
    const t = terminals.value.find(x => x.id === id)
    if (t) t.composerText = String(route.query.cmd)
    router.replace({ path: '/terminal', query: { server_id: route.query.server_id } })
  }
  nextTick(() => initTerminal(terminals.value.find(t => t.id === id)))
}

function initTerminal(term) {
  const el = termRefs[term.id]
  if (!el) return
  const terminal = new Terminal({
    theme: terminalTheme(userPrefs.theme),
    fontSize: userPrefs.fontSize,
    fontFamily: '"Cascadia Code","JetBrains Mono","Fira Code",ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace',
    lineHeight: 1.25, cursorBlink: true, cursorStyle: 'bar', scrollback: 5000, convertEol: true
  })
  const fitAddon = new FitAddon()
  const searchAddon = new SearchAddon()
  terminal.loadAddon(fitAddon)
  terminal.loadAddon(searchAddon)
  terminal.loadAddon(new WebLinksAddon())
  terminal.open(el)
  // WebGL 渲染加速，失败自动回落默认渲染
  try {
    terminal.loadAddon(new WebglAddon())
  } catch {}
  fitAddon.fit()
  termInstances[term.id] = {
    terminal, fitAddon, searchAddon, webgl: null,
    state: { lineBuf: '', histIdx: -1, draft: '', distrust: false },
    zentry: null, zsession: null, pendingFiles: null
  }
  setupZmodem(term)

  // Ctrl+F 唤起终端内搜索；↑/↓ 本地历史接管；光标移动键标记行缓冲失真
  terminal.attachCustomKeyEventHandler(ev => {
    if (ev.type === 'keydown' && ev.ctrlKey && !ev.altKey && !ev.metaKey && ev.key.toLowerCase() === 'f') {
      openSearch()
      return false
    }
    if (ev.type !== 'keydown') return true
    const inst = termInstances[term.id]
    if (!inst) return true
    if (ev.key === 'ArrowUp' && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      return !historyNav(term, 'up')
    }
    if (ev.key === 'ArrowDown' && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      return !historyNav(term, 'down')
    }
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Delete'].includes(ev.key)) {
      inst.state.distrust = true
    }
    return true
  })

  const token = localStorage.getItem('token')
  const socket = io('/ssh', { auth: { token }, transports: ['websocket'] })
  sockets[term.id] = socket
  // open 时带上真实终端尺寸，避免服务端先用 120x32 建会话再闪一次 resize；
  // 重连后服务端是新 socket（计数归零），客户端流控计数也要同步清零
  socket.on('connect', () => {
    term.recvBytes = 0
    term.ackedBytes = 0
    terminal.write('\r\n\x1b[36m正在连接...\x1b[0m\r\n')
    socket.emit('open', { serverId: term.serverId, cols: terminal.cols, rows: terminal.rows })
  })
  socket.on('connected', () => { term.error = ''; terminal.write('\r\n\x1b[32m--- 已连接 ---\x1b[0m\r\n'); try { fitAddon.fit() } catch {}; terminal.focus() })
  socket.on('recording', ({ enabled }) => { term.recording = !!enabled })
  socket.on('data', (data) => {
    // 服务端已按会话编码转成 UTF-8 字节（二进制帧）；经 ZMODEM Sentry 过滤后写入 xterm
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    term.recvBytes += bytes.length
    const inst = termInstances[term.id]
    if (inst?.zentry) inst.zentry.consume(bytes)
    else terminal.write(bytes)
    // 每 256KB 向服务端回报一次接收进度，服务端据此做背压防止内存积压
    if (term.recvBytes - term.ackedBytes >= 262144) {
      term.ackedBytes = term.recvBytes
      socket.emit('ack', term.recvBytes)
    }
  })
  // 兜底心跳回报：小流量场景下保证积压也能定期清零
  const ackTimer = setInterval(() => {
    if (term.recvBytes > term.ackedBytes && socket.connected) {
      term.ackedBytes = term.recvBytes
      socket.emit('ack', term.recvBytes)
    }
  }, 1000)
  ackTimers[term.id] = ackTimer
  socket.on('encoding', ({ encoding, raw }) => {
    // 服务端探测/切换结果，仅用于「自动」选项旁显示探测到的编码
    term.detectedEncoding = raw || encoding
  })
  socket.on('zmodem-start', () => { setZmodemUI(term.id, true, '接收中…') })
  socket.on('error', (msg) => { term.error = typeof msg === 'string' ? msg : (msg?.message || '连接失败'); terminal.write(`\r\n\x1b[31m错误: ${term.error}\x1b[0m\r\n`) })
  socket.on('connect_error', (err) => { term.error = err.message || '连接失败' })
  socket.on('closed', () => terminal.write('\r\n\x1b[33m--- 连接已关闭 ---\x1b[0m\r\n'))
  // 键入 → Sentry（无会话时透传给服务器），同时维护本地行缓冲/历史/补全
  terminal.onData((data) => {
    const bytes = new TextEncoder().encode(data)
    const inst = termInstances[term.id]
    if (inst?.zentry) inst.zentry.send(bytes)
    else socket.emit('data', bytes)
    trackInput(term, data, socket)
  })
  terminal.onResize(({ cols, rows }) => socket.emit('resize', { cols, rows }))

  const resizeObs = new ResizeObserver(() => { try { fitAddon.fit(); socket.emit('resize', { cols: terminal.cols, rows: terminal.rows }) } catch {} })
  resizeObs.observe(el)
  resizeObservers[term.id] = resizeObs
}

// ZMODEM：Sentry 挂在 socket 数据流上，无会话时对 xterm 完全透明
function setupZmodem(term) {
  const inst = termInstances[term.id]
  if (!inst) return
  try {
    inst.zentry = new Zmodem.Sentry({
      to_terminal: (octets) => { try { inst.terminal.write(octets) } catch {} },
      sender: (octets) => { try { sockets[term.id]?.emit('data', octets) } catch {} },
      on_detect: (detection) => onZmodemDetect(term, detection),
      on_retract: () => { if (!inst.zsession && zmodem.active) setZmodemUI('', false) }
    })
  } catch {
    inst.zentry = null
  }
}

// 拖文件到终端 = rz 上传
function bindDrop(termId) {
  const el = termRefs[termId]
  if (!el) return
  el.addEventListener('dragover', ev => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy' })
  el.addEventListener('drop', ev => {
    ev.preventDefault()
    const term = terminals.value.find(t => t.id === termId)
    const files = [...(ev.dataTransfer?.files || [])]
    if (term && files.length) zmodemUpload(term, files)
  })
}

function switchTerminal(id) {
  activeTab.value = id
  nextTick(() => { try { termInstances[id]?.fitAddon?.fit(); termInstances[id]?.terminal?.focus() } catch {} })
}

function sendComposer(term) {
  const text = term.composerText; if (!text) return
  suggest.visible = false
  if (broadcastMode.value) {
    // 广播：同一命令发到所有正常连接的会话（跳过连接失败的）
    terminals.value.forEach(t => { if (!t.error && sockets[t.id]) sockets[t.id].emit('data', new TextEncoder().encode(text + '\r')) })
  } else {
    sockets[term.id]?.emit('data', new TextEncoder().encode(text + '\r'))
  }
  // composer 发送也进历史，保证补全数据源一致
  if (text.trim()) { pushHistory(currentUsername, text); historyList = loadHistory(currentUsername); buildSuggestionEngine() }
  term.composerText = ''
  termInstances[term.id]?.terminal?.focus()
}

// 编码切换：'auto' 由服务端用探测值，其余直接指定（服务端做双向转换）
function changeEncoding(term) {
  const val = ENCODING_OPTIONS.includes(term.encoding) ? term.encoding : 'auto'
  sockets[term.id]?.emit('set-encoding', val)
  termInstances[term.id]?.terminal?.focus()
}

// 开启广播是高危操作（命令会打到所有会话），二次确认防误触
async function toggleBroadcast() {
  if (broadcastMode.value) { broadcastMode.value = false; return }
  try {
    await ElMessageBox.confirm(
      `广播模式下输入的命令将同时发送到所有 ${connectedCount.value} 个已连接会话执行，确认开启？`,
      '开启广播模式',
      { type: 'warning', confirmButtonText: '开启', cancelButtonText: '取消' }
    )
  } catch { return }
  broadcastMode.value = true
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
  if (ackTimers[id]) { clearInterval(ackTimers[id]); delete ackTimers[id] }
  try { resizeObservers[id]?.disconnect() } catch {}
  delete resizeObservers[id]
  if (termInstances[id]) {
    if (termInstances[id].zsession) { try { termInstances[id].zsession.close() } catch {} }
    termInstances[id].terminal.dispose(); delete termInstances[id]
  }
  delete termRefs[id]
  delete shellRefs[id]
  terminals.value = terminals.value.filter(t => t.id !== id)
  if (activeTab.value === id) activeTab.value = terminals.value[0]?.id || ''
}

function closeAll() {
  terminals.value.map(t => t.id).forEach(closeTerminal)
  broadcastMode.value = false
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

// 新会话渲染后绑拖拽 + 聚焦
watch(terminals, () => {
  nextTick(() => {
    terminals.value.forEach(t => { if (termRefs[t.id] && !termRefs[t.id].__dropBound) { bindDrop(t.id); termRefs[t.id].__dropBound = true } })
  })
}, { deep: true })
</script>

<style scoped>
.terminal-layout {
  display: grid;
  grid-template-columns: 260px 1fr;
  height: calc(100vh - 56px);
  gap: 0;
}
.terminal-layout.with-panel { grid-template-columns: 260px 1fr 400px; }

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
.rec-dot { color: #ef4444; font-size: 10px; animation: recblink 1.2s infinite; margin-left: 2px; }
@keyframes recblink { 50% { opacity: 0.3; } }
.session-ip { font-family: 'JetBrains Mono', ui-monospace, monospace; cursor: pointer; transition: color 0.15s; }
.session-ip:hover { color: var(--primary-color); }
.session-close { color: var(--text-muted); cursor: pointer; padding: 4px; border-radius: 4px; flex-shrink: 0; }
.session-close:hover { color: var(--color-danger); background: var(--color-danger-soft); }
.sidebar-empty { padding: 40px 0; text-align: center; color: var(--text-muted); font-size: 13px; }
.sidebar-bottom { padding: 10px 12px; border-top: 1px solid var(--border-color); }

/* 右侧终端 */
.term-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }

/* 工具栏 */
.term-toolbar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 6px 10px; border-bottom: 1px solid var(--border-color);
  background: var(--surface); min-height: 40px;
}
.quick-commands { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; overflow: hidden; flex-wrap: wrap; }
.qc-label { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
.qc-chip {
  border: 1px solid var(--border-color); background: transparent; color: var(--text-secondary, var(--text-primary));
  border-radius: 999px; padding: 3px 10px; font-size: 12px; cursor: pointer; white-space: nowrap;
  max-width: 160px; overflow: hidden; text-overflow: ellipsis;
  transition: border-color 0.15s, color 0.15s;
}
.qc-chip:hover { border-color: var(--primary-color); color: var(--primary-color); }
.qc-manage { display: inline-flex; align-items: center; padding: 3px 6px; }
.qc-star { margin-right: 4px; color: #f59e0b; }
.term-toolbar-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.tool-btn {
  display: grid; place-items: center; width: 30px; height: 30px;
  border: 1px solid var(--border-color); border-radius: 8px; background: transparent;
  color: var(--text-muted, var(--text-primary)); cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.tool-btn:hover, .tool-btn.on { color: var(--primary-color); border-color: var(--primary-color); }

.empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  height: 100%; color: var(--text-muted); gap: 12px;
}
.empty-state p { font-size: 15px; margin: 0; }
.empty-tips { font-size: 12px !important; opacity: 0.8; }

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

/* 终端内补全浮层 */
.term-suggest {
  position: absolute; z-index: 5; left: 12px; bottom: 12px;
  min-width: 260px; max-width: 420px; max-height: 240px; overflow-y: auto;
  border: 1px solid #29383a; border-radius: 10px;
  background: rgba(17,26,29,0.97); backdrop-filter: blur(8px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.35);
}
.suggest-item { display: flex; align-items: baseline; gap: 8px; padding: 6px 10px; cursor: pointer; }
.suggest-item.active { background: rgba(8,145,178,0.18); }
.suggest-item code { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; color: #d8dddc; white-space: nowrap; }
.suggest-item small { font-size: 11px; color: #8a9695; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.suggest-tip { padding: 4px 10px 6px; font-size: 10px; color: #5a6a68; border-top: 1px solid #29383a; }

/* ZMODEM 进度条 */
.zmodem-bar {
  position: absolute; z-index: 6; top: 9px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 8px;
  padding: 6px 14px; border-radius: 999px; border: 1px solid #f59e0b;
  background: rgba(17,26,29,0.95); color: #f59e0b; font-size: 12px;
}
.zmodem-spin { animation: zspin 1s linear infinite; }
@keyframes zspin { to { transform: rotate(360deg); } }

.term-composer {
  position: relative; z-index: 2; display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto;
  gap: 8px; padding: 9px 10px; border-top: 1px solid #29383a; background: #111a1d;
}
.composer-suggest {
  position: absolute; z-index: 6; left: 10px; bottom: calc(100% + 6px);
  min-width: 280px; max-width: 440px; max-height: 240px; overflow-y: auto;
  border: 1px solid #29383a; border-radius: 10px;
  background: rgba(17,26,29,0.97); backdrop-filter: blur(8px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.35);
}
.term-composer input {
  min-width: 0; border: 1px solid #29383a; border-radius: 8px; padding: 9px 11px;
  color: #d8dddc; background: #0b1214; font: 12px ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, Consolas, monospace;
  outline: none; transition: border-color 0.15s;
}
.term-composer input:focus { border-color: var(--primary-color); }
.term-composer input::placeholder { color: #5a6a68; }
.term-composer button { border: 0; border-radius: 8px; padding: 0 16px; color: #05251c; background: var(--primary-color); font-weight: 700; font-size: 13px; cursor: pointer; }

.encoding-select {
  border: 1px solid #29383a; border-radius: 8px; padding: 0 6px;
  color: #8a9695; background: #0b1214; font-size: 12px; cursor: pointer; outline: none;
  transition: color .15s, border-color .15s; max-width: 130px;
}
.encoding-select:hover, .encoding-select:focus { color: #d8dddc; border-color: var(--primary-color); }
.encoding-select option { background: #111a1d; color: #d8dddc; }

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

/* 右侧面板 */
.term-panel {
  display: flex; flex-direction: column; min-width: 0; min-height: 0;
  border-left: 1px solid var(--border-color); background: var(--surface); overflow: hidden;
}
.panel-head {
  display: flex; align-items: center; gap: 4px;
  padding: 8px 10px; border-bottom: 1px solid var(--border-color);
}
.panel-tab {
  border: 0; background: transparent; color: var(--text-muted, var(--text-primary));
  font-size: 13px; font-weight: 600; padding: 5px 12px; border-radius: 8px; cursor: pointer;
}
.panel-tab.on { color: var(--primary-color); background: var(--primary-bg); }
.panel-close { margin-left: auto; cursor: pointer; color: var(--text-muted); padding: 4px; }
.panel-close:hover { color: var(--text-primary); }
.panel-body { flex: 1; min-height: 0; padding: 10px 12px; display: flex; flex-direction: column; }

/* 右键菜单 */
.ctx-menu {
  position: fixed; z-index: 3000; min-width: 170px;
  border: 1px solid var(--border-color); border-radius: 10px; overflow: hidden;
  background: var(--surface, #111a1d); box-shadow: 0 10px 30px rgba(0,0,0,0.35);
  padding: 4px;
}
.ctx-menu button {
  display: block; width: 100%; text-align: left;
  border: 0; background: transparent; color: var(--text-primary, #d8dddc);
  font-size: 13px; padding: 7px 12px; border-radius: 6px; cursor: pointer;
}
.ctx-menu button:hover { background: var(--primary-bg); color: var(--primary-color); }
.ctx-divider { height: 1px; background: var(--border-color); margin: 4px 6px; }

@media (max-width: 768px) {
  .terminal-layout { grid-template-columns: 1fr; }
  .terminal-layout.with-panel { grid-template-columns: 1fr; }
  .term-sidebar { display: none; }
  .term-panel { position: fixed; right: 0; top: 56px; bottom: 0; width: min(400px, 100vw); z-index: 50; }
}
</style>
