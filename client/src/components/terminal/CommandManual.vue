<template>
  <div class="manual" :class="mode">
    <!-- 列表视图 -->
    <div class="manual-list" v-show="mode === 'page' || !current">
      <div class="manual-search">
        <el-input v-model="keyword" placeholder="搜索命令或用途，如 ssh、压缩…" clearable :prefix-icon="Search" size="small" />
        <span class="manual-count text-muted">{{ filtered.length }} 条</span>
      </div>
      <div class="manual-items">
        <div v-for="item in paged" :key="item.name" class="manual-item" @click="open(item.name)">
          <strong>{{ item.name }}</strong>
          <small>{{ item.desc }}</small>
        </div>
        <div v-if="!filtered.length" class="manual-empty">没有匹配的命令</div>
        <el-button v-if="filtered.length > paged.length" text size="small" class="manual-more" @click="limit += 120">加载更多（还有 {{ filtered.length - paged.length }} 条）</el-button>
      </div>
    </div>

    <!-- 详情视图（面板模式单列复用） -->
    <div class="manual-detail" v-if="mode === 'page' ? !!current : true" v-show="mode === 'page' ? true : !!current">
      <div class="manual-detail-head" v-if="current">
        <el-button v-if="mode === 'panel'" text size="small" :icon="ArrowLeft" @click="current = ''">返回</el-button>
        <strong class="manual-title">{{ current }}</strong>
        <div class="manual-actions">
          <el-button size="small" :icon="DocumentCopy" @click="copyName">复制</el-button>
          <el-button v-if="canInsert" type="primary" size="small" :icon="Position" @click="insert">插入终端</el-button>
        </div>
      </div>
      <div class="manual-content" v-html="rendered"></div>
      <div v-if="loading" class="manual-empty">加载中…</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { Search, ArrowLeft, DocumentCopy, Position } from '@element-plus/icons-vue'
import { marked } from 'marked'
import { ElMessage } from 'element-plus'
import api from '../../api'

const props = defineProps({
  // panel = 终端右侧窄栏（列表/详情单列切换）；page = 独立页两栏
  mode: { type: String, default: 'panel' },
  canInsert: { type: Boolean, default: false }
})
const emit = defineEmits(['insert'])

const keyword = ref('')
const list = ref([])
const current = ref('')
const content = ref('')
const loading = ref(false)
const limit = ref(120)

const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return list.value
  return list.value.filter(i => i.name.toLowerCase().includes(q) || (i.desc || '').toLowerCase().includes(q))
})
const paged = computed(() => filtered.value.slice(0, limit.value))

// md 里的示例可能含 HTML，先整体转义再渲染，保证只输出纯文本/代码样式
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
const rendered = computed(() => {
  if (!content.value) return ''
  return marked.parse(escapeHtml(content.value), { breaks: true })
})

async function load() {
  try {
    const res = await api.get('/api/command-manual/list')
    if (res.code === 0) list.value = res.data
  } catch {}
}

async function open(name) {
  current.value = name
  content.value = ''
  loading.value = true
  try {
    const res = await api.get(`/api/command-manual/${encodeURIComponent(name)}`)
    if (res.code === 0) content.value = res.data.content
    else ElMessage.error(res.message || '加载失败')
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function copyName() {
  const doCopy = () => ElMessage.success(`已复制 ${current.value}`)
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(current.value).then(doCopy).catch(() => fallbackCopy())
  else fallbackCopy()
}
function fallbackCopy() {
  const ta = document.createElement('textarea')
  ta.value = current.value
  document.body.appendChild(ta)
  ta.select()
  try { document.execCommand('copy'); ElMessage.success(`已复制 ${current.value}`) } catch {}
  document.body.removeChild(ta)
}

function insert() {
  emit('insert', current.value + ' ')
}

watch(keyword, () => { limit.value = 120 })

onMounted(load)
defineExpose({ open })
</script>

<style scoped>
.manual { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.manual.page { flex-direction: row; gap: 12px; }
.manual-list { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.manual.page .manual-list { flex: 0 0 320px; border-right: 1px solid var(--border-color); padding-right: 12px; }
.manual-search { display: flex; align-items: center; gap: 8px; padding: 0 0 8px; }
.manual-count { font-size: 11px; white-space: nowrap; }
.manual-items { flex: 1; overflow-y: auto; min-height: 0; }
.manual-item { padding: 7px 10px; border-radius: var(--radius-sm, 6px); cursor: pointer; transition: background 0.15s; }
.manual-item:hover { background: var(--surface-subtle, rgba(8, 145, 178, 0.08)); }
.manual-item strong { display: block; font-size: 13px; color: var(--text-primary, inherit); font-family: 'JetBrains Mono', ui-monospace, monospace; }
.manual-item small { display: block; font-size: 11px; color: var(--text-muted, #8a9695); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.manual-empty { padding: 24px 0; text-align: center; color: var(--text-muted, #8a9695); font-size: 12px; }
.manual-more { width: 100%; }
.manual-detail { display: flex; flex-direction: column; min-height: 0; flex: 1.6; }
.manual-detail-head { display: flex; align-items: center; gap: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--border-color, rgba(128,128,128,0.2)); }
.manual-title { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 15px; }
.manual-actions { margin-left: auto; display: flex; gap: 6px; }
.manual-content { flex: 1; overflow-y: auto; min-height: 0; padding: 10px 4px; font-size: 13px; line-height: 1.7; }
.manual-content :deep(h1), .manual-content :deep(h2), .manual-content :deep(h3) { font-size: 15px; margin: 14px 0 6px; }
.manual-content :deep(p) { margin: 6px 0; }
.manual-content :deep(ul), .manual-content :deep(ol) { padding-left: 20px; margin: 6px 0; }
.manual-content :deep(code) { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; background: var(--surface-subtle, rgba(8, 145, 178, 0.08)); padding: 1px 5px; border-radius: 4px; }
.manual-content :deep(pre) { background: var(--surface-subtle, rgba(8, 145, 178, 0.08)); padding: 10px; border-radius: 8px; overflow-x: auto; }
.manual-content :deep(pre code) { background: transparent; padding: 0; }
.manual-content :deep(table) { border-collapse: collapse; margin: 8px 0; font-size: 12px; }
.manual-content :deep(th), .manual-content :deep(td) { border: 1px solid var(--border-color, rgba(128,128,128,0.3)); padding: 4px 8px; text-align: left; }
</style>
