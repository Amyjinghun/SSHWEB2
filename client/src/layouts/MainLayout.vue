<template>
  <el-container class="main-layout">
    <el-aside :width="isCollapse ? '64px' : '220px'" class="sidebar dark-sidebar">
      <div class="logo">
        <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23409EFF'/%3E%3Ctext x='16' y='22' text-anchor='middle' fill='white' font-size='18' font-weight='bold'%3ES%3C/text%3E%3C/svg%3E" width="32" height="32" />
        <span v-show="!isCollapse" class="logo-text">SSHWeb</span>
      </div>
      <el-menu :default-active="$route.path" router :collapse="isCollapse" background-color="#1d1e1f" text-color="#bfcbd9" active-text-color="#409EFF">
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
          <el-menu-item index="/services">服务管理</el-menu-item>
          <el-menu-item index="/processes">进程管理</el-menu-item>
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
              <el-avatar :size="28" style="background:#409EFF">{{ userStore.userInfo?.username?.[0] || 'A' }}</el-avatar>
              <span style="margin-left:8px">{{ userStore.userInfo?.username || '管理员' }}</span>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="password">修改密码</el-dropdown-item>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>
      <el-main class="main-content">
        <router-view />
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
  background: #1d1e1f;
  overflow-y: auto;
  overflow-x: hidden;
  transition: width 0.3s;
}
.logo {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
  .logo-text { color: #fff; font-size: 18px; font-weight: 700; letter-spacing: 2px; white-space: nowrap; }
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
  padding: 0 20px;
  .header-left { display: flex; align-items: center; gap: 16px; }
  .collapse-btn { font-size: 20px; cursor: pointer; color: #666; &:hover { color: #409EFF; } }
  .header-right { display: flex; align-items: center; }
  .user-info { display: flex; align-items: center; cursor: pointer; }
}
.main-content { background: #f0f2f5; overflow-y: auto; }
.el-menu { border-right: none !important; }
</style>
