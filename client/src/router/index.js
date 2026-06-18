import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue')
  },
  {
    path: '/public/monitor/:shareKey',
    name: 'PublicMonitor',
    component: () => import('../views/PublicMonitor.vue'),
    meta: { public: true }
  },
  {
    path: '/',
    component: () => import('../layouts/MainLayout.vue'),
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', name: 'Dashboard', component: () => import('../views/Dashboard.vue'), meta: { title: '首页' } },
      { path: 'servers', name: 'Servers', component: () => import('../views/servers/ServerList.vue'), meta: { title: '服务器列表' } },
      { path: 'servers/add', name: 'ServerAdd', component: () => import('../views/servers/ServerForm.vue'), meta: { title: '添加服务器' } },
      { path: 'servers/edit/:id', name: 'ServerEdit', component: () => import('../views/servers/ServerForm.vue'), meta: { title: '编辑服务器' } },
      { path: 'groups', name: 'Groups', component: () => import('../views/servers/GroupManage.vue'), meta: { title: '分组管理' } },
      { path: 'terminal', name: 'Terminal', component: () => import('../views/terminal/WebSSH.vue'), meta: { title: 'WebSSH终端' } },
      { path: 'batch', name: 'BatchExec', component: () => import('../views/terminal/BatchExec.vue'), meta: { title: '批量命令' } },
      { path: 'templates', name: 'Templates', component: () => import('../views/terminal/CommandTemplates.vue'), meta: { title: '命令模板' } },
      { path: 'history', name: 'History', component: () => import('../views/terminal/ExecHistory.vue'), meta: { title: '执行历史' } },
      { path: 'files', name: 'FileManager', component: () => import('../views/files/FileManager.vue'), meta: { title: '文件管理' } },
      { path: 'services', name: 'Services', component: () => import('../views/services/ServiceManage.vue'), meta: { title: '服务管理' } },
      { path: 'processes', name: 'Processes', component: () => import('../views/services/ProcessManage.vue'), meta: { title: '进程管理' } },
      { path: 'monitor', name: 'ServerMonitor', component: () => import('../views/monitor/ServerMonitor.vue'), meta: { title: '资源监控' } },
      { path: 'log-viewer', name: 'LogViewer', component: () => import('../views/logs/LogViewer.vue'), meta: { title: '实时日志' } },
      { path: 'file-distribute', name: 'FileDistribute', component: () => import('../views/files/FileDistribute.vue'), meta: { title: '文件分发' } },
      { path: 'status-changes', name: 'StatusChanges', component: () => import('../views/monitor/StatusChanges.vue'), meta: { title: '状态记录' } },
      { path: 'scheduled', name: 'Scheduled', component: () => import('../views/tasks/ScheduledTasks.vue'), meta: { title: '计划任务' } },
      { path: 'db-backup', name: 'DbBackup', component: () => import('../views/backups/DbBackup.vue'), meta: { title: '数据库备份' } },
      { path: 'config-backup', name: 'ConfigBackup', component: () => import('../views/backups/ConfigBackup.vue'), meta: { title: '配置备份' } },
      { path: 'certificates', name: 'Certificates', component: () => import('../views/security/Certificates.vue'), meta: { title: '证书管理' } },
      { path: 'alerts', name: 'Alerts', component: () => import('../views/security/AlertCenter.vue'), meta: { title: '告警中心' } },
      { path: 'notifications', name: 'Notifications', component: () => import('../views/security/NotificationSettings.vue'), meta: { title: '告警通知' } },
      { path: 'audit', name: 'Audit', component: () => import('../views/security/AuditLog.vue'), meta: { title: '审计日志' } },
      { path: 'users', name: 'Users', component: () => import('../views/system/UserManage.vue'), meta: { title: '用户管理' } },
      { path: 'settings', name: 'Settings', component: () => import('../views/system/SystemSettings.vue'), meta: { title: '系统设置' } },
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('token')
  if (to.meta.public) {
    next()
  } else if (to.path !== '/login' && !token) {
    next('/login')
  } else if (to.path === '/login' && token) {
    next('/dashboard')
  } else {
    next()
  }
})

export default router
