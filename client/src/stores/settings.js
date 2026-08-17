import { ref } from 'vue'
import { defineStore } from 'pinia'
import api from '../api'

// 全局设置缓存：终端字号/主题、系统名称等统一从这里取；
// 保存设置后调用 load(true) 刷新，其他页面即可拿到新值
export const useSettingsStore = defineStore('settings', () => {
  const settings = ref(null)
  let loading = null

  async function load(force = false) {
    if (!force && settings.value) return settings.value
    if (!force && loading) return loading
    loading = api.get('/api/settings').then(res => {
      if (res.code === 0) settings.value = res.data
      return settings.value
    }).finally(() => { loading = null })
    return loading
  }

  return { settings, load }
})
