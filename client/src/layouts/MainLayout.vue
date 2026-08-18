<template>
  <el-container class="main-layout">
    <el-aside :width="isMobile ? '0' : (isCollapse ? '64px' : '220px')" class="sidebar dark-sidebar" :class="{ 'mobile-sidebar': isMobile, 'mobile-sidebar--open': isMobile && mobileMenuOpen }">
      <div class="logo" @click="$router.push('/dashboard')">
        <svg viewBox="0 0 32 32" width="30" height="30" class="logo-icon">
          <defs>
            <linearGradient id="sidebarLogo" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#0891b2"/>
              <stop offset="100%" stop-color="#06b6d4"/>
            </linearGradient>
          </defs>
          <rect width="32" height="32" rx="8" fill="url(#sidebarLogo)"/>
          <text x="16" y="22" text-anchor="middle" fill="white" font-size="18" font-weight="bold">S</text>
        </svg>
        <transition name="fade">
          <span v-show="!isCollapse" class="logo-text">{{ systemName }}</span>
        </transition>
      </div>
      <el-menu :default-active="$route.path" router :collapse="isCollapse" background-color="#0f172a" text-color="#94a3b8" active-text-color="#fff" @select="mobileMenuOpen = false">
        <el-menu-item index="/dashboard">
          <el-icon><Monitor /></el-icon>
          <template #title>首页</template>
        </el-menu-item>

        <el-menu-item index="/servers">
          <el-icon><Server /></el-icon>
          <template #title>服务器列表</template>
        </el-menu-item>

        <el-menu-item index="/terminal">
          <el-icon><Terminal /></el-icon>
          <template #title>WebSSH终端</template>
        </el-menu-item>

        <el-sub-menu index="servers">
          <template #title><el-icon><Server /></el-icon><span>服务器管理</span></template>
          <el-menu-item index="/groups">分组管理</el-menu-item>
          <el-menu-item index="/software-installer">软件安装</el-menu-item>
        </el-sub-menu>

        <el-sub-menu index="terminal">
          <template #title><el-icon><Terminal /></el-icon><span>终端管理</span></template>
          <el-menu-item index="/batch">批量命令</el-menu-item>
          <el-menu-item index="/templates">命令模板</el-menu-item>
          <el-menu-item index="/history">执行历史</el-menu-item>
        </el-sub-menu>

        <el-sub-menu index="ops">
          <template #title><el-icon><Tools /></el-icon><span>运维管理</span></template>
          <el-menu-item index="/files">文件管理</el-menu-item>
          <el-menu-item index="/file-distribute">文件分发</el-menu-item>
          <el-menu-item index="/services">服务管理</el-menu-item>
          <el-menu-item index="/processes">进程管理</el-menu-item>
          <el-menu-item index="/docker">Docker管理</el-menu-item>
          <el-menu-item index="/system-manage">系统维护</el-menu-item>
        </el-sub-menu>

        <el-sub-menu index="monitor">
          <template #title><el-icon><DataLine /></el-icon><span>监控中心</span></template>
          <el-menu-item index="/monitor">资源监控</el-menu-item>
          <el-menu-item index="/log-viewer">实时日志</el-menu-item>
          <el-menu-item index="/status-changes">状态记录</el-menu-item>
        </el-sub-menu>

        <el-sub-menu index="tasks">
          <template #title><el-icon><Timer /></el-icon><span>任务管理</span></template>
          <el-menu-item index="/scheduled">计划任务</el-menu-item>
        </el-sub-menu>

        <el-sub-menu index="backup">
          <template #title><el-icon><FolderChecked /></el-icon><span>备份管理</span></template>
          <el-menu-item index="/db-backup">数据库备份</el-menu-item>
          <el-menu-item index="/config-backup">配置备份</el-menu-item>
        </el-sub-menu>

        <el-sub-menu index="security">
          <template #title><el-icon><Lock /></el-icon><span>安全中心</span></template>
          <el-menu-item index="/certificates">证书管理</el-menu-item>
          <el-menu-item index="/alerts">告警中心</el-menu-item>
          <el-menu-item index="/notifications">告警通知</el-menu-item>
          <el-menu-item index="/audit">审计日志</el-menu-item>
          <el-menu-item index="/connection-logs">连接日志</el-menu-item>
        </el-sub-menu>

        <el-sub-menu index="system">
          <template #title><el-icon><Setting /></el-icon><span>系统管理</span></template>
          <el-menu-item index="/users">用户管理</el-menu-item>
          <el-menu-item index="/settings">系统设置</el-menu-item>
        </el-sub-menu>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="header">
        <div class="header-left">
          <el-icon v-if="!isMobile" class="collapse-btn" @click="isCollapse = !isCollapse">
            <Fold v-if="!isCollapse" /><Expand v-else />
          </el-icon>
          <el-icon v-else class="collapse-btn" @click="mobileMenuOpen = true"><Expand /></el-icon>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item>{{ $route.meta.title || '首页' }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="header-right">
          <el-icon class="theme-btn" @click="toggleTheme" :size="18"><Sunny v-if="isDark" /><Moon v-else /></el-icon>
          <el-dropdown @command="handleCommand">
            <span class="user-info">
              <el-avatar :size="32" style="background:linear-gradient(135deg,#0891b2,#06b6d4);font-weight:600">{{ userStore.userInfo?.username?.[0] || 'A' }}</el-avatar>
              <span class="user-name" v-show="!isMobile">{{ userStore.userInfo?.username || '管理员' }}</span>
              <el-icon class="arrow-icon"><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="password"><el-icon><Lock /></el-icon>修改密码</el-dropdown-item>
                <el-dropdown-item command="logout" divided><el-icon><SwitchButton /></el-icon>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>
      <el-main class="main-content">
        <router-view v-slot="{ Component }">
          <transition name="page-fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </el-main>
    </el-container>

    <!-- 修改密码对话框 -->
    <el-dialog v-model="showPasswordDialog" title="修改密码" width="400px">
      <el-form :model="passwordForm" label-width="80px">
        <el-form-item label="旧密码"><el-input v-model="passwordForm.oldPassword" type="password" show-password /></el-form-item>
        <el-form-item label="新密码"><el-input v-model="passwordForm.newPassword" type="password" show-password /></el-form-item>
        <el-form-item label="确认密码"><el-input v-model="passwordForm.confirmPassword" type="password" show-password /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showPasswordDialog = false">取消</el-button>
        <el-button type="primary" @click="changePassword">确定</el-button>
      </template>
    </el-dialog>
    <div v-if="isMobile && mobileMenuOpen" class="mobile-overlay" @click="mobileMenuOpen = false"></div>
  </el-container>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'
import { useSettingsStore } from '../stores/settings'
import api from '../api'
import { ElMessage } from 'element-plus'

const router = useRouter()
const userStore = useUserStore()
const settingsStore = useSettingsStore()
// 侧边栏系统名称来自系统设置
const systemName = computed(() => settingsStore.settings?.system_name || 'SSHWeb')
const isCollapse = ref(false)
const isDark = ref(localStorage.getItem('theme') === 'dark')
const isMobile = ref(false)
const mobileMenuOpen = ref(false)
const showPasswordDialog = ref(false)
const passwordForm = ref({ oldPassword: '', newPassword: '', confirmPassword: '' })

function checkMobile() {
  isMobile.value = window.innerWidth < 768
  if (!isMobile.value) mobileMenuOpen.value = false
}

onMounted(() => {
  userStore.getUserInfo()
  settingsStore.load().catch(() => {})
  document.documentElement.classList.toggle('dark', isDark.value)
  checkMobile()
  window.addEventListener('resize', checkMobile)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', checkMobile)
})

function toggleTheme() {
  isDark.value = !isDark.value
  document.documentElement.classList.toggle('dark', isDark.value)
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
}

function handleCommand(cmd) {
  if (cmd === 'logout') {
    api.post('/api/auth/logout')
    userStore.logout()
    router.push('/login')
  } else if (cmd === 'password') {
    passwordForm.value = { oldPassword: '', newPassword: '', confirmPassword: '' }
    showPasswordDialog.value = true
  }
}

async function changePassword() {
  const { oldPassword, newPassword, confirmPassword } = passwordForm.value
  if (!oldPassword || !newPassword) return ElMessage.warning('请填写密码')
  if (newPassword !== confirmPassword) return ElMessage.warning('两次密码不一致')
  if (newPassword.length < 6) return ElMessage.warning('密码至少6位')
  const res = await api.post('/api/auth/change-password', { oldPassword, newPassword })
  if (res.code === 0) {
    ElMessage.success('密码已修改，请重新登录')
    showPasswordDialog.value = false
    // 改密后旧 token 已在服务端失效（token_version+1），无需再调 logout
    // （那个请求必然 401，只会弹一条"登录已过期"的错误提示），直接回登录页
    userStore.logout()
    router.push('/login')
  } else ElMessage.error(res.message)
}
</script>

<style scoped lang="scss">
.main-layout { height: 100vh; }
.sidebar {
  background: var(--sidebar-bg);
  overflow-y: auto;
  overflow-x: hidden;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  border-right: 1px solid var(--sidebar-border);
}
.logo {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border-bottom: 1px solid var(--sidebar-border);
  cursor: pointer;
  transition: background 0.2s;
  &:hover { background: rgba(6, 182, 212, 0.08); }
  .logo-icon { flex-shrink: 0; }
  .logo-text {
    color: #fff;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 1.5px;
    white-space: nowrap;
  }
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  backdrop-filter: blur(14px);
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  padding: 0 24px;
  height: 56px;
  border-bottom: 1px solid var(--border-color);
  z-index: 10;
  position: sticky;
  top: 0;
  .header-left { display: flex; align-items: center; gap: 16px; }
  .collapse-btn {
    font-size: 20px;
    cursor: pointer;
    color: var(--text-muted);
    padding: 4px;
    border-radius: var(--radius-sm);
    transition: all var(--transition-fast);
    &:hover { color: var(--primary-color); background: var(--primary-bg); }
  }
  .header-right { display: flex; align-items: center; gap: 8px; }
  .theme-btn {
    cursor: pointer;
    color: var(--text-muted);
    padding: 8px;
    border-radius: var(--radius-sm);
    transition: all var(--transition-fast);
    &:hover { color: var(--primary-color); background: var(--primary-bg); }
  }
  .user-info {
    display: flex;
    align-items: center;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    transition: background var(--transition-fast);
    &:hover { background: var(--surface-subtle); }
  }
  .user-name {
    margin-left: 10px;
    font-weight: 500;
    color: var(--text-primary);
    font-size: 14px;
  }
  .arrow-icon { margin-left: 4px; color: var(--text-muted); font-size: 12px; }
}

.main-content {
  background: var(--bg-color);
  overflow-y: auto;
}

/* 移动端侧边栏抽屉 */
.mobile-sidebar {
  position: fixed !important;
  top: 0;
  left: 0;
  bottom: 0;
  width: 220px !important;
  z-index: 200;
  transform: translateX(-100%);
  transition: transform 0.3s ease;
}
.mobile-sidebar--open {
  transform: translateX(0);
  box-shadow: 4px 0 20px rgba(0,0,0,0.3);
}
.mobile-overlay {
  position: fixed;
  inset: 0;
  z-index: 199;
  background: rgba(0,0,0,0.45);
  backdrop-filter: blur(2px);
}

.el-menu { border-right: none !important; }

.page-fade-enter-active, .page-fade-leave-active {
  transition: opacity 0.15s ease;
}
.page-fade-enter-from, .page-fade-leave-to {
  opacity: 0;
}
</style>
