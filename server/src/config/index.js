require('dotenv').config();

const env = process.env.NODE_ENV || 'development';
const requiredInProduction = ['JWT_SECRET', 'ENCRYPTION_KEY', 'MYSQL_PASSWORD'];
if (env === 'production') {
  for (const key of requiredInProduction) {
    if (!process.env[key]) {
      throw new Error(`生产环境必须设置 ${key}，不能使用默认密钥或默认数据库密码`);
    }
  }
}

module.exports = {
  appName: process.env.APP_NAME || 'SSHWeb',
  port: parseInt(process.env.APP_PORT) || 18080,
  env,
  jwtSecret: process.env.JWT_SECRET || 'sshweb_jwt_secret_key',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  encryptionKey: process.env.ENCRYPTION_KEY || 'sshweb_encryption_key_32byte',
  mysql: {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT) || 3306,
    database: process.env.MYSQL_DATABASE || 'sshweb',
    user: process.env.MYSQL_USER || 'sshweb',
    password: process.env.MYSQL_PASSWORD || 'sshweb123456',
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0
  },
  ssh: {
    connectTimeout: parseInt(process.env.SSH_CONNECT_TIMEOUT) || 10000,
    execTimeout: parseInt(process.env.SSH_EXEC_TIMEOUT) || 60000
  },
  telegram: {
    enabled: String(process.env.TG_ENABLED || process.env.TELEGRAM_ENABLED || 'false') === 'true',
    botToken: process.env.TG_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TG_CHAT_ID || process.env.TELEGRAM_CHAT_ID || ''
  },
  alerts: {
    cpuThreshold: parseFloat(process.env.ALERT_CPU_THRESHOLD) || 90,
    serverExpiryDays: parseInt(process.env.ALERT_SERVER_EXPIRY_DAYS) || 2,
    memoryThreshold: parseFloat(process.env.ALERT_MEMORY_THRESHOLD) || 90,
    diskThreshold: parseFloat(process.env.ALERT_DISK_THRESHOLD) || 90,
    enableOfflineAlert: String(process.env.ALERT_ENABLE_OFFLINE || 'true') === 'true',
    enableCpuAlert: String(process.env.ALERT_ENABLE_CPU || 'true') === 'true',
    enableMemoryAlert: String(process.env.ALERT_ENABLE_MEMORY || 'true') === 'true',
    enableDiskAlert: String(process.env.ALERT_ENABLE_DISK || 'false') === 'true',
    repeatHours: parseInt(process.env.ALERT_REPEAT_HOURS) || 12
  }
};
