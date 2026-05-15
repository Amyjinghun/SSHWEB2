<template>
  <div class="page-container">
    <el-card shadow="hover">
      <div class="toolbar">
        <div class="toolbar-left">
          <el-select v-model="categoryFilter" placeholder="分类筛选" clearable>
            <template #prefix><el-icon><Filter /></el-icon></template>
            <el-option v-for="c in categories" :key="c" :label="c" :value="c" />
          </el-select>
        </div>
        <el-button type="primary" @click="showDialog(null)"><el-icon><Plus /></el-icon>新增模板</el-button>
      </div>
      <el-table :data="filteredTemplates" stripe>
        <el-table-column prop="name" label="名称" width="160" />
        <el-table-column prop="category" label="分类" width="120">
          <template #default="{ row }"><el-tag size="small" effect="plain">{{ row.category }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="command" label="命令" show-overflow-tooltip>
          <template #default="{ row }"><code class="cmd-code">{{ row.command }}</code></template>
        </el-table-column>
        <el-table-column prop="description" label="说明" width="200" show-overflow-tooltip />
        <el-table-column prop="is_dangerous" label="危险" width="60">
          <template #default="{ row }"><el-tag v-if="row.is_dangerous" type="danger" size="small" effect="dark">是</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="150">
          <template #default="{ row }">
            <el-button size="small" @click="showDialog(row)">编辑</el-button>
            <el-button size="small" type="danger" @click="del(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
    <el-dialog v-model="dialogVisible" :title="editing ? '编辑模板' : '新增模板'" width="500px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="分类"><el-input v-model="form.category" /></el-form-item>
        <el-form-item label="命令"><el-input v-model="form.command" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="说明"><el-input v-model="form.description" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogVisible=false">取消</el-button><el-button type="primary" @click="save">确定</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '../../api'
import { ElMessage, ElMessageBox } from 'element-plus'
const templates = ref([])
const categoryFilter = ref('')
const dialogVisible = ref(false)
const editing = ref(null)
const form = ref({ name: '', category: '', command: '', description: '' })

const categories = computed(() => [...new Set(templates.value.map(t => t.category).filter(Boolean))])
const filteredTemplates = computed(() => categoryFilter.value ? templates.value.filter(t => t.category === categoryFilter.value) : templates.value)

onMounted(() => loadData())
async function loadData() { const r = await api.get('/api/commands/templates'); if (r.code === 0) templates.value = r.data }
function showDialog(row) { editing.value = row; form.value = row ? { name: row.name, category: row.category, command: row.command, description: row.description } : { name: '', category: '', command: '', description: '' }; dialogVisible.value = true }
async function save() {
  const res = editing.value ? await api.put(`/api/commands/templates/${editing.value.id}`, form.value) : await api.post('/api/commands/templates', form.value)
  if (res.code === 0) { ElMessage.success('保存成功'); dialogVisible.value = false; loadData() }
}
async function del(row) { await ElMessageBox.confirm('确定删除？', '确认'); const r = await api.delete(`/api/commands/templates/${row.id}`); if (r.code === 0) { ElMessage.success('已删除'); loadData() } }
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.toolbar-left { display: flex; gap: 12px; }
.cmd-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12.5px;
  background: #f4f6fb;
  padding: 2px 6px;
  border-radius: 4px;
  color: #4f6ef7;
}
</style>
