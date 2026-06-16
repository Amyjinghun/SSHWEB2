require('dotenv').config();

const env = process.env.NODE_ENV || 'development';
const isProduction = env === 'production';

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Production requires ${name}`);
  return value;
}

function rejectUnsafeProductionValue(name, unsafeValues) {
  const value = required(name);
  if (unsafeValues.includes(value)) {
    throw new Error(`Production ${name} must not use an insecure default value`);
  }
  return value;
}

const mysqlPassword = isProduction
  ? rejectUnsafeProductionValue('MYSQL_PASSWORD', ['sshweb123456', 'rootpassword', 'password'])
  : (process.env.MYSQL_PASSWORD || 'sshweb123456');

const jwtSecret = isProduction
  ? rejectUnsafeProductionValue('JWT_SECRET', ['sshweb_jwt_secret_key', 'please_change_this_secret_key', 'change_me_to_random_string'])
  : (process.env.JWT_SECRET || 'sshweb_jwt_secret_key');

const encryptionKey = isProduction
  ? rejectUnsafeProductionValue('ENCRYPTION_KEY', ['sshweb_encryption_key_32byte', 'please_change_this_encryption_key', 'change_me_to_32_byte_key'])
  : (process.env.ENCRYPTION_KEY || 'sshweb_encryption_key_32byte');

const allowedOrigins = parseList(process.env.CORS_ORIGINS);
const corsOrigin = allowedOrigins.length ? allowedOrigins : (isProduction ? false : true);

module.exports = {
  appName: process.env.APP_NAME || 'SSHWeb',
  port: parseInt(process.env.APP_PORT, 10) || 18080,
  env,
  isProduction,
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  encryptionKey,
  cors: {
    origin: corsOrigin,
    credentials: false
  },
  security: {
    allowQueryToken: parseBool(process.env.ALLOW_QUERY_TOKEN, !isProduction),
    allowPlainCredentialExport: parseBool(process.env.ALLOW_PLAIN_CREDENTIAL_EXPORT, false),
    dangerousCommandAction: process.env.DANGEROUS_COMMAND_ACTION || (isProduction ? 'block' : 'confirm')
  },
  mysql: {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT, 10) || 3306,
    database: process.env.MYSQL_DATABASE || 'sshweb',
    user: process.env.MYSQL_USER || 'sshweb',
    password: mysqlPassword,
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0
  },
  ssh: {
    connectTimeout: parseInt(process.env.SSH_CONNECT_TIMEOUT, 10) || 10000,
    execTimeout: parseInt(process.env.SSH_EXEC_TIMEOUT, 10) || 60000
  },
  telegram: {
    enabled: parseBool(process.env.TG_ENABLED || process.env.TELEGRAM_ENABLED, false),
    botToken: process.env.TG_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TG_CHAT_ID || process.env.TELEGRAM_CHAT_ID || ''
  },
  alerts: {
    cpuThreshold: parseFloat(process.env.ALERT_CPU_THRESHOLD) || 90,
    serverExpiryDays: parseInt(process.env.ALERT_SERVER_EXPIRY_DAYS, 10) || 2,
    memoryThreshold: parseFloat(process.env.ALERT_MEMORY_THRESHOLD) || 90,
    diskThreshold: parseFloat(process.env.ALERT_DISK_THRESHOLD) || 90,
    enableOfflineAlert: parseBool(process.env.ALERT_ENABLE_OFFLINE, true),
    enableCpuAlert: parseBool(process.env.ALERT_ENABLE_CPU, true),
    enableMemoryAlert: parseBool(process.env.ALERT_ENABLE_MEMORY, true),
    enableDiskAlert: parseBool(process.env.ALERT_ENABLE_DISK, false),
    repeatHours: parseInt(process.env.ALERT_REPEAT_HOURS, 10) || 12
  }
};
