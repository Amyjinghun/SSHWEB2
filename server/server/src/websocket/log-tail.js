const { Client } = require('ssh2');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { normalizeSSHConfig, formatSSHError } = require('../ssh/connection');
const db = require('../db');

function setupLogTail(io) {
  const nsp = io.of('/log-tail');

  nsp.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('未提供认证令牌'));
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      const user = await db.queryOne('SELECT id, username, role, status, token_version FROM users WHERE id = ?', [decoded.id]);
      if (!user || Number(user.status) !== 1 || Number(user.token_version || 0) !== Number(decoded.tokenVersion)) {
        return next(new Error('登录状态已失效'));
      }
      socket.user = { id: user.id, username: user.username };
      next();
    } catch (err) {
      next(new Error('认证失败'));
    }
  });

  nsp.on('connection', (socket) => {
    let conn = null;
    let stream = null;

    function closeAll() {
      try { if (stream) { stream.close(); } } catch {}
      try { if (conn) conn.end(); } catch {}
      stream = null;
      conn = null;
    }

    socket.on('open', async ({ serverId, path }) => {
      try {
        closeAll();
        if (!serverId || !path) return socket.emit('error', '参数不完整');
        const server = await db.queryOne('SELECT * FROM servers WHERE id = ?', [serverId]);
        if (!server) return socket.emit('error', '服务器不存在');

        const safePath = String(path).replace(/[`$\\;"|&<>(){}!#*?]/g, '\\$&');
        const connectConfig = normalizeSSHConfig(server);
        conn = new Client();

        conn.on('ready', () => {
          conn.exec(`tail -n 100 -f "${safePath}"`, (err, s) => {
            if (err) return socket.emit('error', err.message);
            stream = s;
            stream.on('data', (data) => socket.emit('data', data.toString('base64')));
            stream.stderr.on('data', (data) => socket.emit('data', data.toString('base64')));
            stream.on('close', () => { socket.emit('closed'); closeAll(); });
            socket.emit('connected');
          });
        });

        conn.on('keyboard-interactive', (name, instructions, lang, prompts, finishAuth) => {
          finishAuth(prompts.map(() => connectConfig.password || ''));
        });

        conn.on('error', (err) => socket.emit('error', formatSSHError(err)));
        conn.connect(connectConfig);
      } catch (err) {
        socket.emit('error', err.message);
      }
    });

    socket.on('close', closeAll);
    socket.on('disconnect', closeAll);
  });
}

module.exports = { setupLogTail };
