<template>
  <div class="page-container">
    <el-row :gutter="16">
      <el-col :span="8">
        <el-card shadow="hover">
          <template #header>
            <div class="card-header-row">
              <span class="card-title">告警规则</span>
              <el-button type="primary" size="small" @click="showRuleDialog(null)"><el-icon><Plus /></el-icon>新增</el-button>
            </div>
          </template>
          <div v-for="rule in rules" :key="rule.id" class="rule-item">
            <div class="rule-info">
              <strong>{{ rule.name }}</strong>
              <el-tag :type="rule.level==='critical'?'danger':rule.level==='warning'?'warning':'info'" size="small" effect="plain">{{ rule.level }}</el-tag>
            </div>
            <div class="rule-actions">
              <el-switch v-model="rule.enabled" :active-value="1" :inactive-value="0" size="small" @change="toggleRule(rule)" />
              <el-button size="small" text @click="showRuleDialog(rule)">编辑</el-button>
              <el-button size="small" text type="danger" @click="delRule(rule)">删除</el-button>
            </div>
          </div>
          <el-empty v-if="!rules.length" description="暂无规则" :image-size="60" />
        </el-card>
      </el-col>
      <el-col :span="16">
        <el-card shadow="hover">
          <template #header><span class="card-title">告警记录</span></template>
          <el-table :data="alerts" stripe>
            <el-table-column prop="server_name" label="服务器" width="140" />
            <el-table-column prop="title" label="告警标题" show-overflow-tooltip />
            <el-table-column prop="level" label="级别" width="80">
              <template #default="{ row }"><el-tag :type="row.level==='critical'?'danger':row.level==='warning'?'warning':'info'" size="small" effect="plain">{{ row.level }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="80">
              <template #default="{ row }"><el-tag :type="row.status==='active'?'danger':row.status==='recovered'?'success':'info'" size="small" effect="plain">{{ row.status }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="created_at" label="时间" width="170" />
            <el-table-column label="操作" width="80">
              <template #default="{ row }"><el-button v-if="row.status==='active'" size="small" @click="ignore(row)">忽略</el-button></template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="ruleDialogVisible" :title="ruleEditing ? '编辑规则' : '新增规则'" width="500px">
      <el-form :model="ruleForm" label-width="80px">
        <el-form-item label="名称"><el-input v-model="ruleForm.name" /></el-form-item>
        <el-form-item label="类型">
          <el-select v-model="ruleForm.type"><el-option label="服务器离线" value="server_offline" /><el-option label="CPU过高" value="cpu_high" /><el-option label="内存过高" value="memory_high" /><el-option label="磁盘过高" value="disk_high" /><el-option label="证书过期" value="cert_expiring" /></el-select>
        </el-form-item>
        <el-form-item label="阈值"><el-input v-model="ruleForm.conditionValue" placeholder="如 90 表示90%" /></el-form-item>
        <el-form-item label="级别"><el-select v-model="ruleForm.level"><el-option label="信息" value="info" /><el-option label="警告" value="warning" /><el-option label="严重" value="critical" /></el-select></el-form-item>
      </el-form>
      <template #footer><el-button @click="ruleDialogVisible=false">取消</el-button><el-button type="primary" @click="saveRule">确定</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../../api'
import { ElMessage, ElMessageBox } from 'element-plus'
const rules = ref([]); const alerts = ref([]); const ruleDialogVisible = ref(false); const ruleEditing = ref(null)
const ruleForm = ref({ name: '', type: 'server_offline', conditionValue: '', level: 'warning' })

onMounted(async () => {
  const [rRes, aRes] = await Promise.all([api.get('/api/alerts/rules'), api.get('/api/alerts/logs')])
  if (rRes.code === 0) rules.value = rRes.data; if (aRes.code === 0) alerts.value = aRes.data
})

function showRuleDialog(row) {
  ruleEditing.value = row; ruleForm.value = row ? { name: row.name, type: row.type, conditionValue: row.condition_json?.threshold || '', level: row.level } : { name: '', type: 'server_offline', conditionValue: '', level: 'warning' }; ruleDialogVisible.value = true
}

async function saveRule() {
  const payload = { ...ruleForm.value, condition: { threshold: ruleForm.value.conditionValue } }
  const res = ruleEditing.value ? await api.put(`/api/alerts/rules/${ruleEditing.value.id}`, payload) : await api.post('/api/alerts/rules', payload)
  if (res.code === 0) { ElMessage.success('保存成功'); ruleDialogVisible.value = false; loadRules() }
}

async function toggleRule(rule) { await api.put(`/api/alerts/rules/${rule.id}`, { enabled: rule.enabled }) }
async function delRule(row) { await ElMessageBox.confirm('确定删除？', '确认'); const r = await api.delete(`/api/alerts/rules/${row.id}`); if (r.code === 0) { ElMessage.success('已删除'); loadRules() } }
async function ignore(row) { const r = await api.post(`/api/alerts/logs/${row.id}/ignore`); if (r.code === 0) { ElMessage.success('已忽略'); loadAlerts() } }
async function loadRules() { const r = await api.get('/api/alerts/rules'); if (r.code === 0) rules.value = r.data }
async function loadAlerts() { const r = await api.get('/api/alerts/logs'); if (r.code === 0) alerts.value = r.data }
</script>

<style scoped>
.card-title { font-weight: 600; color: #1e293b; font-size: 15px; }
.card-header-row { display: flex; justify-content: space-between; align-items: center; }
.rule-item { padding: 10px 0; border-bottom: 1px solid #f4f6fb; &:last-child { border-bottom: none; } }
.rule-info { display: flex; justify-content: space-between; align-items: center; }
.rule-actions { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
</style>
