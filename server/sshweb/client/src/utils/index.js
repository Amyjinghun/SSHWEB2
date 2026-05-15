// 工具函数 - 获取服务器列表（全局使用）
export function getStatusColor(status) {
  const map = { online: '#67C23A', offline: '#F56C6C', unknown: '#909399' }
  return map[status] || '#909399'
}

export function getStatusText(status) {
  const map = { online: '在线', offline: '离线', unknown: '未知' }
  return map[status] || '未知'
}

export function formatDateTime(str) {
  if (!str) return '-'
  return str.replace('T', ' ').substring(0, 19)
}
