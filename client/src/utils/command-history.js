// 终端命令历史：按用户隔离存 localStorage（与 XTerminal 的本地历史一致，不上服务器）
const MAX_HISTORY = 500

export function historyKey(username) {
  return `term_history_${username || 'default'}`
}

export function loadHistory(username) {
  try {
    const raw = JSON.parse(localStorage.getItem(historyKey(username)))
    return Array.isArray(raw) ? raw.filter(x => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function pushHistory(username, command) {
  const cmd = String(command || '').trim()
  if (!cmd) return
  const list = loadHistory(username)
  const idx = list.indexOf(cmd)
  if (idx !== -1) list.splice(idx, 1)
  list.unshift(cmd)
  while (list.length > MAX_HISTORY) list.pop()
  try { localStorage.setItem(historyKey(username), JSON.stringify(list)) } catch {}
}

export function clearHistory(username) {
  localStorage.removeItem(historyKey(username))
}
