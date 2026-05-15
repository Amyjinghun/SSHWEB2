<template>
  <div class="login-page">
    <div class="login-bg">
      <div class="login-card">
        <div class="login-header">
          <div class="login-logo">
            <svg viewBox="0 0 48 48" width="48" height="48">
              <rect width="48" height="48" rx="10" fill="#409EFF"/>
              <text x="24" y="33" text-anchor="middle" fill="white" font-size="28" font-weight="bold">S</text>
            </svg>
          </div>
          <h1>SSHWeb 服务器群控面板</h1>
          <p>Linux 服务器群控 WebSSH 运维管理系统</p>
        </div>
        <el-form :model="form" @keyup.enter="handleLogin" class="login-form">
          <el-form-item>
            <el-input v-model="form.username" placeholder="请输入用户名" size="large" prefix-icon="User" />
          </el-form-item>
          <el-form-item>
            <el-input v-model="form.password" type="password" placeholder="请输入密码" size="large" prefix-icon="Lock" show-password />
          </el-form-item>
          <el-button type="primary" size="large" :loading="loading" @click="handleLogin" class="login-btn">登 录</el-button>
        </el-form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'
import api from '../api'
import { ElMessage } from 'element-plus'

const router = useRouter()
const userStore = useUserStore()
const form = ref({ username: '', password: '' })
const loading = ref(false)

async function handleLogin() {
  if (!form.value.username || !form.value.password) return ElMessage.warning('请输入用户名和密码')
  loading.value = true
  try {
    const res = await api.post('/api/auth/login', form.value)
    if (res.code === 0) {
      userStore.setToken(res.data.token)
      ElMessage.success('登录成功')
      router.push('/dashboard')
    } else {
      ElMessage.error(res.message)
    }
  } finally { loading.value = false }
}
</script>

<style scoped lang="scss">
.login-page { height: 100vh; }
.login-bg {
  height: 100%;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  display: flex; align-items: center; justify-content: center;
}
.login-card {
  width: 420px;
  background: rgba(255,255,255,0.95);
  border-radius: 16px;
  padding: 48px 40px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  backdrop-filter: blur(10px);
}
.login-header {
  text-align: center;
  margin-bottom: 32px;
  h1 { margin: 16px 0 8px; font-size: 22px; color: #1a1a2e; }
  p { color: #909399; font-size: 14px; margin: 0; }
}
.login-btn { width: 100%; margin-top: 8px; height: 44px; font-size: 16px; border-radius: 8px; }
.login-footer { text-align: center; margin-top: 20px; color: #c0c4cc; font-size: 12px; }
</style>
