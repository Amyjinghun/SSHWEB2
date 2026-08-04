<template>
  <div class="page-container">
    <!-- 服务器选择 -->
    <div class="toolbar">
      <el-select v-model="selectedServers" placeholder="勾选服务器" filterable multiple collapse-tags collapse-tags-tooltip style="flex:1;min-width:300px" @change="onSelectionChange">
        <el-option v-for="s in servers" :key="s.id" :label="`${s.name} (${s.host})`" :value="s.id" />
      </el-select>
      <el-select v-model="groupId" placeholder="按分组" clearable size="default" style="width:140px" @change="selectByGroup">
        <el-option v-for="g in groups" :key="g.id" :label="g.name" :value="g.id" />
      </el-select>
    </div>

    <el-empty v-if="!selectedServers.length" description="请先勾选要操作的服务器" />

    <div v-else class="feature-grid">
      <!-- 功能卡片 -->
      <div v-for="f in features" :key="f.key" class="feature-card">
        <div class="feature-head">
          <span class="feature-icon" :style="{ background: f.tint, color: f.color }"><el-icon :size="20"><component :is="f.icon" /></el-icon></span>
          <div>
            <strong>{{ f.title }}</strong>
            <p>{{ f.desc }}</p>
          </div>
        </div>
        <div class="feature-body">
          <el-button size="small" @click="execFeature(f.key, 'get')">查看当前</el-button>
          <template v-if="f.key === 'ssh-port'">
            <el-input-number v-model="forms.sshPort" :min="1" :max="65535" size="small" style="width:120px" />
            <el-button size="small" type="warning" @click="execFeature(f.key, 'set', { port: forms.sshPort })">修改端口</el-button>
          </template>
          <template v-if="f.key === 'dns'">
            <el-input v-model="forms.dns" placeholder="8.8.8.8,1.1.1.1" size="small" style="width:160px" />
            <el-button size="small" type="warning" @click="execFeature(f.key, 'set', { dns: forms.dns })">设置 DNS</el-button>
          </template>
          <template v-if="f.key === 'timezone'">
            <el-select v-model="forms.timezone" size="small" style="width:180px" placeholder="选择时区">
              <el-option v-for="tz in timezones" :key="tz" :label="tz" :value="tz" />
            </el-select>
            <el-button size="small" type="warning" @click="execFeature(f.key, 'set', { timezone: forms.timezone })">设置时区</el-button>
          </template>
          <template v-if="f.key === 'swap'">
            <el-input-number v-model="forms.swapSize" :min="128" :max="16384" :step="512" size="small" style="width:120px" /> MB
            <el-button size="small" type="success" @click="execFeature(f.key, 'create', { size: forms.swapSize })">创建 Swap</el-button>
            <el-button size="small" type="danger" @click="execFeature(f.key, 'delete')">删除 Swap</el-button>
          </template>
          <template v-if="f.key === 'bbr'">
            <el-button size="small" type="success" @click="execFeature(f.key, 'enable')">启用 BBR</el-button>
          </template>
          <template v-if="f.key === 'update'">
            <el-button size="small" type="warning" :loading="running" @click="execFeature(f.key)">执行更新</el-button>
          </template>
          <template v-if="f.key === 'clean'">
            <el-button size="small" type="danger" :loading="running" @click="execFeature(f.key)">执行清理</el-button>
          </template>
          <template v-if="f.key === 'benchmark'">
            <el-button size="small" type="primary" :loading="running" @click="execFeature(f.key)">开始测试</el-button>
          </template>
          <template v-if="f.key === 'mirror'">
            <el-select v-model="forms.mirror" size="small" style="width:150px" placeholder="选择镜像源">
              <el-option-group label="国内">
                <el-option label="阿里云" value="aliyun" />
                <el-option label="清华大学" value="tsinghua" />
                <el-option label="中科大" value="ustc" />
                <el-option label="腾讯云" value="tencent" />
                <el-option label="华为云" value="huawei" />
              </el-option-group>
              <el-option-group label="海外">
                <el-option label="日本" value="japan" />
                <el-option label="韩国" value="korea" />
                <el-option label="新加坡" value="singapore" />
                <el-option label="德国" value="germany" />
                <el-option label="法国" value="france" />
                <el-option label="英国" value="uk" />
                <el-option label="美国" value="us" />
                <el-option label="官方默认" value="official" />
              </el-option-group>
            </el-select>
            <el-button size="small" type="warning" @click="execFeature(f.key, 'set', { mirror: forms.mirror })" :disabled="!forms.mirror">换源</el-button>
          </template>
        </div>
      </div>
    </div>

    <!-- 操作结果 -->
    <el-card v-if="results.length" shadow="hover" style="margin-top:16px">
      <template #header>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="card-title">操作结果</span>
          <el-button text :icon="Close" @click="results = []" />
        </div>
      </template>
      <div v-for="r in results" :key="r.server_id + r.action" class="result-item">
        <div class="result-head">
          <el-tag :type="r.success ? 'success' : 'danger'" size="small" effect="dark">{{ r.success ? '成功' : '失败' }}</el-tag>
          <strong>{{ r.server_name }}</strong>
          <span class="result-host">{{ r.host }}</span>
        </div>
        <pre v-if="r.data" class="result-output">{{ r.data }}</pre>
        <div v-if="r.message" class="result-error">{{ r.message }}</div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Connection, SetUp, Timer, Coin, DataLine, Refresh, Tools, Odometer, Close, Link } from '@element-plus/icons-vue'
import api from '../../api'
import { ElMessage } from 'element-plus'

const servers = ref([])
const groups = ref([])
const selectedServers = ref([])
const groupId = ref('')
const running = ref(false)
const results = ref([])

const forms = ref({ sshPort: 22, dns: '', timezone: '', swapSize: 1024, mirror: '' })

const timezones = ['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Singapore', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Frankfurt', 'UTC']

const features = [
  { key: 'info', title: '系统信息', desc: 'SSH端口/DNS/时区/Swap/BBR/内核/磁盘', icon: SetUp, color: '#0891b2', tint: '#ecfeff' },
  { key: 'ssh-port', title: 'SSH 端口', desc: '查看和修改 SSH 服务端口', icon: Connection, color: '#367bd5', tint: '#e8f1fc' },
  { key: 'dns', title: 'DNS 配置', desc: '查看和修改 /etc/resolv.conf', icon: Connection, color: '#7257cf', tint: '#f0ecfc' },
  { key: 'timezone', title: '时区设置', desc: '查看和设置系统时区', icon: Timer, color: '#c47a16', tint: '#fff3dc' },
  { key: 'swap', title: 'Swap 虚拟内存', desc: '创建或删除 Swap 交换分区', icon: Coin, color: '#16a34a', tint: '#dcfce7' },
  { key: 'bbr', title: 'BBR 拥塞控制', desc: '查看和启用 TCP BBR 加速', icon: DataLine, color: '#0891b2', tint: '#ecfeff' },
  { key: 'update', title: '系统更新', desc: '执行 apt/yum 系统软件更新', icon: Refresh, color: '#c47a16', tint: '#fff3dc' },
  { key: 'clean', title: '系统清理', desc: '清理缓存/日志/旧包/Docker 残留', icon: Tools, color: '#cc4545', tint: '#fceaea' },
  { key: 'benchmark', title: '性能测试', desc: 'CPU/内存/磁盘/网络基准测试', icon: Odometer, color: '#7257cf', tint: '#f0ecfc' },
  { key: 'mirror', title: '软件源', desc: '一键切换 apt 镜像源（国内/海外 13 个可选）', icon: Link, color: '#367bd5', tint: '#e8f1fc' },
]

onMounted(async () => {
  const [sRes, gRes] = await Promise.all([api.get('/api/servers'), api.get('/api/server-groups')])
  if (sRes.code === 0) servers.value = sRes.data
  if (gRes.code === 0) groups.value = gRes.data
})

function onSelectionChange() { results.value = [] }

function selectByGroup(gid) {
  if (!gid) return
  const ids = servers.value.filter(s => s.group_id === gid).map(s => s.id)
  const existing = new Set(selectedServers.value)
  ids.forEach(id => existing.add(id))
  selectedServers.value = [...existing]
}

async function execFeature(key, action, extra = {}) {
  if (!selectedServers.value.length) return ElMessage.warning('请先选择服务器')
  running.value = true
  results.value = []
  try {
    const body = { server_ids: selectedServers.value, ...extra }
    if (action) body.action = action
    const res = await api.post(`/api/system-manage/${key}`, body)
    if (res.code === 0) {
      results.value = (res.data || []).map(r => ({ ...r, action: key }))
      const ok = results.value.filter(r => r.success).length
      const fail = results.value.filter(r => !r.success).length
      ElMessage[fail > 0 ? 'warning' : 'success'](`成功 ${ok} 台${fail ? '，失败 ' + fail + ' 台' : ''}`)
    } else {
      ElMessage.error(res.message)
    }
  } catch (err) {
    ElMessage.error('请求失败')
  } finally { running.value = false }
}
</script>

<style scoped>
.toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 20px; flex-wrap: wrap; }

.feature-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 16px; }

.feature-card {
  background: var(--surface); border: 1px solid var(--border-color);
  border-radius: var(--radius-md); box-shadow: var(--card-shadow);
  padding: 18px; transition: box-shadow 0.2s;
}
.feature-card:hover { box-shadow: var(--card-shadow-hover); }

.feature-head { display: flex; gap: 12px; margin-bottom: 14px; }
.feature-icon {
  display: grid; width: 40px; height: 40px; flex-shrink: 0;
  place-items: center; border-radius: 10px;
}
.feature-head strong { display: block; font-size: 15px; font-weight: 650; color: var(--text-primary); margin-bottom: 2px; }
.feature-head p { margin: 0; font-size: 12px; color: var(--text-muted); line-height: 1.4; }

.feature-body { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }

/* 结果 */
.card-title { font-weight: 600; color: var(--text-primary); font-size: 15px; }
.result-item { padding: 12px 0; border-bottom: 1px solid var(--border-color); }
.result-item:last-child { border-bottom: 0; }
.result-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.result-head strong { font-size: 14px; color: var(--text-primary); }
.result-host { font-size: 12px; color: var(--text-muted); font-family: 'JetBrains Mono', monospace; }
.result-output {
  margin: 0; padding: 10px 12px; max-height: 300px; overflow: auto;
  background: #0b1214; color: #d8dddc; border-radius: var(--radius-sm);
  font-size: 12px; line-height: 1.6; font-family: 'JetBrains Mono', ui-monospace, monospace;
  white-space: pre-wrap;
}
.result-error { color: var(--color-danger); font-size: 13px; padding: 4px 0; }

@media (max-width: 900px) { .feature-grid { grid-template-columns: 1fr; } }
</style>
