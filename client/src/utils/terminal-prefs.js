import { useSettingsStore } from '../stores/settings'

// 终端外观与「系统设置」联动：WebSSH 与日志查看共用同一套主题/字号。
// 系统设置为全局默认，用户可在终端工具栏覆盖为自己的偏好（localStorage）。
export const TERMINAL_THEMES = {
  dark: {
    background: '#0b1214', foreground: '#d8dddc', cursor: '#0891b2', cursorAccent: '#0b1214',
    selectionBackground: 'rgba(8, 145, 178, 0.22)',
    black: '#1d2426', red: '#d86f74', green: '#91b56d', yellow: '#d5ae62',
    blue: '#76a4c7', magenta: '#ad8bb8', cyan: '#72aaa7', white: '#c9cecd',
    brightBlack: '#687376', brightRed: '#e68589', brightGreen: '#a7c982', brightYellow: '#e3c27b',
    brightBlue: '#8bb9dc', brightMagenta: '#c19bcb', brightCyan: '#8cc2be', brightWhite: '#f0f2f1'
  },
  light: {
    background: '#f7f9fa', foreground: '#1e293b', cursor: '#0891b2', cursorAccent: '#ffffff',
    selectionBackground: 'rgba(8, 145, 178, 0.18)',
    black: '#2f3b42', red: '#c4535a', green: '#5c8a3c', yellow: '#a07722',
    blue: '#36739c', magenta: '#8a5f97', cyan: '#3f8683', white: '#5f6b70',
    brightBlack: '#66757c', brightRed: '#d05f66', brightGreen: '#6f9d4e', brightYellow: '#b98c2e',
    brightBlue: '#4a87b3', brightMagenta: '#a06fae', brightCyan: '#54a09c', brightWhite: '#333e44'
  }
}

export function terminalTheme(name) {
  return TERMINAL_THEMES[name] || TERMINAL_THEMES.dark
}

const USER_PREFS_KEY = 'term_user_prefs'

// 用户级覆盖项（localStorage），与系统设置键同名便于合并
export function loadUserPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(USER_PREFS_KEY))
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

export function saveUserPrefs(patch) {
  const next = { ...loadUserPrefs(), ...patch }
  try { localStorage.setItem(USER_PREFS_KEY, JSON.stringify(next)) } catch {}
  return next
}

function clampFontSize(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) && n >= 10 && n <= 24 ? n : fallback
}

// 系统设置为底、用户覆盖在上；读取失败回落默认值（13 号/暗色），不阻塞终端打开
export async function getTerminalPrefs() {
  let system = {}
  try {
    system = (await useSettingsStore().load()) || {}
  } catch {}
  const user = loadUserPrefs()
  return {
    fontSize: clampFontSize(user.fontSize ?? system.terminal_font_size, 13),
    theme: user.theme === 'light' ? 'light' : user.theme === 'dark' ? 'dark' : (system.terminal_theme === 'light' ? 'light' : 'dark'),
    localHistory: user.localHistory !== false,
    fontFamily: typeof user.fontFamily === 'string' ? user.fontFamily : ''
  }
}
