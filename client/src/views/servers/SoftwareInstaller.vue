<template>
  <div class="page-container">
    <el-row :gutter="16">
      <el-col :span="9">
        <el-card shadow="hover">
          <template #header><span class="card-title">选择目标服务器</span></template>
          <div class="server-tools">
            <el-select v-model="groupId" placeholder="按分组选择" clearable @change="selectByGroup" style="width:100%">
              <el-option v-for="g in groups" :key="g.id" :label="g.name" :value="g.id" />
            </el-select>
            <el-button @click="selectAll">全选</el-button>
            <el-button @click="selectedServers = []">清空</el-button>
          </div>
          <el-checkbox-group v-model="selectedServers">
            <div v-for="s in servers" :key="s.id" class="server-check-item">
              <el-checkbox :value="s.id">
                <span class="server-name">{{ s.name }}</span>
                <span class="server-host">{{ s.host }}</span>
              </el-checkbox>
            </div>
          </el-checkbox-group>
          <div class="select-count">已选 <strong>{{ selectedServers.length }}</strong> 台服务器</div>
        </el-card>
      </el-col>

      <el-col :span="15">
        <el-card shadow="hover">
          <template #header>
            <div class="card-header">
              <span class="card-title">软件安装</span>
              <el-button type="primary" plain @click="openSoftwareDialog">添加软件</el-button>
            </div>
          </template>

          <el-form label-width="120px">
            <el-form-item label="软件">
              <el-select v-model="form.softwareId" placeholder="选择软件" filterable style="width:100%">
                <el-option v-for="item in softwareList" :key="item.id" :label="item.name" :value="item.id" />
              </el-select>
            </el-form-item>

            <template v-if="selectedSoftware?.type === 'haproxy'">
              <el-form-item label="系统">
                <el-select v-model="form.release" placeholder="选择系统" filterable style="width:100%">
                  <el-option v-for="item in haproxySystems" :key="item.release" :label="item.label" :value="item.release" />
                </el-select>
              </el-form-item>
              <el-form-item label="版本">
                <el-select v-model="form.version" placeholder="选择版本" filterable style="width:100%">
                  <el-option v-for="item in versionOptions" :key="item.value" :label="item.label" :value="item.value" />
                </el-select>
              </el-form-item>
            </template>

            <template v-else>
              <el-form-item label="版本">
                <el-select v-model="form.version" placeholder="选择版本" filterable allow-create default-first-option style="width:100%">
                  <el-option v-for="version in selectedSoftwareVersions" :key="version" :label="version" :value="version" />
                </el-select>
              </el-form-item>
              <el-form-item label="管理">
                <el-button v-if="selectedSoftware?.custom" type="danger" plain @click="deleteSelectedSoftware">删除当前软件</el-button>
              </el-form-item>
            </template>

            <el-form-item label="安装命令">
              <el-input :model-value="installCommand" type="textarea" :rows="9" readonly />
            </el-form-item>
          </el-form>

          <el-alert
            type="info"
            show-icon
            :closable="false"
            title="自定义软件命令支持 {{version}} 占位符；执行时会通过批量命令任务下发到所选服务器。"
          />

          <div class="exec-actions">
            <el-button type="primary" :loading="executing" :disabled="!selectedServers.length || !installCommand" @click="execute">
              开始安装
            </el-button>
          </div>
        </el-card>

        <el-card shadow="hover" class="result-card" v-if="results.length">
          <template #header><span class="card-title">执行结果</span></template>
          <el-collapse>
            <el-collapse-item v-for="r in results" :key="r.server_id" :name="r.server_id">
              <template #title>
                <span>{{ r.server_name || r.server_host || r.server_id }}</span>
                <el-tag :type="r.status === 'success' ? 'success' : 'danger'" size="small" effect="plain" class="status-tag">{{ r.status }}</el-tag>
              </template>
              <pre class="output-box">{{ r.stdout || r.error_message || r.stderr }}</pre>
            </el-collapse-item>
          </el-collapse>
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="showSoftwareDialog" title="添加软件" width="640px">
      <el-form :model="softwareForm" label-width="110px">
        <el-form-item label="软件名称">
          <el-input v-model="softwareForm.name" placeholder="例如：Nginx" />
        </el-form-item>
        <el-form-item label="版本列表">
          <el-input v-model="softwareForm.versions" placeholder="例如：1.24,1.26 或 stable,mainline" />
        </el-form-item>
        <el-form-item label="安装命令">
          <el-input
            v-model="softwareForm.command"
            type="textarea"
            :rows="7"
            placeholder="例如：set -e && apt-get update && apt-get install -y nginx={{version}}*"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showSoftwareDialog = false">取消</el-button>
        <el-button type="primary" @click="saveSoftware">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import api from '../../api'
import { ElMessage, ElMessageBox } from 'element-plus'

const customStorageKey = 'sshweb_software_installers'
const servers = ref([])
const groups = ref([])
const selectedServers = ref([])
const groupId = ref('')
const executing = ref(false)
const results = ref([])
const customSoftware = ref([])
const showSoftwareDialog = ref(false)
const softwareForm = ref({ name: '', versions: '', command: '' })
const form = ref({ softwareId: 'haproxy', release: 'bookworm', version: '3.2' })

const haproxySystems = [
  { family: 'debian', release: 'jessie', label: 'Debian Jessie 8', versions: ['1.5', '1.6', '1.7', '1.8'] },
  { family: 'debian', release: 'stretch', label: 'Debian Stretch 9', versions: ['1.6', '1.7', '1.8', '1.9', '2.0', '2.1', '2.2'] },
  { family: 'debian', release: 'buster', label: 'Debian Buster 10', versions: ['1.8', '2.0', '2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7'] },
  { family: 'debian', release: 'bullseye', label: 'Debian Bullseye 11', versions: ['2.4', '2.5', '2.6', '2.7', '2.8', '3.0', '3.1'] },
  { family: 'debian', release: 'bookworm', label: 'Debian Bookworm 12', versions: ['2.6', '2.8', '2.9', '3.0', '3.1', '3.2'] },
  { family: 'debian', release: 'trixie', label: 'Debian Trixie 13', versions: ['3.2', '3.3', '3.4'] },
  { family: 'ubuntu', release: 'xenial', label: 'Ubuntu Xenial 16.04 LTS', versions: ['1.8', '2.0'] },
  { family: 'ubuntu', release: 'bionic', label: 'Ubuntu Bionic 18.04 LTS', versions: ['1.8', '1.9', '2.0', '2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7'] },
  { family: 'ubuntu', release: 'focal', label: 'Ubuntu Focal 20.04 LTS', versions: ['2.0', '2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7', '2.8', '2.9', '3.0'] },
  { family: 'ubuntu', release: 'jammy', label: 'Ubuntu Jammy 22.04 LTS', versions: ['2.4', '2.5', '2.6', '2.7', '2.8', '2.9', '3.0'] },
  { family: 'ubuntu', release: 'noble', label: 'Ubuntu Noble 24.04 LTS', versions: ['2.8', '2.9', '3.0', '3.1', '3.2', '3.3'] }
]

const builtInSoftware = [
  { id: 'haproxy', name: 'HAProxy', type: 'haproxy', versions: [] },
  { id: 'xanmod', name: 'XanMod 内核', type: 'xanmod', versions: ['auto', 'lts', 'main', 'rt'] },
  { id: 'docker', name: 'Docker 容器', type: 'docker', versions: ['stable', 'test'] }
]

const softwareList = computed(() => [...builtInSoftware, ...customSoftware.value])
const selectedSoftware = computed(() => softwareList.value.find(item => item.id === form.value.softwareId))
const selectedSystem = computed(() => haproxySystems.find(item => item.release === form.value.release))
const versionOptions = computed(() => (selectedSystem.value?.versions || []).map(version => ({ value: version, label: `HAProxy ${version}` })))
const selectedSoftwareVersions = computed(() => selectedSoftware.value?.versions || [])
const installCommand = computed(() => {
  const software = selectedSoftware.value
  const version = form.value.version
  if (!software) return ''
  if (software.type === 'haproxy') return buildHaproxyCommand()
  if (software.type === 'xanmod') return buildXanmodCommand()
  if (software.type === 'docker') return buildDockerCommand()
  return String(software.command || '').replaceAll('{{version}}', version || '')
})

onMounted(async () => {
  loadCustomSoftware()
  await loadData()
})

watch(selectedSystem, system => {
  if (selectedSoftware.value?.type === 'haproxy' && system && !system.versions.includes(form.value.version)) {
    form.value.version = system.versions[system.versions.length - 1]
  }
})

watch(selectedSoftware, software => {
  if (!software) return
  if (software.type === 'haproxy') {
    form.value.release = form.value.release || 'bookworm'
    if (!versionOptions.value.some(item => item.value === form.value.version)) form.value.version = '3.2'
  } else if (software.type === 'xanmod') {
    form.value.version = 'auto'
  } else if (software.type === 'docker') {
    form.value.version = 'stable'
  } else {
    form.value.version = software.versions?.[0] || ''
  }
})

function buildHaproxyCommand() {
  const system = selectedSystem.value
  const version = form.value.version
  if (!system || !version) return ''
  const commands = ['set -e', 'if [ "$(id -u)" -eq 0 ]; then SUDO=; else SUDO=sudo; fi']
  if (system.family === 'debian') {
    commands.push('$SUDO apt-get install -y curl ca-certificates')
    commands.push('$SUDO install -d -m 0755 /etc/apt/keyrings')
    commands.push('$SUDO curl -fsSL https://haproxy.debian.net/haproxy-archive-keyring.gpg -o /etc/apt/keyrings/haproxy-archive-keyring.gpg')
    commands.push(`printf '%s\\n' 'deb [signed-by=/etc/apt/keyrings/haproxy-archive-keyring.gpg] https://haproxy.debian.net ${system.release}-backports-${version} main' | $SUDO tee /etc/apt/sources.list.d/haproxy.list >/dev/null`)
  } else {
    commands.push('$SUDO apt-get install -y --no-install-recommends software-properties-common')
    commands.push(`$SUDO add-apt-repository -y ppa:vbernat/haproxy-${version}`)
  }
  commands.push('$SUDO apt-get update')
  commands.push(`$SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y 'haproxy=${version}.*'`)
  commands.push('haproxy -v')
  return commands.join(' && ')
}

function buildXanmodCommand() {
  const branch = form.value.version || 'auto'
  return [
    'set -e',
    `XANMOD_BRANCH=${JSON.stringify(branch)}`,
    'if [ "$(id -u)" -eq 0 ]; then SUDO=; else SUDO=sudo; fi',
    '. /etc/os-release',
    '[ "${ID:-}" = "debian" ] || { echo "XanMod installer only supports Debian."; exit 1; }',
    '[ "$(uname -m)" = "x86_64" ] || { echo "XanMod requires x86_64."; exit 1; }',
    '[ "$(dpkg --print-architecture)" = "amd64" ] || { echo "XanMod requires Debian amd64."; exit 1; }',
    'case "${VERSION_ID:-}:${VERSION_CODENAME:-}" in 13:trixie|12:bookworm) XANMOD_SUITE="${VERSION_CODENAME}" ;; *) echo "This installer supports Debian 12 bookworm and Debian 13 trixie."; exit 1 ;; esac',
    '$SUDO apt-get update',
    '$SUDO apt-get install -y ca-certificates curl gpg wget',
    'TMP_DIR="$(mktemp -d)"',
    'trap \'rm -rf "$TMP_DIR"\' EXIT',
    'curl -fsSL https://dl.xanmod.org/archive.key -o "$TMP_DIR/xanmod.key" || curl -fsSL https://gitlab.com/afrd.gpg -o "$TMP_DIR/xanmod.key"',
    'gpg --dearmor --yes --output "$TMP_DIR/xanmod-archive-keyring.gpg" "$TMP_DIR/xanmod.key"',
    '$SUDO install -d -m 0755 /etc/apt/keyrings',
    '$SUDO install -m 0644 "$TMP_DIR/xanmod-archive-keyring.gpg" /etc/apt/keyrings/xanmod-archive-keyring.gpg',
    'printf "%s\\n" "Types: deb" "URIs: https://deb.xanmod.org" "Suites: ${XANMOD_SUITE}" "Components: main" "Architectures: amd64" "Signed-By: /etc/apt/keyrings/xanmod-archive-keyring.gpg" | $SUDO tee /etc/apt/sources.list.d/xanmod-release.sources >/dev/null',
    '$SUDO apt-get update',
    'FLAGS="$(grep -m1 "^flags[[:space:]]*:" /proc/cpuinfo || true)"',
    'LD_HELP=""; for LD_PATH in /lib64/ld-linux-x86-64.so.2 /lib/x86_64-linux-gnu/ld-linux-x86-64.so.2; do [ -x "$LD_PATH" ] && LD_HELP="$("$LD_PATH" --help 2>/dev/null || true)" && break; done',
    'if printf "%s\\n" "$LD_HELP" | grep -Eq "x86-64-v4 .*supported"; then CPU_SUFFIX=x64v3; elif printf "%s\\n" "$LD_HELP" | grep -Eq "x86-64-v3 .*supported"; then CPU_SUFFIX=x64v3; elif printf "%s\\n" "$LD_HELP" | grep -Eq "x86-64-v2 .*supported"; then CPU_SUFFIX=x64v2; elif printf "%s\\n" "$FLAGS" | grep -Eq "(^|[[:space:]])cx16([[:space:]]|$)" && printf "%s\\n" "$FLAGS" | grep -Eq "(^|[[:space:]])sse4_2([[:space:]]|$)"; then CPU_SUFFIX=x64v2; else CPU_SUFFIX=x64v1; fi',
    'BRANCH="$XANMOD_BRANCH"',
    '[ "$BRANCH" = "auto" ] && { if [ "${VERSION_ID:-}" = "13" ] && [ "$CPU_SUFFIX" != "x64v1" ]; then BRANCH=main; else BRANCH=lts; fi; }',
    'case "$BRANCH:$CPU_SUFFIX" in main:x64v1|rt:x64v1) echo "MAIN/RT are not available for x64v1; use lts."; exit 1 ;; main:*) PACKAGE_NAME="linux-xanmod-${CPU_SUFFIX}" ;; lts:x64v1) PACKAGE_NAME="linux-xanmod-lts-x64v1" ;; lts:*) PACKAGE_NAME="linux-xanmod-lts-${CPU_SUFFIX}" ;; rt:*) PACKAGE_NAME="linux-xanmod-rt-${CPU_SUFFIX}" ;; *) echo "Unsupported XanMod branch: $BRANCH"; exit 1 ;; esac',
    'apt-cache policy "$PACKAGE_NAME"',
    'apt-cache policy "$PACKAGE_NAME" | awk \'/Candidate:/ { exit ($2 == "(none)") ? 1 : 0 }\'',
    '$SUDO apt-get install -y "$PACKAGE_NAME"',
    '$SUDO apt-get install -y --no-install-recommends dkms libelf-dev clang lld llvm',
    'echo "Installed $PACKAGE_NAME. Reboot manually when ready: sudo reboot"'
  ].join(' && ')
}

function buildDockerCommand() {
  const channel = form.value.version === 'test' ? 'test' : 'stable'
  return [
    'set -e',
    `DOCKER_CHANNEL=${JSON.stringify(channel)}`,
    'if [ "$(id -u)" -eq 0 ]; then SUDO=; else SUDO=sudo; fi',
    '$SUDO apt-get update',
    '$SUDO apt-get install -y ca-certificates curl',
    'curl -fsSL https://get.docker.com -o /tmp/get-docker.sh',
    'if [ "$DOCKER_CHANNEL" = "test" ]; then $SUDO CHANNEL=test sh /tmp/get-docker.sh; else $SUDO sh /tmp/get-docker.sh; fi',
    '$SUDO systemctl enable --now docker || true',
    'docker --version',
    'docker compose version || true'
  ].join(' && ')
}

async function loadData() {
  const [serverRes, groupRes] = await Promise.all([api.get('/api/servers'), api.get('/api/server-groups')])
  if (serverRes.code === 0) servers.value = serverRes.data
  if (groupRes.code === 0) groups.value = groupRes.data
}

function loadCustomSoftware() {
  try {
    const items = JSON.parse(localStorage.getItem(customStorageKey) || '[]')
    customSoftware.value = Array.isArray(items) ? items : []
  } catch {
    customSoftware.value = []
  }
}

function persistCustomSoftware() {
  localStorage.setItem(customStorageKey, JSON.stringify(customSoftware.value))
}

function selectByGroup(gid) {
  if (!gid) {
    selectedServers.value = []
    return
  }
  selectedServers.value = servers.value.filter(s => s.group_id === gid).map(s => s.id)
}

function selectAll() {
  selectedServers.value = servers.value.map(s => s.id)
}

function openSoftwareDialog() {
  softwareForm.value = { name: '', versions: '', command: '' }
  showSoftwareDialog.value = true
}

function saveSoftware() {
  const name = softwareForm.value.name.trim()
  const command = softwareForm.value.command.trim()
  if (!name || !command) return ElMessage.warning('请填写软件名称和安装命令')
  const versions = softwareForm.value.versions.split(',').map(item => item.trim()).filter(Boolean)
  const item = {
    id: `custom_${Date.now()}`,
    name,
    type: 'custom',
    custom: true,
    versions,
    command
  }
  customSoftware.value.push(item)
  persistCustomSoftware()
  form.value.softwareId = item.id
  form.value.version = versions[0] || ''
  showSoftwareDialog.value = false
  ElMessage.success('软件已添加')
}

async function deleteSelectedSoftware() {
  const software = selectedSoftware.value
  if (!software?.custom) return
  await ElMessageBox.confirm(`确定删除软件 "${software.name}" ?`, '确认删除', { type: 'warning' })
  customSoftware.value = customSoftware.value.filter(item => item.id !== software.id)
  persistCustomSoftware()
  form.value.softwareId = 'haproxy'
  form.value.version = '3.2'
  ElMessage.success('已删除')
}

async function execute() {
  if (!selectedServers.value.length || !installCommand.value) return
  executing.value = true
  results.value = []
  const software = selectedSoftware.value
  const res = await api.post('/api/commands/batch-exec', {
    command: installCommand.value,
    server_ids: selectedServers.value,
    name: `安装 ${software?.name || '软件'} ${form.value.version || ''}`.trim()
  })
  if (res.code === 0) {
    ElMessage.success('软件安装任务已创建')
    pollResults(res.data.taskId)
  } else {
    executing.value = false
    ElMessage.error(res.message || '创建安装任务失败')
  }
}

async function pollResults(taskId) {
  const res = await api.get(`/api/commands/batch-tasks/${taskId}`)
  if (res.code !== 0) {
    executing.value = false
    return
  }
  results.value = res.data.logs || []
  if (['running', 'pending'].includes(res.data.status)) {
    setTimeout(() => pollResults(taskId), 2000)
  } else {
    executing.value = false
  }
}
</script>

<style scoped>
.card-header { display: flex; align-items: center; justify-content: space-between; }
.card-title { font-weight: 600; color: #1e293b; font-size: 15px; }
.server-tools { display: flex; gap: 8px; margin-bottom: 12px; }
.server-check-item {
  padding: 4px 0;
  border-bottom: 1px solid #f4f6fb;
}
.server-check-item:last-child { border-bottom: none; }
.server-name { font-weight: 500; color: #1e293b; }
.server-host { color: #94a3b8; font-size: 13px; margin-left: 8px; }
.select-count { margin-top: 12px; color: #64748b; font-size: 13px; }
.exec-actions { margin-top: 12px; display: flex; justify-content: flex-end; }
.result-card { margin-top: 16px; }
.status-tag { margin-left: 12px; }
</style>
