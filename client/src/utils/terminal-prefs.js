import { useSettingsStore } from '../stores/settings'

// 终端外观与「系统设置」联动：WebSSH 与日志查看共用同一套主题/字号
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

// 读取设置失败时回落默认值（13 号/暗色，即改造前的写死值），不阻塞终端打开
export async function getTerminalPrefs() {
  try {
    const s = (await useSettingsStore().load()) || {}
    const fontSize = Number(s.terminal_font_size)
    return {
      fontSize: Number.isFinite(fontSize) && fontSize >= 10 && fontSize <= 24 ? fontSize : 13,
      theme: s.terminal_theme === 'light' ? 'light' : 'dark'
    }
  } catch {
    return { fontSize: 13, theme: 'dark' }
  }
}
