<template>
  <div class="page-container">
    <el-row :gutter="16">
      <el-col :span="10">
        <el-card shadow="hover">
          <template #header><span style="font-weight:600">选择目标服务器</span></template>
          <div style="margin-bottom:12px">
            <el-select v-model="groupId" placeholder="按分组选择" clearable @change="selectByGroup" style="width:100%">
              <el-option v-for="g in groups" :key="g.id" :label="g.name" :value="g.id" />
            </el-select>
          </div>
          <el-checkbox-group v-model="selectedServers">
            <div v-for="s in servers" :key="s.id" style="margin-bottom:4px">
              <el-checkbox :value="s.id">{{ s.name }} ({{ s.host }})</el-checkbox>
            </div>
          </el-checkbox-group>
          <div style="margin-top:12px;color:#909399">已选 {{ selectedServers.length }} 台服务器</div>
        </el-card>
      </el-col>
      <el-col :span="14">
        <el-card shadow="hover">
          <template #header><span style="font-weight:600">执行命令</span></template>
          <el-input v-model="command" type="textarea" :rows="4" placeholder="输入要执行的命令" />
          <div style="margin-top:12px;display:flex;gap:12px">
            <el-button type="primary" @click="execute" :loading="executing" :disabled="!selectedServers.length || !command">批量执行</el-button>
            <el-select v-model="templateId" placeholder="使用模板" clearable style="width:200px" @change="useTemplate">
              <el-option v-for="t in templates" :key="t.id" :label="t.name" :value="t.id" />
            </el-select>
          </div>
        </el-card>
        <el-card shadow="hover" style="margin-top:16px" v-if="results.length">
          <template #header><span style="font-weight:600">执行结果</span></template>
          <el-collapse>
            <el-collapse-item v-for="r in results" :key="r.server_id" :name="r.server_id">
              <template #title>
                <span>{{ r.server_name }}</span>
                <el-tag :type="r.status==='success'?'success':'danger'" size="small" style="margin-left:12px">{{ r.status }}</el-tag>
              </template>
              <pre class="output-box">{{ r.stdout || r.error_message || r.stderr }}</pre>
            </el-collapse-item>
          </el-collapse>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../../api'
import { ElMessage } from 'element-plus'

const servers = ref([])
const groups = ref([])
const templates = ref([])
const selectedServers = ref([])
const groupId = ref('')
const command = ref('')
const templateId = ref('')
const executing = ref(false)
const results = ref([])

onMounted(async () => {
  const [sRes, gRes, tRes] = await Promise.all([api.get('/api/servers'), api.get('/api/server-groups'), api.get('/api/commands/templates')])
  if (sRes.code === 0) servers.value = sRes.data
  if (gRes.code === 0) groups.value = gRes.data
  if (tRes.code === 0) templates.value = tRes.data
})

function selectByGroup(gid) {
  if (!gid) return selectedServers.value = []
  selectedServers.value = servers.value.filter(s => s.group_id === gid).map(s => s.id)
}

function useTemplate(tid) {
  const t = templates.value.find(t => t.id === tid)
  if (t) command.value = t.command
}

async function execute() {
  if (!selectedServers.value.length || !command.value) return
  executing.value = true
  results.value = []
  const res = await api.post('/api/commands/batch-exec', { command: command.value, server_ids: selectedServers.value })
  if (res.code === 0) {
    ElMessage.success('批量任务已创建')
    pollResults(res.data.taskId)
  } else ElMessage.error(res.message)
}

async function pollResults(taskId) {
  const poll = async () => {
    const res = await api.get(`/api/commands/batch-tasks/${taskId}`)
    if (res.code === 0) {
      results.value = res.data.logs || []
      if (['running', 'pending'].includes(res.data.status)) {
        setTimeout(poll, 2000)
      } else {
        executing.value = false
      }
    }
  }
  poll()
}
</script>

<style scoped>
.output-box { background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 6px; max-height: 300px; overflow: auto; font-size: 13px; white-space: pre-wrap; }
</style>
