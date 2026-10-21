const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 终端会话录制：asciicast v2 格式（https://docs.asciinema.org/manual/asciicast/v2/）
// 只录服务端下发给前端的输出流，不录用户输入——输入里可能包含密码等敏感信息。
// storageRoot 配置为 dataDir 时落盘到 <dataDir>/termlogs/<yyyy-mm>/<id>.cast
const DATA_DIR = process.env.SSHWEB_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const TERMLOG_DIR = path.join(DATA_DIR, 'termlogs');

// id → 元信息，供列表页展示"正在录制"状态
const activeSessions = new Map();

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function createRecorder({ userId, username, serverId, serverName, host, cols, rows }) {
  const id = `${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
  const monthDir = path.join(TERMLOG_DIR, new Date().toISOString().slice(0, 7));
  try { ensureDir(monthDir); } catch (err) { return null; }

  const file = path.join(monthDir, `${id}.cast`);
  let stream;
  try { stream = fs.createWriteStream(file, { flags: 'wx' }); } catch { return null; }

  const header = {
    version: 2,
    width: cols || 120,
    height: rows || 32,
    timestamp: Math.floor(Date.now() / 1000),
    env: { TERM: 'xterm-256color' },
    sshweb: { id, userId, username, serverId, serverName: serverName || '', host: host || '' }
  };
  stream.write(`${JSON.stringify(header)}\n`);

  const startedAt = Date.now();
  // asciicast 用单调时钟；回放只需相对间隔，精度 1ms 足够
  const mono = (Date.now() - startedAt) / 1000;
  const rec = {
    id, file, userId, username, serverId, serverName: serverName || '', host: host || '',
    startedAt, bytes: 0, closed: false,
    write(data) {
      if (rec.closed || !data || !data.length) return;
      try {
        const t = (Date.now() - startedAt) / 1000;
        rec.bytes += data.length;
        stream.write(`[${t.toFixed(6)}, "o", ${JSON.stringify(data.toString('utf8'))}]\n`);
      } catch {}
    },
    close() {
      if (rec.closed) return Promise.resolve();
      rec.closed = true;
      activeSessions.delete(id);
      return new Promise((resolve) => {
        try { stream.end(resolve); } catch { resolve(); }
      });
    }
  };
  activeSessions.set(id, rec);
  return rec;
}

// 读取某 .cast 文件的头部元信息（首行 JSON）
function readHeader(file) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file, { encoding: 'utf8', end: 8192 });
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      const idx = buf.indexOf('\n');
      if (idx !== -1) {
        stream.destroy();
        try { resolve(JSON.parse(buf.slice(0, idx))); } catch (err) { reject(err); }
      }
    });
    stream.on('close', () => reject(new Error('头部不完整')));
    stream.on('error', reject);
  });
}

async function listRecordings() {
  ensureDir(TERMLOG_DIR);
  const months = fs.readdirSync(TERMLOG_DIR).filter(name => /^\d{4}-\d{2}$/.test(name)).sort().reverse();  const items = [];
  for (const month of months) {
    const dir = path.join(TERMLOG_DIR, month);
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.cast')) continue;
      const file = path.join(dir, name);
      try {
        const stat = fs.statSync(file);
        const header = await readHeader(file);
        const meta = header.sshweb || {};
        items.push({
          id: name.replace(/\.cast$/, ''),
          file,
          size: stat.size,
          startedAt: header.timestamp ? header.timestamp * 1000 : stat.birthtimeMs,
          userId: meta.userId ?? null,
          username: meta.username || '未知',
          serverId: meta.serverId ?? null,
          serverName: meta.serverName || '',
          host: meta.host || '',
          width: header.width || 120,
          height: header.height || 32,
          active: activeSessions.has(name.replace(/\.cast$/, ''))
        });
      } catch {}
    }
  }
  items.sort((a, b) => b.startedAt - a.startedAt);
  return items;
}

async function readRecording(id) {
  if (!/^[a-z0-9_]+$/.test(id)) throw new Error('非法 ID');
  if (!fs.existsSync(TERMLOG_DIR)) return null;
  const months = fs.readdirSync(TERMLOG_DIR).filter(name => /^\d{4}-\d{2}$/.test(name));
  for (const month of months) {
    const file = path.join(TERMLOG_DIR, month, `${id}.cast`);
    if (fs.existsSync(file)) return { file, header: await readHeader(file) };
  }
  return null;
}

async function deleteRecording(id) {
  const found = await readRecording(id);
  if (!found) return false;
  fs.unlinkSync(found.file);
  return true;
}

async function cleanupRecordings(retentionDays) {
  const days = Math.max(parseInt(retentionDays, 10) || 30, 1);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  ensureDir(TERMLOG_DIR);
  const months = fs.readdirSync(TERMLOG_DIR).filter(name => /^\d{4}-\d{2}$/.test(name));
  let removed = 0;
  for (const month of months) {
    const dir = path.join(TERMLOG_DIR, month);
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.cast')) continue;
      const file = path.join(dir, name);
      try {
        const stat = fs.statSync(file);
        if (stat.mtimeMs < cutoff && !activeSessions.has(name.replace(/\.cast$/, ''))) {
          fs.unlinkSync(file);
          removed++;
        }
      } catch {}
    }
    // 目录空了顺手清掉
    try { if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir); } catch {}
  }
  return removed;
}

module.exports = { createRecorder, activeSessions, listRecordings, readRecording, deleteRecording, cleanupRecordings, TERMLOG_DIR };
