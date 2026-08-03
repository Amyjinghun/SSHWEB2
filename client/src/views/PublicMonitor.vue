<template>
  <div class="public-monitor">
    <header class="pm-header">
      <div>
        <div class="pm-brand">SSHWeb</div>
        <h1>实时监控</h1>
      </div>
      <div class="pm-summary">
        <div class="pm-stat">
          <span>在线</span>
          <strong>{{ summary.online }} / {{ summary.total }}</strong>
        </div>
        <div class="pm-stat danger" v-if="summary.critical > 0">
          <span>告警</span>
          <strong>{{ summary.critical }}</strong>
        </div>
        <div class="pm-updated">更新 {{ updatedText }}</div>
      </div>
    </header>

    <main class="pm-main">
      <el-alert
        v-if="error"
        :title="error"
        type="warning"
        show-icon
        :closable="false"
        class="pm-alert"
      />

      <div v-else-if="loading && !servers.length" class="pm-loading">
        正在加载监控数据...
      </div>

      <div v-else class="pm-grid">
        <div
          v-for="server in servers"
          :key="`${server.name}-${server.group_name || ''}`"
          class="pm-card"
          :class="cardHealth(server).className"
          :style="{ '--health-color': cardHealth(server).color }"
        >
          <div class="pm-card-head">
            <div class="pm-name" :title="server.name">{{ server.name }}</div>
            <div class="pm-status" :class="server.status">
              <i class="status-dot"></i>{{ statusText(server.status) }}
            </div>
          </div>
          <div class="pm-meta">
            <span :title="server.os_info">{{ server.os_info || '-' }}</span>
            <span v-if="server.group_name" class="pm-tag">{{ server.group_name }}</span>
          </div>

          <div class="pm-bar-row">
            <div class="pm-bar-label"><span>CPU</span><span>{{ pct(server.cpu_usage) }}%</span></div>
            <div class="pm-bar"><div class="pm-bar-fill" :style="{ width: pct(server.cpu_usage) + '%', background: usageColor(server.cpu_usage) }"></div></div>
          </div>
          <div class="pm-bar-row">
            <div class="pm-bar-label">
              <span>内存</span>
              <span>{{ pct(server.memory_usage) }}% <em>{{ mb(server.mem_used_mb) }} / {{ mb(server.mem_total_mb) }}</em></span>
            </div>
            <div class="pm-bar"><div class="pm-bar-fill" :style="{ width: pct(server.memory_usage) + '%', background: usageColor(server.memory_usage) }"></div></div>
          </div>
          <div class="pm-bar-row">
            <div class="pm-bar-label">
              <span>磁盘</span>
              <span>{{ pct(server.disk_usage) }}% <em>{{ mb(server.disk_used_mb) }} / {{ mb(server.disk_total_mb) }}</em></span>
            </div>
            <div class="pm-bar"><div class="pm-bar-fill" :style="{ width: pct(server.disk_usage) + '%', background: usageColor(server.disk_usage) }"></div></div>
          </div>

          <div class="pm-footer">
            <span :title="'负载 ' + (server.load_avg || '-')">负载 {{ server.load_avg || '-' }}</span>
            <span :title="server.uptime || ''">{{ server.uptime || '-' }}</span>
          </div>

          <!-- 系统信息（公开页只显示非敏感字段，公网IP/DNS/位置已在后端过滤） -->
          <div class="pm-info-grid" v-if="server._sys && Object.keys(server._sys).length">
            <div class="pm-info-cell"><span>内核</span><strong :title="server._sys.kernel">{{ server._sys.kernel || '-' }}</strong></div>
            <div class="pm-info-cell"><span>架构</span><strong>{{ server._sys.arch || '-' }}</strong></div>
            <div class="pm-info-cell"><span>CPU</span><strong>{{ server._sys.cpu_cores || '?' }}核</strong></div>
            <div class="pm-info-cell"><span>拥塞</span><strong>{{ server._sys.tcp_congestion || '-' }}</strong></div>
          </div>

          <div class="pm-network">
            <span>↓ {{ bytes(server.network_rx_bytes) }}</span>
            <span>↑ {{ bytes(server.network_tx_bytes) }}</span>
          </div>
          <div class="pm-network">
            <span>TCP {{ server.tcp_connections ?? '-' }}</span>
            <span>UDP {{ server.udp_connections ?? '-' }}</span>
          </div>
          <div class="pm-expiry" v-if="server._expiry" :class="server._expiry.className">
            <span>到期 {{ server._expiry.date }}</span>
            <strong>{{ server._expiry.text }}</strong>
          </div>
        </div>
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

onMounted(() => {
  loadMonitor()
  timer = window.setInterval(loadMonitor, 5000)
})

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
})

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
    } else {
      error.value = res.message || '无法加载公开监控'
    }
  } catch (err) {
    error.value = '无法连接公开监控接口'
  } finally {
    loading.value = false
  }
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function pct(v) {
  const n = num(v)
  if (n <= 0) return 0
  return Math.min(100, Math.round(n * 10) / 10)
}
function cardHealth(server) {
  if (server.status !== 'online') return { color: '#94a3b8', className: 'offline' }
  if (pct(server.cpu_usage) >= 90 || pct(server.memory_usage) >= 90 || pct(server.disk_usage) >= 90) return { color: '#ef4444', className: 'critical' }
  if (pct(server.cpu_usage) >= 70 || pct(server.memory_usage) >= 70 || pct(server.disk_usage) >= 70) return { color: '#f59e0b', className: 'warning' }
  return { color: '#22c55e', className: 'normal' }
}
function usageColor(v) {
  const n = num(v)
  if (n >= 90) return '#ef4444'
  if (n >= 70) return '#f59e0b'
  return '#22c55e'
}
function mb(v) {
  const n = num(v)
  if (n <= 0) return '-'
  if (n >= 1024) return (n / 1024).toFixed(1) + ' GB'
  return n + ' MB'
}
function bytes(v) {
  let n = num(v)
  if (n <= 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}
function statusText(status) {
  return status === 'online' ? '在线' : status === 'offline' ? '离线' : '未知'
}

function expiryDisplay(expiresAt) {
  if (!expiresAt) return null
  const date = String(expiresAt).slice(0, 10)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((new Date(date + 'T00:00:00') - today) / 86400000)
  if (days < 0) return { date, text: `已过期 ${Math.abs(days)} 天`, className: 'expired' }
  if (days === 0) return { date, text: '今天到期', className: 'expired' }
  if (days <= 30) return { date, text: `剩余 ${days} 天`, className: 'expiring' }
  return { date, text: `剩余 ${days} 天`, className: '' }
}
</script>

<style scoped>
.public-monitor {
  min-height: 100vh;
  background: #f4f6fb;
  color: #1e293b;
}
.pm-header {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 24px;
  background: rgba(255,255,255,0.94);
  border-bottom: 1px solid #e8ecf4;
  backdrop-filter: blur(10px);
}
.pm-brand {
  color: #4f6ef7;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.8px;
}
h1 {
  margin: 4px 0 0;
  font-size: 22px;
  line-height: 1.2;
}
.pm-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.pm-stat {
  min-width: 88px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #ecfdf5;
  border: 1px solid #bbf7d0;
}
.pm-stat span {
  display: block;
  color: #64748b;
  font-size: 12px;
}
.pm-stat strong {
  color: #16a34a;
  font-size: 20px;
  line-height: 1.1;
}
.pm-stat.danger {
  background: #fef2f2;
  border-color: #fecaca;
}
.pm-stat.danger strong { color: #dc2626; }
.pm-updated {
  color: #64748b;
  font-size: 13px;
}
.pm-main { padding: 20px 24px 32px; }
.pm-alert { margin-bottom: 16px; }
.pm-loading {
  padding: 80px 0;
  text-align: center;
  color: #94a3b8;
}
.pm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}
.pm-card {
  background: #fff;
  border: 1px solid #e8ecf4;
  border-left: 4px solid var(--health-color);
  border-radius: 10px;
  padding: 14px 14px 14px 12px;
  box-shadow: 0 1px 3px rgba(15,23,42,0.04);
}
.pm-card.warning { background: #fffaf0; border-color: #fde68a; border-left-color: var(--health-color); }
.pm-card.critical { background: #fff7f7; border-color: #fecaca; border-left-color: var(--health-color); }
.pm-card.offline { opacity: 0.72; background: #f1f5f9; border-color: #e2e8f0; border-left-color: var(--health-color); }
.pm-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.pm-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 700;
}
.pm-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #64748b;
  font-size: 12px;
  white-space: nowrap;
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}
.pm-status.online { color: #16a34a; }
.pm-status.online .status-dot { background: #22c55e; box-shadow: 0 0 6px rgba(34,197,94,0.5); }
.pm-status.offline { color: #ef4444; }
.pm-status.offline .status-dot { background: #ef4444; }
.pm-status.unknown .status-dot { background: #94a3b8; }
.pm-meta {
  min-height: 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  color: #94a3b8;
  font-size: 12px;
}
.pm-meta span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pm-tag {
  flex-shrink: 0;
  color: #4f6ef7;
  background: #eef2ff;
  border-radius: 10px;
  padding: 1px 8px;
}
.pm-bar-row { margin-bottom: 8px; }
.pm-bar-label {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
  color: #64748b;
  font-size: 12px;
}
.pm-bar-label em {
  color: #94a3b8;
  font-style: normal;
  margin-left: 4px;
}
.pm-bar {
  height: 6px;
  background: #e8ecf4;
  border-radius: 4px;
  overflow: hidden;
}
.pm-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.5s ease, background 0.3s ease;
}
.pm-footer {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #e8ecf4;
  color: #94a3b8;
  font-size: 11px;
  overflow: hidden;
}
.pm-network {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
  color: #06b6d4;
  font-size: 11px;
}
.pm-info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 10px;
  padding: 8px 0 4px;
  margin-top: 4px;
  border-top: 1px dashed #e8ecf4;
}
.pm-info-cell {
  display: flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
  font-size: 11px;
}
.pm-info-cell span {
  flex-shrink: 0;
  color: #94a3b8;
}
.pm-info-cell strong {
  min-width: 0;
  overflow: hidden;
  color: #334155;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pm-expiry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 11px;
  background: #f1f5f9;
  color: #64748b;
}
.pm-expiry strong {
  font-weight: 600;
}
.pm-expiry.expiring {
  background: #fffbeb;
  color: #b45309;
}
.pm-expiry.expired {
  background: #fef2f2;
  color: #dc2626;
}
@media (max-width: 768px) {
  .pm-header { align-items: flex-start; flex-direction: column; padding: 16px; }
  .pm-summary { justify-content: flex-start; }
  .pm-main { padding: 14px; }
  .pm-grid { grid-template-columns: 1fr; }
}
</style>
