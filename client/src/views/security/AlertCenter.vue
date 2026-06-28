<template>
  <div class="page-container alert-page">
    <el-row :gutter="16">
      <el-col :xs="24" :lg="8">
        <el-card shadow="hover" class="panel-card">
          <template #header>
            <div class="card-header-row">
              <span class="card-title">告警规则</span>
              <el-button type="primary" size="small" @click="showRuleDialog(null)">
                <el-icon><Plus /></el-icon>新增
              </el-button>
            </div>
          </template>

          <div v-for="rule in rules" :key="rule.id" class="rule-item">
            <div class="rule-main">
              <strong>{{ displayRuleName(rule) }}</strong>
              <el-tag :type="rule.level === 'critical' ? 'danger' : rule.level === 'warning' ? 'warning' : 'info'" size="small" effect="light">
                {{ levelLabel(rule.level) }}
              </el-tag>
            </div>
            <div class="rule-meta">
              <span>{{ typeLabel(rule.type) }}</span>
              <span v-if="ruleThreshold(rule)">阈值 {{ ruleThreshold(rule) }}</span>
            </div>
            <div class="rule-actions">
              <el-switch v-model="rule.enabled" :active-value="1" :inactive-value="0" size="small" @change="toggleRule(rule)" />
              <el-button size="small" text @click="showRuleDialog(rule)">编辑</el-button>
              <el-button size="small" text type="danger" @click="delRule(rule)">删除</el-button>
            </div>
          </div>

          <el-empty v-if="!rules.length" description="暂无规则" :image-size="70" />
        </el-card>
      </el-col>

      <el-col :xs="24" :lg="16">
        <el-card shadow="hover" class="panel-card">
          <template #header><span class="card-title">告警记录</span></template>
          <el-table :data="alerts" stripe>
            <el-table-column prop="server_name" label="服务器" min-width="140" show-overflow-tooltip />
            <el-table-column prop="title" label="告警标题" min-width="220" show-overflow-tooltip />
            <el-table-column prop="level" label="级别" width="90">
              <template #default="{ row }">
                <el-tag :type="row.level === 'critical' ? 'danger' : row.level === 'warning' ? 'warning' : 'info'" size="small" effect="light">
                  {{ levelLabel(row.level) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="row.status === 'active' ? 'danger' : row.status === 'recovered' ? 'success' : 'info'" size="small" effect="light">
                  {{ statusLabel(row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="created_at" label="时间" min-width="170" show-overflow-tooltip />
            <el-table-column label="操作" width="90">
              <template #default="{ row }">
                <el-button v-if="row.status === 'active'" size="small" @click="ignore(row)">忽略</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="ruleDialogVisible" :title="ruleEditing ? '编辑规则' : '新增规则'" width="520px">
      <el-form :model="ruleForm" label-width="84px" class="rule-form">
        <el-form-item label="规则名称">
          <div class="rule-name-preview">{{ generatedRuleName }}</div>
          <div class="form-tip">名称会根据类型、阈值和级别自动生成，不需要手动填写。</div>
        </el-form-item>

        <el-form-item label="类型">
          <el-select v-model="ruleForm.type" class="full-control">
            <el-option v-for="item in typeOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>

        <el-form-item v-if="needsThreshold" :label="thresholdLabel">
          <el-input v-model="ruleForm.conditionValue" :placeholder="thresholdPlaceholder" />
        </el-form-item>

        <el-form-item label="级别">
          <el-select v-model="ruleForm.level" class="full-control">
            <el-option label="信息" value="info" />
            <el-option label="警告" value="warning" />
            <el-option label="严重" value="critical" />
          </el-select>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="ruleDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveRule">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import api from '../../api'
import { ElMessage, ElMessageBox } from 'element-plus'

const rules = ref([])
const alerts = ref([])
const ruleDialogVisible = ref(false)
const ruleEditing = ref(null)
const ruleForm = ref({ name: '', type: 'server_offline', conditionValue: '', level: 'warning' })

const typeOptions = [
  { label: '服务器离线', value: 'server_offline' },
  { label: 'CPU过高', value: 'cpu_high' },
  { label: '内存过高', value: 'memory_high' },
  { label: '磁盘过高', value: 'disk_high' },
  { label: '证书即将过期', value: 'cert_expiring' }
]

const levelLabels = {
  info: '信息',
  warning: '警告',
  critical: '严重'
}

const statusLabels = {
  active: '活跃',
  recovered: '已恢复',
  ignored: '已忽略'
}

const needsThreshold = computed(() => ruleForm.value.type !== 'server_offline')
const thresholdLabel = computed(() => ruleForm.value.type === 'cert_expiring' ? '天数' : '阈值')
const thresholdPlaceholder = computed(() => ruleForm.value.type === 'cert_expiring' ? '如 7 表示7天内到期' : '如 90 表示90%')
const generatedRuleName = computed(() => buildRuleName(ruleForm.value))

onMounted(async () => {
  await Promise.all([loadRules(), loadAlerts()])
})

function typeLabel(type) {
  return typeOptions.find(item => item.value === type)?.label || type || '-'
}

function levelLabel(level) {
  return levelLabels[level] || level || '-'
}

function statusLabel(status) {
  return statusLabels[status] || status || '-'
}

function ruleThreshold(rule) {
  const threshold = rule?.conditionValue ?? rule?.condition_json?.threshold ?? ''
  if (threshold === '' || threshold === null || threshold === undefined) return ''
  return rule.type === 'cert_expiring' ? `${threshold}天` : `${threshold}%`
}

function buildRuleName(rule) {
  const type = typeLabel(rule.type)
  const level = levelLabel(rule.level)
  const threshold = ruleThreshold(rule)
  if (!threshold) return `${type}（${level}）`
  if (rule.type === 'cert_expiring') return `${type}：${threshold}内（${level}）`
  return `${type} ≥ ${threshold}（${level}）`
}

function displayRuleName(rule) {
  return rule.name || buildRuleName(rule)
}

function showRuleDialog(row) {
  ruleEditing.value = row
  ruleForm.value = row
    ? { name: row.name, type: row.type, conditionValue: row.condition_json?.threshold || '', level: row.level }
    : { name: '', type: 'server_offline', conditionValue: '', level: 'warning' }
  ruleDialogVisible.value = true
}

async function saveRule() {
  const payload = {
    ...ruleForm.value,
    name: generatedRuleName.value,
    condition: { threshold: ruleForm.value.conditionValue }
  }
  const res = ruleEditing.value
    ? await api.put(`/api/alerts/rules/${ruleEditing.value.id}`, payload)
    : await api.post('/api/alerts/rules', payload)
  if (res.code === 0) {
    ElMessage.success('保存成功')
    ruleDialogVisible.value = false
    loadRules()
  } else {
    ElMessage.error(res.message || '保存失败')
  }
}

async function toggleRule(rule) {
  await api.put(`/api/alerts/rules/${rule.id}`, { enabled: rule.enabled })
}

async function delRule(row) {
  await ElMessageBox.confirm('确定删除这条告警规则？', '确认删除', { type: 'warning' })
  const r = await api.delete(`/api/alerts/rules/${row.id}`)
  if (r.code === 0) {
    ElMessage.success('已删除')
    loadRules()
  }
}

async function ignore(row) {
  const r = await api.post(`/api/alerts/logs/${row.id}/ignore`)
  if (r.code === 0) {
    ElMessage.success('已忽略')
    loadAlerts()
  }
}

async function loadRules() {
  const r = await api.get('/api/alerts/rules')
  if (r.code === 0) rules.value = r.data
}

async function loadAlerts() {
  const r = await api.get('/api/alerts/logs')
  if (r.code === 0) alerts.value = r.data
}
</script>

<style scoped>
.alert-page {
  min-height: calc(100vh - 56px);
}

.panel-card {
  border-radius: 10px;
  border: 1px solid #e5eaf3;
  overflow: hidden;
}

.card-title {
  font-weight: 700;
  color: #111827;
  font-size: 15px;
}

.card-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.rule-item {
  padding: 14px 0;
  border-bottom: 1px solid #edf2f7;
}

.rule-item:last-child {
  border-bottom: none;
}

.rule-main {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}

.rule-main strong {
  color: #111827;
  font-size: 14px;
  line-height: 1.5;
}

.rule-meta {
  display: flex;
  gap: 10px;
  margin-top: 6px;
  color: #64748b;
  font-size: 12px;
}

.rule-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.rule-form {
  padding-top: 6px;
}

.full-control {
  width: 100%;
}

.rule-name-preview {
  width: 100%;
  min-height: 34px;
  padding: 7px 12px;
  box-sizing: border-box;
  border: 1px solid #d9e4f2;
  border-radius: 6px;
  background: #f8fafc;
  color: #111827;
  font-weight: 600;
  line-height: 1.5;
}

.form-tip {
  margin-top: 6px;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.5;
}
</style>
