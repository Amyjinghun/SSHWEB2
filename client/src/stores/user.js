import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '../api'

export const useUserStore = defineStore('user', () => {
  const token = ref(localStorage.getItem('token') || '')
  const userInfo = ref(null)

  function setToken(t) {
    token.value = t
    localStorage.setItem('token', t)
  }

  function logout() {
    token.value = ''
    userInfo.value = null
    localStorage.removeItem('token')
  }

  async function getUserInfo() {
    const res = await api.get('/api/auth/me')
    if (res.code === 0) userInfo.value = res.data
  }

  return { token, userInfo, setToken, logout, getUserInfo }
})
