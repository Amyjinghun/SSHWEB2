// 工具函数 - 获取服务器列表（全局使用）
export function getStatusColor(status) {
  const map = { online: '#0891b2', offline: '#cc4545', unknown: '#718080' }
  return map[status] || '#718080'
}

export function getStatusText(status) {
  const map = { online: '在线', offline: '离线', unknown: '未知' }
  return map[status] || '未知'
}

export function formatDateTime(str) {
  if (!str) return '-'
  return str.replace('T', ' ').substring(0, 19)
}
