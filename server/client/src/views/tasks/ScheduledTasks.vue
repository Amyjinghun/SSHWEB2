<template>
  <div class="page-container">
    <el-card shadow="hover">
      <div class="toolbar">
        <div>
          <span class="page-title">计划任务</span>
          <div class="tips">支持自定义 Cron 时间，并可对单台、多台或整个分组服务器执行命令。</div>
        </div>
        <el-button type="primary" @click="showDialog(null)"><el-icon><Plus /></el-icon>新增任务</el-button>
      </div>
      <el-table :data="tasks" stripe>
        <el-table-column prop="name" label="任务名称" width="180" />
        <el-table-column label="执行目标" width="220">
          <template #default="{ row }">{{ targetText(row) }}</template>
        </el-table-column>
        <el-table-column prop="cron_expr" label="Cron表达式" width="140">
          <template #default="{ row }"><code class="cron-code">{{ row.cron_expr }}</code></template>
        </el-table-column>
        <el-table-column prop="command" label="命令" show-overflow-tooltip>
          <template #default="{ row }"><code class="cmd-code">{{ row.command }}</code></template>
        </el-table-column>
        <el-table-column prop="enabled" label="状态" width="80">
          <template #default="{ row }"><el-switch v-model="row.enabled" :active-value="1" :inactive-value="0" @change="toggle(row)" /></template>
        </el-table-column>
        <el-table-column prop="last_run_at" label="上次执行" width="170" />
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button size="small" @click="runTask(row)">执行</el-button>
            <el-button size="small" @click="showDialog(row)">编辑</el-button>
            <el-button size="small" type="danger" @click="del(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑任务' : '新增任务'" width="620px">
      <el-form :model="form" label-width="110px">
        <el-form-item label="任务名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="目标类型">
          <el-radio-group v-model="form.target_type" @change="onTargetTypeChange">
            <el-radio-button label="server">单台服务器</el-radio-button>
            <el-radio-button label="server_list">勾选服务器</el-radio-button>
            <el-radio-button label="group">服务器分组</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.target_type === 'server'" label="目标服务器">
          <el-select v-model="form.server_id" placeholder="选择服务器" filterable style="width:100%">
            <el-option v-for="s in servers" :key="s.id" :label="serverLabel(s)" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="form.target_type === 'server_list'" label="勾选服务器">
          <el-select v-model="form.server_ids" placeholder="选择一台或多台服务器" filterable multiple collapse-tags collapse-tags-tooltip style="width:100%">
            <el-option v-for="s in servers" :key="s.id" :label="serverLabel(s)" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="form.target_type === 'group'" label="服务器分组">
          <el-select v-model="form.group_id" placeholder="选择分组" filterable style="width:100%">
            <el-option v-for="g in groups" :key="g.id" :label="`${g.name}（${g.server_count || 0} 台）`" :value="g.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="Cron表达式"><el-input v-model="form.cron_expr" placeholder="例如: */5 * * * *" /></el-form-item>
        <el-form-item label="执行命令"><el-input v-model="form.command" type="textarea" :rows="4" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogVisible=false">取消</el-button><el-button type="primary" @click="save">确定</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../../api'
import { ElMessage, ElMessageBox } from 'element-plus'

const tasks = ref([])
const servers = ref([])
const groups = ref([])
const dialogVisible = ref(false)
const editing = ref(null)

const emptyForm = () => ({ name: '', target_type: 'server', server_id: null, server_ids: [], group_id: null, cron_expr: '', command: '', remark: '' })
const form = ref(emptyForm())

onMounted(loadAll)

async function loadAll() {
  const [tRes, sRes, gRes] = await Promise.all([
    api.get('/api/scheduled-tasks'),
    api.get('/api/servers'),
    api.get('/api/server-groups')
  ])
  if (tRes.code === 0) tasks.value = tRes.data
  if (sRes.code === 0) servers.value = sRes.data
  if (gRes.code === 0) groups.value = gRes.data
}

function serverLabel(s) { return `${s.name} (${s.host})` }

function parseIds(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.map(Number)
  try {
    const arr = JSON.parse(value)
    return Array.isArray(arr) ? arr.map(Number) : []
  } catch {
    return String(value).split(',').map(v => Number(v)).filter(Boolean)
  }
}

function targetText(row) {
  const type = row.target_type || (row.server_id ? 'server' : 'server_list')
  if (type === 'group') return row.group_name ? `分组：${row.group_name}` : '分组：-'
  if (type === 'server_list') {
    const count = row.target_count || parseIds(row.server_ids).length
    return `勾选服务器：${count} 台`
  }
  return row.server_name || '-'
}

function normalizeRowToForm(row) {
  const targetType = row.target_type || (row.server_id ? 'server' : 'server_list')
  return {
    name: row.name,
    target_type: targetType,
    server_id: row.server_id || null,
    server_ids: parseIds(row.server_ids),
    group_id: row.group_id || null,
    cron_expr: row.cron_expr,
    command: row.command,
    remark: row.remark || ''
  }
}

function onTargetTypeChange() {
  form.value.server_id = null
  form.value.server_ids = []
  form.value.group_id = null
}

function showDialog(row) {
  editing.value = row
  form.value = row ? normalizeRowToForm(row) : emptyForm()
  dialogVisible.value = true
}

function validateTaskForm() {
  if (!form.value.name || !form.value.command || !form.value.cron_expr) return '任务名称、Cron表达式和执行命令为必填项'
  if (form.value.target_type === 'server' && !form.value.server_id) return '请选择目标服务器'
  if (form.value.target_type === 'server_list' && !form.value.server_ids.length) return '请至少勾选一台服务器'
  if (form.value.target_type === 'group' && !form.value.group_id) return '请选择服务器分组'
  return ''
}

async function save() {
  const msg = validateTaskForm()
  if (msg) return ElMessage.warning(msg)
  const payload = { ...form.value }
  const res = editing.value ? await api.put(`/api/scheduled-tasks/${editing.value.id}`, payload) : await api.post('/api/scheduled-tasks', payload)
  if (res.code === 0) { ElMessage.success('保存成功'); dialogVisible.value = false; loadData() }
}

async function loadData() { const r = await api.get('/api/scheduled-tasks'); if (r.code === 0) tasks.value = r.data }
async function toggle(row) { await api.post(`/api/scheduled-tasks/${row.id}/${row.enabled ? 'enable' : 'disable'}`) }
async function runTask(row) {
  const r = await api.post(`/api/scheduled-tasks/${row.id}/run`)
  if (r.code !== 0) return ElMessage.error(r.message)
  const data = r.data || {}
  ElMessage.success(`执行完成：成功 ${data.success ?? 0}，失败 ${data.failed ?? 0}`)
  loadData()
}
async function del(row) { await ElMessageBox.confirm('确定删除？', '确认'); const r = await api.delete(`/api/scheduled-tasks/${row.id}`); if (r.code === 0) { ElMessage.success('已删除'); loadData() } }

</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-title { font-weight: 600; font-size: 16px; color: #1e293b; }
.tips { color: #94a3b8; font-size: 12px; margin-top: 4px; }
.cron-code, .cmd-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12.5px;
  background: #f4f6fb;
  padding: 2px 6px;
  border-radius: 4px;
  color: #4f6ef7;
}
</style>
