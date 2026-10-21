const { Client } = require('ssh2');
const iconv = require('iconv-lite');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { normalizeSSHConfig, formatSSHError } = require('../ssh/connection');
const { writeAuditLog } = require('../utils/audit');
const { createRecorder } = require('../services/term-record');
const db = require('../db');

async function getSettingValue(key, fallback) {
  try {
    const row = await db.queryOne('SELECT setting_value FROM settings WHERE setting_key = ?', [key]);
    return row ? row.setting_value : fallback;
  } catch {
    return fallback;
  }
}

function describeConnectionTarget(server, connectConfig) {
  const authType = server?.auth_type || 'password';
  const credential = [
    server?.password_encrypted ? '密码' : '',
    server?.private_key_encrypted ? '私钥' : ''
  ].filter(Boolean).join('+') || '无';
  return `面板实际连接 ${connectConfig.host}:${connectConfig.port}，用户 ${connectConfig.username}，认证 ${authType}，已保存凭据 ${credential}`;
}

// 终端数据支持的双向转换编码（iconv-lite 名单）。探测输出不在名单内一律回落 UTF-8。
const SUPPORTED_ENCODINGS = ['utf-8', 'gbk', 'gb2312', 'gb18030', 'big5', 'shift_jis', 'euc-jp', 'euc-kr'];

function normalizeDetectedEncoding(raw) {
  const name = String(raw || '').trim().toLowerCase();
  // ANSI_X3.4-1968 = C/POSIX locale（ASCII），是 UTF-8 子集，无需转换
  if (!name || name === 'ansi_x3.4-1968' || name === 'c' || name === 'posix' || name === 'utf8' || name === 'utf-8') {
    return 'utf-8';
  }
  return SUPPORTED_ENCODINGS.includes(name) ? name : 'utf-8';
}

// 探测用户登录 shell 下的真实编码（$SHELL -ilc 会加载 profile 里的 LANG 设置），
// 探测失败/超时回落 UTF-8，绝不阻塞终端打开。
function detectEncoding(conn, callback) {
  let done = false;
  const finish = (enc, raw) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    callback(enc, raw);
  };
  const timer = setTimeout(() => finish('utf-8', ''), 4000);
  try {
    conn.exec('$SHELL -ilc "locale charmap"', (err, s) => {
      if (err) return finish('utf-8', '');
      let out = '';
      s.on('data', (d) => { out += d.toString(); });
      s.on('close', () => finish(normalizeDetectedEncoding(out), out.trim()));
    });
  } catch {
    finish('utf-8', '');
  }
}

// 每用户并发会话数限制（单进程内计数；PM2 需保持 fork 单实例模式）
const sessionCounts = new Map();

function acquireSessionSlot(userId) {
  const current = sessionCounts.get(userId) || 0;
  if (current >= config.ssh.maxSessionsPerUser) return false;
  sessionCounts.set(userId, current + 1);
  return true;
}

function releaseSessionSlot(userId) {
  const current = (sessionCounts.get(userId) || 0) - 1;
  if (current <= 0) sessionCounts.delete(userId);
  else sessionCounts.set(userId, current);
}

function setupSSHTerminal(io) {
  const nsp = io.of('/ssh');

  nsp.use(async (socket, next) => {
      const queryToken = config.security.allowQueryToken ? socket.handshake.query?.token : '';
      const token = socket.handshake.auth?.token || queryToken;
    if (!token) return next(new Error('未提供认证令牌'));
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      const user = await db.queryOne('SELECT id, username, role, status, token_version FROM users WHERE id = ?', [decoded.id]);
      if (!user || Number(user.status) !== 1 || Number(user.token_version || 0) !== Number(decoded.tokenVersion)) {
        return next(new Error('登录状态已失效，请重新登录'));
      }
      socket.user = {
        id: user.id,
        username: user.username,
        role: user.role,
        tokenVersion: user.token_version || 0
      };
      next();
    } catch (err) {
      next(new Error(err.name === 'TokenExpiredError' ? '令牌已过期，请重新登录' : '认证失败'));
    }
  });

  nsp.on('connection', (socket) => {
    let conn = null;
    let stream = null;

    // 会话槽位：open 时获取，closeSSH 时归还
    let slotHeld = false;
    // 流控：sentBytes 已发送给客户端的累计字节，ackedBytes 客户端回报的已接收字节
    let sentBytes = 0;
    let ackedBytes = 0;
    let paused = false;
    let pauseTimer = null;
    // 编码：autoEncoding 为探测结果，encodingOverride 为客户端手动指定
    let autoEncoding = 'utf-8';
    let encodingOverride = '';
    let sshEncoding = 'utf-8';
    let rawEncodingOutput = '';
    let twoFANoticeSent = false;
    // 会话录制（asciicast v2，只录输出）；rawMode 为 ZMODEM 传输时跳过编码转换
    let recorder = null;
    let rawMode = false;
    // ZRQINIT 帧头 "**\x18B0"：sz 发起方特征，GBK 转码会破坏二进制帧，须自动切 raw
    const ZRQINIT = Buffer.from([0x2a, 0x2a, 0x18, 0x42, 0x30]);

    function resumeStream() {
      clearTimeout(pauseTimer);
      pauseTimer = null;
      if (!paused) return;
      paused = false;
      try { if (stream) stream.resume(); } catch {}
    }

    function sendTerminalData(data) {
      if (!data || !data.length || !socket.connected) return;
      let payload = data;
      if (!rawMode && data.includes(ZRQINIT)) {
        rawMode = true;
        socket.emit('zmodem-start');
      }
      if (!rawMode && sshEncoding !== 'utf-8') {
        try { payload = Buffer.from(iconv.decode(data, sshEncoding), 'utf8'); } catch {}
      }
      // 录制发给前端的 UTF-8 文本，保证 asciicast 回放与用户所见一致
      if (recorder) recorder.write(payload);
      sentBytes += payload.length;
      socket.emit('data', payload);
      // 积压超过 4MB 时暂停读 SSH 流，等客户端 ack 回落再恢复，防止内存被大输出撑爆
      if (!paused && sentBytes - ackedBytes > config.ssh.maxDataFrameSize * 4) {
        paused = true;
        try { if (stream) stream.pause(); } catch {}
        // 兜底：客户端 ack 丢失时最多暂停 30s，避免终端永久卡死
        pauseTimer = setTimeout(resumeStream, 30000);
      }
    }

    async function closeSSH() {
      clearTimeout(pauseTimer);
      pauseTimer = null;
      paused = false;
      if (recorder) {
        try { recorder.close(); } catch {}
        recorder = null;
      }
      rawMode = false;
      try { if (stream) stream.close(); } catch {}
      try { if (conn) conn.end(); } catch {}
      stream = null;
      conn = null;
      if (slotHeld) {
        slotHeld = false;
        releaseSessionSlot(socket.user.id);
      }
    }

    socket.on('open', async (payload) => {
      // 新前端传 { serverId, cols, rows }，旧调用直接传 serverId
      const isObj = payload !== null && typeof payload === 'object';
      const serverId = isObj ? payload.serverId : payload;
      const clampSize = (v, def, min, max) => {
        v = Math.round(Number(v));
        return Number.isFinite(v) ? Math.min(Math.max(v, min), max) : def;
      };
      const cols = clampSize(isObj ? payload.cols : 0, 120, 2, 500);
      const rows = clampSize(isObj ? payload.rows : 0, 32, 2, 200);

      let connectionDetail = '';
      try {
        await closeSSH();
        const server = await db.queryOne('SELECT * FROM servers WHERE id = ?', [serverId]);
        if (!server) {
          socket.emit('error', '服务器不存在');
          return;
        }
        if (!slotHeld) {
          if (!acquireSessionSlot(socket.user.id)) {
            socket.emit('error', `并发终端会话数已达上限（${config.ssh.maxSessionsPerUser}），请先关闭部分会话`);
            return;
          }
          slotHeld = true;
        }

        const connectConfig = normalizeSSHConfig(server);
        connectionDetail = describeConnectionTarget(server, connectConfig);

        // Host key TOFU：首次连接记录指纹（SHA-256 hex），之后每次连接校验，
        // 指纹变化说明服务器重装/更换或存在中间人，拒绝并提示重置
        const storedFp = String(server.host_key_fingerprint || '').trim();
        let capturedFp = null;
        connectConfig.hostHash = 'sha256';
        if (storedFp) {
          connectConfig.hostVerifier = (keyHash) => keyHash === storedFp;
        } else {
          connectConfig.hostVerifier = (keyHash) => { capturedFp = keyHash; return true; };
        }

        conn = new Client();

        conn.on('ready', async () => {
          if (capturedFp) {
            db.update('UPDATE servers SET host_key_fingerprint = ? WHERE id = ? AND host_key_fingerprint IS NULL', [capturedFp, server.id]).catch(() => {});
          }
          try {
            await writeAuditLog({
              userId: socket.user.id,
              username: socket.user.username,
              action: 'open_terminal',
              targetType: 'server',
              targetId: server.id,
              serverId: server.id,
              status: 'success'
            });
          } catch {}

          conn.shell({ term: 'xterm-256color', cols, rows }, (err, s) => {
            if (err) {
              socket.emit('error', err.message);
              return;
            }
            stream = s;
            stream.on('data', sendTerminalData);
            stream.on('close', () => {
              socket.emit('closed');
              closeSSH();
            });
            socket.emit('connected');
            // 会话录制开关：每次 open 时读设置（改动即时生效），失败视为关闭
            getSettingValue('term_record_enabled', 'false').then(enabled => {
              if (enabled !== 'true' || !socket.connected) return;
              recorder = createRecorder({
                userId: socket.user.id,
                username: socket.user.username,
                serverId: server.id,
                serverName: server.name,
                host: server.host,
                cols,
                rows
              });
              if (recorder) socket.emit('recording', { enabled: true });
            }).catch(() => {});
            // shell 建立后探测服务器编码，客户端据此显示与切换
            detectEncoding(conn, (enc, raw) => {
              autoEncoding = enc;
              rawEncodingOutput = raw;
              sshEncoding = encodingOverride || enc;
              socket.emit('encoding', { encoding: sshEncoding, auto: enc, raw });
            });
          });
        });

        conn.on('keyboard-interactive', (name, instructions, lang, prompts, finishAuth) => {
          const password = connectConfig.password || '';
          // 单个 prompt（通常是 Password:）用保存的密码应答；多个 prompt 说明服务器
          // 启用了 2FA/MFA（如动态验证码），静态凭据无法应答，直接失败避免把密码填进验证码框。
          if (prompts.length === 1 && password) {
            finishAuth([password]);
            return;
          }
          finishAuth(prompts.map(() => ''));
          twoFANoticeSent = true;
          socket.emit('error', '目标服务器启用了交互式二次验证（2FA/MFA），暂不支持自动登录');
          try { conn.end(); } catch {}
        });

        conn.on('error', async (err) => {
          const message = formatSSHError(err);
          try {
            await writeAuditLog({
              userId: socket.user.id,
              username: socket.user.username,
              action: 'open_terminal',
              targetType: 'server',
              targetId: server.id,
              serverId: server.id,
              status: 'failed',
              errorMessage: message
            });
          } catch {}
          if (!twoFANoticeSent) {
            socket.emit('error', `${message}（${connectionDetail}）`);
          }
        });

        conn.connect(connectConfig);
      } catch (err) {
        const message = formatSSHError(err);
        socket.emit('error', connectionDetail ? `${message}（${connectionDetail}）` : message);
      }
    });

    // 兼容旧前端，但新前端使用 open 事件，避免和 socket.io connect 事件混淆。
    socket.on('ssh-connect', (serverId) => socket.emit('error', '请刷新页面后重新打开终端'));

    socket.on('data', (raw) => {
      if (!stream) return;
      let buf;
      if (Buffer.isBuffer(raw)) buf = raw;
      else if (typeof raw === 'string') buf = Buffer.from(raw, 'utf8');
      else if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) buf = Buffer.from(raw);
      else return;
      if (!buf.length || buf.length > config.ssh.maxDataFrameSize) return;
      let out = buf;
      if (sshEncoding !== 'utf-8') {
        // 客户端输入是 UTF-8 字节，转成目标服务器编码
        try { out = iconv.encode(buf.toString('utf8'), sshEncoding); } catch {}
      }
      try { stream.write(out); } catch {}
    });

    // 客户端流控回报：收到的累计字节数
    socket.on('ack', (n) => {
      const received = Number(n);
      if (!Number.isFinite(received) || received < 0) return;
      ackedBytes = received;
      if (paused && sentBytes - ackedBytes < config.ssh.maxDataFrameSize) {
        resumeStream();
      }
    });

    // 手动切换编码：'auto' 回到探测值，其余必须在白名单内
    socket.on('set-encoding', (val) => {
      const v = String(val || '').toLowerCase();
      if (v === 'auto') {
        encodingOverride = '';
        sshEncoding = autoEncoding;
      } else if (SUPPORTED_ENCODINGS.includes(v)) {
        encodingOverride = v;
        sshEncoding = v;
      } else {
        return;
      }
      socket.emit('encoding', { encoding: sshEncoding, auto: autoEncoding, raw: rawEncodingOutput });
    });

    socket.on('resize', ({ cols, rows }) => {
      if (stream && cols && rows) stream.setWindow(rows, cols);
    });

    // ZMODEM 传输期间跳过编码转换（二进制帧不可转码），由前端在传输开始/结束时切换
    socket.on('set-raw', (flag) => { rawMode = !!flag; });

    socket.on('close', () => closeSSH());
    socket.on('disconnect', () => closeSSH());
  });
}

module.exports = { setupSSHTerminal };
