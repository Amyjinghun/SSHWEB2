module.exports = {
  apps: [{
    name: 'sshweb',
    script: 'server/src/app.js',
    cwd: '/opt/sshweb',
    env: {
      NODE_ENV: 'production'
    },
    instances: 1,
    autorestart: true,
    max_memory_restart: '512M',
    error_file: '/var/log/sshweb/error.log',
    out_file: '/var/log/sshweb/out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  }]
}
