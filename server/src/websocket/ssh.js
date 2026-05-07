const { Client } = require('ssh2');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { normalizeSSHConfig, formatSSHError } = require('../ssh/connection');
const { writeAuditLog } = require('../utils/audit');
const db = require('../db');

function setupSSHTerminal(io) {
  const nsp = io.of('/ssh');

  nsp.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
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

    async function closeSSH() {
      try { if (stream) stream.close(); } catch {}
      try { if (conn) conn.end(); } catch {}
      stream = null;
      conn = null;
    }

    socket.on('open', async (serverId) => {
      try {
        await closeSSH();
        const server = await db.queryOne('SELECT * FROM servers WHERE id = ?', [serverId]);
        if (!server) {
          socket.emit('error', '服务器不存在');
          return;
        }

        const connectConfig = normalizeSSHConfig(server);
        conn = new Client();

        conn.on('ready', async () => {
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

          conn.shell({ term: 'xterm-256color', cols: 120, rows: 32 }, (err, s) => {
            if (err) {
              socket.emit('error', err.message);
              return;
            }
            stream = s;
            stream.on('data', (data) => socket.emit('data', data.toString('base64')));
            stream.stderr.on('data', (data) => socket.emit('data', data.toString('base64')));
            stream.on('close', () => {
              socket.emit('closed');
              closeSSH();
            });
            socket.emit('connected');
          });
        });

        conn.on('keyboard-interactive', (name, instructions, lang, prompts, finishAuth) => {
          const password = connectConfig.password || '';
          finishAuth(prompts.map(() => password));
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
          socket.emit('error', message);
        });

        conn.connect(connectConfig);
      } catch (err) {
        socket.emit('error', formatSSHError(err));
      }
    });

    // 兼容旧前端，但新前端使用 open 事件，避免和 socket.io connect 事件混淆。
    socket.on('ssh-connect', (serverId) => socket.emit('error', '请刷新页面后重新打开终端'));

    socket.on('data', (data) => {
      if (stream) stream.write(Buffer.from(data, 'base64'));
    });

    socket.on('resize', ({ cols, rows }) => {
      if (stream && cols && rows) stream.setWindow(rows, cols);
    });

    socket.on('close', () => closeSSH());
    socket.on('disconnect', () => closeSSH());
  });
}

module.exports = { setupSSHTerminal };
