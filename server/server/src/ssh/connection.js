const { Client } = require('ssh2');
const config = require('../config');
const { decrypt } = require('../utils/crypto');

const DANGEROUS_PATTERNS = [
  // 破坏性删除/格式化/磁盘覆盖
  /(^|[;&|])\s*rm\s+[^;&|]*\s(-rf|-fr)\s+(\/|\/\*|~|\$HOME|\.\.?\s*$)/i,
  /(^|[;&|])\s*rm\s+[^;&|]*\s(-rf|-fr)\s+[^;&|]*\*/i,
  /(^|[;&|])\s*(mkfs|mke2fs|wipefs|fdisk|parted)\b/i,
  /(^|[;&|])\s*dd\s+[^;&|]*(if=|of=)/i,

  // 关机/重启/系统级危险操作
  /(^|[;&|])\s*(shutdown|reboot|poweroff|halt)\b/i,
  /(^|[;&|])\s*init\s+[06]\b/i,
  /(^|[;&|])\s*systemctl\s+(halt|poweroff|reboot|rescue|emergency)\b/i,

  // 明显破坏系统权限或敏感文件
  /(^|[;&|])\s*chmod\s+[^;&|]*(-R|--recursive)[^;&|]*\s+777\s+(\/|\/etc|\/usr|\/var|\/root|~)/i,
  /(^|[;&|])\s*chown\s+[^;&|]*(-R|--recursive)\s+[^;&|]+\s+(\/|\/etc|\/usr|\/var|\/root)/i,
  />\s*\/(etc\/passwd|etc\/shadow|etc\/sudoers)\b/i,
  /(^|[;&|])\s*mv\s+[^;&|]+\s+\/(etc\/passwd|etc\/shadow|etc\/sudoers)\b/i,

  // 下载脚本直接执行、反弹 shell、fork bomb
  /\b(curl|wget)\b[^;&|]*(\||-O\s*-)[^;&|]*\b(sh|bash|zsh|python|perl)\b/i,
  /\b(bash|sh)\s+-c\s+['"][^'"]*\/dev\/tcp\//i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/
];

function shellQuote(value) {
  const str = String(value ?? '');
  return `'${str.replace(/'/g, `'\\''`)}'`;
}

function isDangerousCommand(cmd) {
  const trimmed = String(cmd || '').trim();
  if (!trimmed) return false;
  return DANGEROUS_PATTERNS.some(p => p.test(trimmed));
}

function safeDecrypt(value) {
  if (!value) return undefined;
  try { return decrypt(value); } catch (err) { throw new Error('凭据解密失败，请检查加密密钥 ENCRYPTION_KEY 是否与保存服务器时一致'); }
}

function normalizeSSHConfig(serverInfo = {}) {
  let host = String(serverInfo.host || '').trim();
  let port = Number(serverInfo.port) || 22;
  const username = String(serverInfo.username || '').trim();

  // 兼容用户把主机写成 1.2.3.4:2222 的情况，不处理 IPv6 冒号格式。
  const hostPortMatch = host.match(/^([^:\[\]]+):(\d+)$/);
  if (hostPortMatch) {
    host = hostPortMatch[1];
    port = Number(hostPortMatch[2]) || port;
  }

  if (!host) throw new Error('主机地址不能为空');
  if (!username) throw new Error('SSH 用户名不能为空');

  const authType = serverInfo.auth_type || serverInfo.authType || 'password';
  const passwordEncrypted = serverInfo.password_encrypted || serverInfo.password;
  const privateKeyEncrypted = serverInfo.private_key_encrypted || serverInfo.private_key || serverInfo.privateKey;
  const passphraseEncrypted = serverInfo.private_key_passphrase_encrypted || serverInfo.private_key_passphrase || serverInfo.privateKeyPassphrase;

  const connectConfig = {
    host,
    port,
    username,
    readyTimeout: config.ssh.connectTimeout,
    connectTimeout: config.ssh.connectTimeout,
    keepaliveInterval: 15000,
    keepaliveCountMax: 3,
    tryKeyboard: true
  };

  if (authType === 'password' || authType === 'password_private_key') {
    const password = safeDecrypt(passwordEncrypted);
    if (password) connectConfig.password = password;
  }

  if (authType === 'private_key' || authType === 'password_private_key') {
    const privateKey = safeDecrypt(privateKeyEncrypted);
    if (privateKey) connectConfig.privateKey = privateKey;
    const passphrase = safeDecrypt(passphraseEncrypted);
    if (passphrase) connectConfig.passphrase = passphrase;
  }

  if (!connectConfig.password && !connectConfig.privateKey) {
    throw new Error('未找到 SSH 密码或私钥，请重新编辑服务器认证信息');
  }

  return connectConfig;
}

function formatSSHError(err) {
  const message = err?.message || String(err || '连接失败');
  if (/ECONNREFUSED/i.test(message)) return '连接被拒绝，请检查 SSH 端口是否正确、目标服务器 SSH 服务是否启动';
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) return '主机解析失败，请检查服务器 IP/域名是否正确';
  if (/ETIMEDOUT|Timed out|timeout/i.test(message)) return '连接超时，请检查防火墙、安全组、端口或网络连通性';
  if (/All configured authentication methods failed|Authentication failed|Permission denied/i.test(message)) return '认证失败，请检查用户名、密码、私钥或目标服务器 SSH 登录策略';
  if (/Cannot parse privateKey|privateKey/i.test(message)) return '私钥格式错误或私钥密码不正确';
  if (/HANDSHAKE|algorithm|no matching/i.test(message)) return 'SSH 握手失败，可能是算法不兼容';
  return message;
}

function createSSHConnection(serverInfo) {
  return new Promise((resolve, reject) => {
    let connectConfig;
    try {
      connectConfig = normalizeSSHConfig(serverInfo);
    } catch (err) {
      return reject(err);
    }

    const conn = new Client();
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn(value);
    };

    const timeout = setTimeout(() => {
      try { conn.end(); } catch {}
      finish(reject, new Error('连接超时'));
    }, config.ssh.connectTimeout + 1000);

    conn.on('ready', () => finish(resolve, conn));
    conn.on('keyboard-interactive', (name, instructions, lang, prompts, finishAuth) => {
      const password = connectConfig.password || '';
      finishAuth(prompts.map(() => password));
    });
    conn.on('error', (err) => finish(reject, new Error(formatSSHError(err))));
    conn.connect(connectConfig);
  });
}

function execCommand(conn, command, timeout) {
  return new Promise((resolve, reject) => {
    const execTimeout = timeout || config.ssh.execTimeout;
    let stdout = '';
    let stderr = '';
    let timer;

    conn.exec(command, (err, stream) => {
      if (err) return reject(err);

      timer = setTimeout(() => {
        try { stream.close(); } catch {}
        reject(new Error('命令执行超时'));
      }, execTimeout);

      stream.on('data', (data) => { stdout += data.toString(); });
      stream.stderr.on('data', (data) => { stderr += data.toString(); });
      stream.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, out: stdout, exitCode: code });
      });
    });
  });
}

module.exports = { createSSHConnection, execCommand, isDangerousCommand, normalizeSSHConfig, formatSSHError, shellQuote };
