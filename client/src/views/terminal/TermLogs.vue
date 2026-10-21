<template>
  <div class="page-container">
    <el-card shadow="hover">
      <div class="toolbar">
        <div class="toolbar-left">
          <el-input v-model="query.username" placeholder="按用户筛选" clearable size="small" style="width: 150px" @change="load(1)" />
          <el-select v-model="query.serverId" placeholder="全部服务器" clearable filterable size="small" style="width: 200px" @change="load(1)">
            <el-option v-for="s in servers" :key="s.id" :label="`${s.name} (${s.host})`" :value="s.id" />
          </el-select>
          <span class="text-muted" style="font-size:12px">录制开关在「系统设置 → 终端录制」</span>
        </div>
        <el-button :icon="Refresh" size="small" @click="load()">刷新</el-button>
      </div>

      <el-table :data="list" v-loading="loading" size="small">
        <el-table-column label="开始时间" width="170">
          <template #default="{ row }">
            <span v-if="row.active" class="rec-live">● 录制中</span>
            {{ formatTime(row.startedAt) }}
          </template>
        </el-table-column>
        <el-table-column prop="username" label="用户" width="110" />
        <el-table-column label="服务器" min-width="180">
          <template #default="{ row }">{{ row.serverName || '-' }} <span class="text-muted">{{ row.host }}</span></template>
        </el-table-column>
        <el-table-column label="大小" width="90">
          <template #default="{ row }">{{ formatSize(row.size) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="right">
          <template #default="{ row }">
            <el-button type="primary" text size="small" :disabled="row.active" @click="play(row)">回放</el-button>
            <el-button v-if="isAdmin" type="danger" text size="small" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div style="display:flex;justify-content:flex-end;margin-top:10px">
        <el-pagination small background layout="total, prev, pager, next" :total="total" :page-size="query.pageSize" :current-page="query.page" @current-change="p => load(p)" />
      </div>
    </el-card>

    <!-- 回放对话框 -->
    <el-dialog v-model="player.visible" :title="player.title" width="860px" top="6vh" destroy-on-close @closed="closePlayer">
      <div class="player-term" ref="playerEl"></div>
      <div class="player-bar" v-if="player.events.length">
        <el-button size="small" circle @click="togglePlay">
          <el-icon><component :is="player.playing ? VideoPause : VideoPlay" /></el-icon>
        </el-button>
        <span class="player-time tabular">{{ formatClock(player.pos) }} / {{ formatClock(player.duration) }}</span>
        <el-slider v-model="player.pos" :min="0" :max="player.duration" :step="0.1" style="flex:1" @change="seek" />
        <el-select v-model="player.speed" size="small" style="width: 92px">
          <el-option v-for="s in [0.5, 1, 2, 4, 8, 16, 32]" :key="s" :label="`${s}×`" :value="s" />
        </el-select>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount, computed, nextTick } from 'vue'
import { Refresh, VideoPlay, VideoPause } from '@element-plus/icons-vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../../api'
import { terminalTheme } from '../../utils/terminal-prefs'
import '@xterm/xterm/css/xterm.css'

const isAdmin = computed(() => {
  try {
    const payload = localStorage.getItem('token').split('.')[1]
    const json = decodeURIComponent(escape(window.atob(payload.replace(/-/g, '+').replace(/_/g, '/'))))
    const role = JSON.parse(json).role
    return role === 'admin' || role === 'superadmin'
  } catch { return false }
})

const servers = ref([])
const list = ref([])
const loading = ref(false)
const total = ref(0)
const query = reactive({ username: '', serverId: '', page: 1, pageSize: 20 })

const player = reactive({
  visible: false, title: '', playing: false, pos: 0, duration: 0, speed: 2,
  events: [], cursor: 0, timer: null, startedAt: 0
})
const playerEl = ref(null)
let pterm = null
let pfit = null

async function load(page) {
  if (page) query.page = page
  loading.value = true
  try {
    const res = await api.get('/api/term-logs', { params: { ...query } })
    if (res.code === 0) { list.value = res.data.list; total.value = res.data.total }
  } finally { loading.value = false }
}

function formatTime(ts) {
  if (!ts) return '-'
  const d = new Date(Number(ts))
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
function formatSize(n) {
  if (n > 1048576) return (n / 1048576).toFixed(1) + ' MB'
  if (n > 1024) return (n / 1024).toFixed(0) + ' KB'
  return (n || 0) + ' B'
}
function formatClock(sec) {
  const s = Math.floor(sec)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

async function play(row) {
  const res = await api.get(`/api/term-logs/${row.id}/content`)
  if (res.code !== 0) { ElMessage.error(res.message || '加载失败'); return }
  player.title = `${row.serverName || row.host} · ${row.username} · ${formatTime(row.startedAt)}`
  player.events = res.data.events
  player.duration = Math.max(res.data.duration, 0.1)
  player.pos = 0
  player.cursor = 0
  player.visible = true
  player.startedAt = res.data.startedAt

  nextTick(() => {
    pterm = new Terminal({ theme: terminalTheme('dark'), fontSize: 12, scrollback: 5000, disableStdin: true, convertEol: false, cursorBlink: false })
    pfit = new FitAddon()
    pterm.loadAddon(pfit)
    pterm.open(playerEl.value)
    try { pfit.fit() } catch {}
    togglePlay()
  })
}

const TICK = 100

function togglePlay() {
  if (player.playing) {
    player.playing = false
    clearInterval(player.timer)
    player.timer = null
    return
  }
  player.playing = true
  let last = Date.now()
  player.timer = setInterval(() => {
    const now = Date.now()
    const advance = (now - last) / 1000 * player.speed
    last = now
    // 逐事件写入到目标时间点；追上尾帧则自动停止
    let target = player.pos + advance
    if (target >= player.duration) target = player.duration + 1
    const events = player.events
    while (player.cursor < events.length && events[player.cursor][0] <= target) {
      try { pterm.write(events[player.cursor][1]) } catch {}
      player.cursor++
    }
    player.pos = Math.min(target, player.duration)
    if (player.pos >= player.duration && player.cursor >= events.length) {
      player.playing = false
      clearInterval(player.timer)
      player.timer = null
    }
  }, TICK)
}

// 拖动进度：从最近的可起点重放（简单可靠——清屏后从头快放到目标时间点）
function seek(pos) {
  const wasPlaying = player.playing
  if (wasPlaying) togglePlay()
  pterm.reset()
  const events = player.events
  let idx = 0
  while (idx < events.length && events[idx][0] <= pos) {
    try { pterm.write(events[idx][1]) } catch {}
    idx++
  }
  player.cursor = idx
  player.pos = pos
  if (wasPlaying && pos < player.duration) togglePlay()
}

function closePlayer() {
  if (player.playing) { player.playing = false; clearInterval(player.timer) }
  player.timer = null
  player.events = []
  try { pterm?.dispose() } catch {}
  pterm = null
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`删除 ${formatTime(row.startedAt)} 的录制？该操作不可恢复。`, '删除录制', { type: 'warning' })
  } catch { return }
  const res = await api.delete(`/api/term-logs/${row.id}`)
  if (res.code === 0) { ElMessage.success('已删除'); load() }
  else ElMessage.error(res.message || '删除失败')
}

onMounted(async () => {
  load()
  try {
    const res = await api.get('/api/servers')
    if (res.code === 0) servers.value = res.data
  } catch {}
})
onBeforeUnmount(closePlayer)
</script>

<style scoped>
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.toolbar-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.rec-live { color: #ef4444; margin-right: 6px; animation: blink 1.2s infinite; }
@keyframes blink { 50% { opacity: 0.35; } }
.player-term { height: 440px; background: #0b1214; border-radius: 8px; padding: 8px; }
.player-term :deep(.xterm) { height: 100%; }
.player-bar { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
.player-time { font-size: 12px; color: var(--text-muted, #8a9695); font-family: ui-monospace, monospace; white-space: nowrap; }
</style>
