<template>
  <div class="login-page">
    <div class="login-bg">
      <div class="bg-grid"></div>
      <div class="bg-glow bg-glow-1"></div>
      <div class="bg-glow bg-glow-2"></div>
      <div class="login-card">
        <div class="login-header">
          <div class="login-logo">
            <svg viewBox="0 0 56 56" width="56" height="56">
              <defs>
                <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#4f6ef7"/>
                  <stop offset="100%" stop-color="#7b93fa"/>
                </linearGradient>
              </defs>
              <rect width="56" height="56" rx="14" fill="url(#logoGrad)"/>
              <text x="28" y="38" text-anchor="middle" fill="white" font-size="30" font-weight="bold">S</text>
            </svg>
          </div>
          <h1>SSHWeb</h1>
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
        <div class="login-footer">
          <span>SSHWeb &copy; {{ new Date().getFullYear() }}</span>
        </div>
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
  background: #0f172a;
  display: flex; align-items: center; justify-content: center;
  position: relative;
  overflow: hidden;
}

.bg-grid {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(rgba(79, 110, 247, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(79, 110, 247, 0.03) 1px, transparent 1px);
  background-size: 60px 60px;
}

.bg-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  opacity: 0.4;
  animation: glowFloat 8s ease-in-out infinite alternate;
}
.bg-glow-1 {
  width: 500px; height: 500px;
  background: radial-gradient(circle, rgba(79, 110, 247, 0.4), transparent 70%);
  top: -10%; left: -5%;
}
.bg-glow-2 {
  width: 400px; height: 400px;
  background: radial-gradient(circle, rgba(139, 92, 246, 0.3), transparent 70%);
  bottom: -10%; right: -5%;
  animation-delay: 4s;
}

@keyframes glowFloat {
  0% { transform: translate(0, 0) scale(1); }
  100% { transform: translate(30px, -30px) scale(1.1); }
}

.login-card {
  width: 420px;
  background: rgba(255,255,255,0.97);
  border-radius: 20px;
  padding: 48px 40px 32px;
  box-shadow: 0 25px 60px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.1);
  backdrop-filter: blur(20px);
  position: relative;
  z-index: 1;
  animation: cardAppear 0.6s ease;
}

@keyframes cardAppear {
  from { opacity: 0; transform: translateY(20px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.login-header {
  text-align: center;
  margin-bottom: 36px;
  h1 {
    margin: 16px 0 8px;
    font-size: 24px;
    font-weight: 700;
    color: #0f172a;
    letter-spacing: 1px;
  }
  p { color: #64748b; font-size: 14px; margin: 0; }
}

.login-btn {
  width: 100%;
  margin-top: 8px;
  height: 46px;
  font-size: 16px;
  font-weight: 600;
  border-radius: 10px;
  letter-spacing: 4px;
}

.login-footer {
  text-align: center;
  margin-top: 24px;
  color: #94a3b8;
  font-size: 12px;
}
</style>
