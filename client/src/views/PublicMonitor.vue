<template>
  <div class="public-monitor">
    <header class="pm-header">
      <div>
        <div class="pm-brand">SSHWeb</div>
        <h1>实时监控</h1>
      </div>
      <div class="pm-summary">
        <div class="pm-stat"><span>在线</span><strong>{{ summary.online }} / {{ summary.total }}</strong></div>
        <div class="pm-stat danger" v-if="summary.critical > 0"><span>告警</span><strong>{{ summary.critical }}</strong></div>
        <div class="pm-updated">更新 {{ updatedText }}</div>
      </div>
    </header>

    <main class="pm-main">
      <el-alert v-if="error" :title="error" type="warning" show-icon :closable="false" class="pm-alert" />
      <div v-else-if="loading && !servers.length" class="pm-loading">正在加载监控数据...</div>

      <div v-else class="pm-grid">
        <article v-for="server in servers" :key="`${server.name}-${server.group_name || ''}`" class="mc-card" :class="cardHealth(server).className">
          <div class="mc-head">
            <div class="mc-title-row">
              <strong :title="server.name">{{ server.name }}</strong>
              <span v-if="server.group_name" class="mc-tag">{{ server.group_name }}</span>
              <span class="mc-status" :class="server.status"><i></i>{{ statusText(server.status) }}</span>
            </div>
            <div class="mc-host">{{ server.os_info || '-' }}</div>
          </div>

          <div class="mc-metrics">
            <div class="mc-metric">
              <span>CPU</span>
              <strong :class="pct(server.cpu_usage) >= 90 ? 'high' : pct(server.cpu_usage) >= 70 ? 'warn' : ''">{{ pct(server.cpu_usage) }}%</strong>
              <div class="mc-bar"><div :style="{ width: pct(server.cpu_usage) + '%', background: usageColor(server.cpu_usage) }"></div></div>
              <small>{{ server._sys?.cpu_cores || '?' }} 核</small>
            </div>
            <div class="mc-metric">
              <span>内存</span>
              <strong :class="pct(server.memory_usage) >= 90 ? 'high' : pct(server.memory_usage) >= 70 ? 'warn' : ''">{{ pct(server.memory_usage) }}%</strong>
              <div class="mc-bar"><div :style="{ width: pct(server.memory_usage) + '%', background: usageColor(server.memory_usage) }"></div></div>
              <small>{{ mb(server.mem_used_mb) }} / {{ mb(server.mem_total_mb) }}</small>
            </div>
            <div class="mc-metric">
              <span>磁盘</span>
              <strong :class="pct(server.disk_usage) >= 90 ? 'high' : pct(server.disk_usage) >= 70 ? 'warn' : ''">{{ pct(server.disk_usage) }}%</strong>
              <div class="mc-bar"><div :style="{ width: pct(server.disk_usage) + '%', background: usageColor(server.disk_usage) }"></div></div>
              <small>{{ mb(server.disk_used_mb) }} / {{ mb(server.disk_total_mb) }}</small>
            </div>
          </div>

          <div class="mc-details">
            <div><span>负载</span><strong>{{ server.load_avg || '-' }}</strong></div>
            <div><span>运行</span><strong :title="server.uptime || ''">{{ server.uptime || '-' }}</strong></div>
            <div><span>下行</span><strong>{{ bytes(server.network_rx_bytes) }}</strong></div>
            <div><span>上行</span><strong>{{ bytes(server.network_tx_bytes) }}</strong></div>
            <div><span>TCP</span><strong>{{ server.tcp_connections ?? '-' }}</strong></div>
            <div><span>UDP</span><strong>{{ server.udp_connections ?? '-' }}</strong></div>
          </div>

          <div class="mc-sysinfo" v-if="server._sys && Object.keys(server._sys).length">
            <div><span>内核</span><strong>{{ server._sys.kernel || '-' }}</strong></div>
            <div><span>架构</span><strong>{{ server._sys.arch || '-' }}</strong></div>
            <div><span>拥塞</span><strong>{{ server._sys.tcp_congestion || '-' }}</strong></div>
          </div>

          <footer class="mc-footer">
            <span>到期 {{ server._expiry?.date || '永久' }}</span>
            <div class="mc-expiry" v-if="server._expiry" :class="server._expiry.className">{{ server._expiry.text }}</div>
          </footer>
        </article>
      </div>
    </main>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import api from '../api'

const route = useRoute()
const servers = ref([])
const summary = ref({ total: 0, online: 0, offline: 0, unknown: 0, critical: 0 })
const loading = ref(false)
const error = ref('')
const updatedAt = ref('')
let timer = null

const updatedText = computed(() => {
  if (!updatedAt.value) return '-'
  return new Date(updatedAt.value).toLocaleTimeString('zh-CN', { hour12: false })
})

onMounted(() => { loadMonitor(); timer = window.setInterval(loadMonitor, 5000) })
onBeforeUnmount(() => { if (timer) window.clearInterval(timer) })

async function loadMonitor() {
  loading.value = true
  try {
    const res = await api.get(`/api/public/monitor/${route.params.shareKey}`)
    if (res.code === 0) {
      servers.value = (res.data.servers || []).map(s => {
        let info = s.system_info
        if (typeof info === 'string') { try { info = JSON.parse(info) } catch { info = {} } }
        s._sys = info || {}
        s._expiry = expiryDisplay(s.expires_at)
        return s
      })
      summary.value = res.data.summary || summary.value
      updatedAt.value = res.data.generated_at || new Date().toISOString()
      error.value = ''
    } else { error.value = res.message || '无法加载公开监控' }
  } catch (err) { error.value = '无法连接公开监控接口' }
  finally { loading.value = false }
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0 }
function pct(v) { const n = num(v); if (n <= 0) return 0; return Math.min(100, Math.round(n * 10) / 10) }
function cardHealth(server) {
  if (server.status !== 'online') return { color: '#94a3b8', className: 'offline' }
  if (pct(server.cpu_usage) >= 90 || pct(server.memory_usage) >= 90 || pct(server.disk_usage) >= 90) return { color: '#ef4444', className: 'critical' }
  if (pct(server.cpu_usage) >= 70 || pct(server.memory_usage) >= 70 || pct(server.disk_usage) >= 70) return { color: '#f59e0b', className: 'warning' }
  return { color: '#22c55e', className: 'normal' }
}
function usageColor(v) { const n = num(v); if (n >= 90) return '#ef4444'; if (n >= 70) return '#f59e0b'; return '#0891b2' }
function mb(v) { const n = num(v); if (n <= 0) return '-'; if (n >= 1024) return (n / 1024).toFixed(1) + ' GB'; return n + ' MB' }
function bytes(v) {
  let n = num(v); if (n <= 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1 }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}
function statusText(status) { return status === 'online' ? '在线' : status === 'offline' ? '离线' : '未知' }
function expiryDisplay(expiresAt) {
  if (!expiresAt) return null
  const date = String(expiresAt).slice(0, 10)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const days = Math.round((new Date(date + 'T00:00:00') - today) / 86400000)
  if (days < 0) return { date, text: `已过期 ${Math.abs(days)} 天`, className: 'expired' }
  if (days === 0) return { date, text: '今天到期', className: 'expired' }
  if (days <= 30) return { date, text: `剩余 ${days} 天`, className: 'expiring' }
  return { date, text: `剩余 ${days} 天`, className: '' }
}
</script>

<style scoped>
.public-monitor { min-height: 100vh; background: var(--bg-color, #f3f7f6); color: #172323; }
.pm-header {
  position: sticky; top: 0; z-index: 5;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 18px 24px; background: rgba(255,255,255,0.94);
  border-bottom: 1px solid #dde7e4; backdrop-filter: blur(10px);
}
.pm-brand { color: #0891b2; font-size: 13px; font-weight: 700; letter-spacing: 0.8px; }
.pm-header h1 { margin: 4px 0 0; font-size: 22px; line-height: 1.2; }
.pm-summary { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
.pm-stat { min-width: 88px; padding: 8px 12px; border-radius: 8px; background: #ecfdf5; border: 1px solid #bbf7d0; }
.pm-stat span { display: block; color: #64748b; font-size: 12px; }
.pm-stat strong { color: #16a34a; font-size: 20px; line-height: 1.1; }
.pm-stat.danger { background: #fceaea; border-color: #fecaca; }
.pm-stat.danger strong { color: #cc4545; }
.pm-updated { color: #64748b; font-size: 13px; }
.pm-main { padding: 20px 24px 32px; }
.pm-alert { margin-bottom: 16px; }
.pm-loading { padding: 80px 0; text-align: center; color: #94a3b8; }

.pm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 16px; }

/* ═══ KPanel 风格卡片 ═══ */
.mc-card {
  display: flex; flex-direction: column; overflow: hidden;
  background: #fff; border: 1px solid #dde7e4; border-left: 3px solid #0891b2;
  border-radius: 12px; box-shadow: 0 1px 2px rgba(20,48,42,0.05), 0 4px 16px rgba(20,48,42,0.04);
  transition: box-shadow 0.25s ease, transform 0.25s ease;
}
.mc-card:hover { box-shadow: 0 14px 40px rgba(18,47,41,0.12); transform: translateY(-2px); }
.mc-card.warning { border-left-color: #f59e0b; }
.mc-card.critical { border-left-color: #ef4444; }
.mc-card.offline { border-left-color: #94a3b8; opacity: 0.65; }

.mc-head { padding: 16px; border-bottom: 1px solid #dde7e4; }
.mc-title-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.mc-title-row strong { font-size: 15px; font-weight: 650; color: #172323; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-tag { flex-shrink: 0; padding: 2px 8px; background: rgba(8,145,178,0.08); color: #0891b2; border-radius: 999px; font-size: 10px; font-weight: 700; }
.mc-status { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; background: #f7faf9; color: #718080; }
.mc-status i { width: 6px; height: 6px; border-radius: 50%; background: #718080; }
.mc-status.online { background: #dcfce7; color: #16a34a; }
.mc-status.online i { background: #16a34a; }
.mc-status.offline { background: #fceaea; color: #cc4545; }
.mc-status.offline i { background: #cc4545; }
.mc-host { color: #718080; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.mc-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: #dde7e4; border-bottom: 1px solid #dde7e4; }
.mc-metric { display: flex; flex-direction: column; gap: 5px; padding: 12px; background: #fff; }
.mc-metric span { color: #718080; font-size: 10px; font-weight: 600; text-transform: uppercase; }
.mc-metric strong { font-size: 18px; font-weight: 700; color: #172323; }
.mc-metric strong.high { color: #ef4444; }
.mc-metric strong.warn { color: #f59e0b; }
.mc-metric small { color: #718080; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-bar { height: 3px; background: #dde7e4; border-radius: 99px; overflow: hidden; }
.mc-bar > div { height: 100%; border-radius: inherit; transition: width 0.3s ease; }

.mc-details { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 12px; padding: 14px 16px; border-bottom: 1px solid #dde7e4; }
.mc-details > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mc-details span { color: #718080; font-size: 10px; font-weight: 600; }
.mc-details strong { font-size: 12px; color: #3d4d4d; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.mc-sysinfo { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 12px; padding: 12px 16px; border-bottom: 1px solid #dde7e4; }
.mc-sysinfo > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mc-sysinfo span { color: #718080; font-size: 10px; font-weight: 600; }
.mc-sysinfo strong { font-size: 12px; color: #3d4d4d; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.mc-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 16px; margin-top: auto; }
.mc-footer > span { color: #718080; font-size: 11px; }
.mc-expiry { padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; background: #f7faf9; color: #718080; }
.mc-expiry.expiring { background: #fff3dc; color: #c47a16; }
.mc-expiry.expired { background: #fceaea; color: #cc4545; }

@media (max-width: 768px) {
  .pm-header { align-items: flex-start; flex-direction: column; padding: 16px; }
  .pm-summary { justify-content: flex-start; }
  .pm-main { padding: 14px; }
  .pm-grid { grid-template-columns: 1fr; }
}
</style>
