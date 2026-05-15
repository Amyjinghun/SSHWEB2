<template>
  <el-container class="main-layout">
    <el-aside :width="isCollapse ? '64px' : '220px'" class="sidebar dark-sidebar">
      <div class="logo" @click="$router.push('/dashboard')">
        <svg viewBox="0 0 32 32" width="30" height="30" class="logo-icon">
          <defs>
            <linearGradient id="sidebarLogo" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#4f6ef7"/>
              <stop offset="100%" stop-color="#7b93fa"/>
            </linearGradient>
          </defs>
          <rect width="32" height="32" rx="8" fill="url(#sidebarLogo)"/>
          <text x="16" y="22" text-anchor="middle" fill="white" font-size="18" font-weight="bold">S</text>
        </svg>
        <transition name="fade">
          <span v-show="!isCollapse" class="logo-text">SSHWeb</span>
        </transition>
      </div>
      <el-menu :default-active="$route.path" router :collapse="isCollapse" background-color="#0f172a" text-color="#94a3b8" active-text-color="#fff">
        <el-menu-item index="/dashboard">
          <el-icon><Monitor /></el-icon>
          <template #title>首页</template>
        </el-menu-item>

        <el-sub-menu index="servers">
          <template #title><el-icon><Server /></el-icon><span>服务器管理</span></template>
          <el-menu-item index="/servers">服务器列表</el-menu-item>
          <el-menu-item index="/groups">分组管理</el-menu-item>
        </el-sub-menu>

        <el-sub-menu index="terminal">
          <template #title><el-icon><Terminal /></el-icon><span>终端管理</span></template>
          <el-menu-item index="/terminal">WebSSH终端</el-menu-item>
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
          <el-icon class="collapse-btn" @click="isCollapse = !isCollapse">
            <Fold v-if="!isCollapse" /><Expand v-else />
          </el-icon>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item>{{ $route.meta.title || '首页' }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="header-right">
          <el-dropdown @command="handleCommand">
            <span class="user-info">
              <el-avatar :size="32" style="background:linear-gradient(135deg,#4f6ef7,#7b93fa);font-weight:600">{{ userStore.userInfo?.username?.[0] || 'A' }}</el-avatar>
              <span class="user-name">{{ userStore.userInfo?.username || '管理员' }}</span>
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
  </el-container>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'
import api from '../api'
import { ElMessage } from 'element-plus'

const router = useRouter()
const userStore = useUserStore()
const isCollapse = ref(false)
const showPasswordDialog = ref(false)
const passwordForm = ref({ oldPassword: '', newPassword: '', confirmPassword: '' })

onMounted(() => { userStore.getUserInfo() })

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
  if (res.code === 0) { ElMessage.success('密码修改成功'); showPasswordDialog.value = false }
  else ElMessage.error(res.message)
}
</script>

<style scoped lang="scss">
.main-layout { height: 100vh; }
.sidebar {
  background: #0f172a;
  overflow-y: auto;
  overflow-x: hidden;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  border-right: 1px solid rgba(255,255,255,0.05);
}
.logo {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  cursor: pointer;
  transition: background 0.2s;
  &:hover { background: rgba(79, 110, 247, 0.08); }
  .logo-icon { flex-shrink: 0; }
  .logo-text {
    color: #fff;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 2px;
    white-space: nowrap;
  }
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  padding: 0 24px;
  height: 56px;
  border-bottom: 1px solid #f0f2f7;
  .header-left { display: flex; align-items: center; gap: 16px; }
  .collapse-btn {
    font-size: 20px;
    cursor: pointer;
    color: #64748b;
    padding: 4px;
    border-radius: 6px;
    transition: all 0.15s;
    &:hover { color: #4f6ef7; background: rgba(79, 110, 247, 0.08); }
  }
  .header-right { display: flex; align-items: center; }
  .user-info {
    display: flex;
    align-items: center;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 8px;
    transition: background 0.15s;
    &:hover { background: #f4f6fb; }
  }
  .user-name {
    margin-left: 10px;
    font-weight: 500;
    color: #1e293b;
    font-size: 14px;
  }
  .arrow-icon { margin-left: 4px; color: #94a3b8; font-size: 12px; }
}

.main-content {
  background: #f4f6fb;
  overflow-y: auto;
}

.el-menu { border-right: none !important; }

.page-fade-enter-active, .page-fade-leave-active {
  transition: opacity 0.15s ease;
}
.page-fade-enter-from, .page-fade-leave-to {
  opacity: 0;
}
</style>
