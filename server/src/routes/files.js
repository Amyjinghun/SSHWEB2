const express = require('express');
const multer = require('multer');
const pathModule = require('path');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { createSSHConnection } = require('../ssh/connection');
const { writeAuditLog } = require('../utils/audit');

const router = express.Router();
router.use(authMiddleware);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const MAX_READ_SIZE = 5 * 1024 * 1024;

function normalizeRemotePath(input, fallback = '/') {
  let p = String(input || fallback).trim();
  if (!p) p = fallback;
  p = p.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!p.startsWith('/')) p = '/' + p;
  return pathModule.posix.normalize(p);
}

function joinRemotePath(base, name) {
  const safeBase = normalizeRemotePath(base || '/');
  return pathModule.posix.join(safeBase, name);
}

function statToFile(name, fullPath, stat) {
  return {
    name,
    path: fullPath,
    permissions: typeof stat.mode === 'number' ? '0' + (stat.mode & 0o777).toString(8) : '',
    isDir: stat.isDirectory(),
    isFile: stat.isFile(),
    isSymbolicLink: stat.isSymbolicLink ? stat.isSymbolicLink() : false,
    size: stat.size || 0,
    owner: stat.uid != null ? String(stat.uid) : '',
    group: stat.gid != null ? String(stat.gid) : '',
    modifyTime: stat.mtime ? new Date(stat.mtime * 1000).toLocaleString('zh-CN', { hour12: false }) : ''
  };
}

function getSftp(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => err ? reject(err) : resolve(sftp));
  });
}

function sftpStat(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (err, stat) => err ? reject(err) : resolve(stat));
  });
}

function sftpReaddir(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (err, list) => err ? reject(err) : resolve(list));
  });
}

function sftpReadFile(sftp, remotePath, maxSize = MAX_READ_SIZE) {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (err, stat) => {
      if (err) return reject(err);
      if (stat.isDirectory()) return reject(new Error('这是目录，不能直接查看内容'));
      if ((stat.size || 0) > maxSize) return reject(new Error(`文件过大，当前在线查看限制为 ${Math.round(maxSize / 1024 / 1024)}MB，请使用下载功能`));
      const chunks = [];
      const stream = sftp.createReadStream(remotePath, { encoding: 'utf8' });
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(chunks.join('')));
    });
  });
}

function sftpWriteFile(sftp, remotePath, content) {
  return new Promise((resolve, reject) => {
    const stream = sftp.createWriteStream(remotePath);
    stream.on('close', resolve);
    stream.on('error', reject);
    stream.end(Buffer.from(content || '', 'utf8'));
  });
}

function sftpUnlink(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.unlink(remotePath, err => err ? reject(err) : resolve());
  });
}

function sftpRmdir(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.rmdir(remotePath, err => err ? reject(err) : resolve());
  });
}


async function removeRemoteRecursive(sftp, remotePath) {
  const stat = await sftpStat(sftp, remotePath);
  if (!stat.isDirectory()) {
    await sftpUnlink(sftp, remotePath);
    return;
  }

  const items = await sftpReaddir(sftp, remotePath);
  for (const item of items) {
    if (!item || item.filename === '.' || item.filename === '..') continue;
    const childPath = pathModule.posix.join(remotePath, item.filename);
    await removeRemoteRecursive(sftp, childPath);
  }
  await sftpRmdir(sftp, remotePath);
}

function execCmd(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      let stderr = '';
      stream.on('data', d => out += d.toString());
      stream.stderr.on('data', d => stderr += d.toString());
      stream.on('close', code => resolve({ out, stderr, code }));
    });
  });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function getServerById(serverId) {
  if (!serverId) throw new Error('请提供 server_id');
  const server = await db.queryOne('SELECT * FROM servers WHERE id = ?', [serverId]);
  if (!server) throw new Error('服务器不存在');
  return server;
}

async function withSftp(serverId, handler) {
  const server = await getServerById(serverId);
  const conn = await createSSHConnection(server);
  try {
    const sftp = await getSftp(conn);
    return await handler({ conn, sftp, server });
  } finally {
    conn.end();
  }
}

router.get('/list', async (req, res) => {
  try {
    const { server_id } = req.query;
    const requestedPath = normalizeRemotePath(req.query.path || '/');
    const data = await withSftp(server_id, async ({ sftp }) => {
      const stat = await sftpStat(sftp, requestedPath);
      if (stat.isFile()) {
        return {
          path: requestedPath,
          parentPath: pathModule.posix.dirname(requestedPath),
          type: 'file',
          file: statToFile(pathModule.posix.basename(requestedPath), requestedPath, stat),
          files: []
        };
      }
      if (!stat.isDirectory()) {
        return {
          path: requestedPath,
          parentPath: pathModule.posix.dirname(requestedPath),
          type: 'other',
          file: statToFile(pathModule.posix.basename(requestedPath), requestedPath, stat),
          files: []
        };
      }
      const list = await sftpReaddir(sftp, requestedPath);
      const files = list
        .filter(item => item.filename !== '.' && item.filename !== '..')
        .map(item => statToFile(item.filename, joinRemotePath(requestedPath, item.filename), item.attrs))
        .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, 'zh-CN'));
      return {
        path: requestedPath,
        parentPath: requestedPath === '/' ? '/' : pathModule.posix.dirname(requestedPath),
        type: 'directory',
        files
      };
    });
    res.json({ code: 0, data });
  } catch (err) {
    const message = err.code === 3 ? '权限不足，当前 SSH 用户无法访问该路径' : err.message;
    res.json({ code: 500, message });
  }
});

router.get('/read', async (req, res) => {
  try {
    const { server_id } = req.query;
    const remotePath = normalizeRemotePath(req.query.filepath);
    const content = await withSftp(server_id, async ({ sftp }) => sftpReadFile(sftp, remotePath));
    res.json({ code: 0, data: { content, path: remotePath } });
  } catch (err) {
    const message = err.code === 3 ? '权限不足，当前 SSH 用户无法读取该文件' : err.message;
    res.json({ code: 500, message });
  }
});

router.post('/write', async (req, res) => {
  try {
    const { server_id, path, content } = req.body;
    if (!server_id || !path) return res.json({ code: 400, message: '参数不完整' });
    const remotePath = normalizeRemotePath(path);
    await withSftp(server_id, async ({ conn, sftp }) => {
      // 保存前尽量备份一份；备份失败不阻塞保存，例如新建文件不存在时。
      await execCmd(conn, `test -f ${shellQuote(remotePath)} && cp ${shellQuote(remotePath)} ${shellQuote(remotePath + '.bak.' + new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14))} || true`);
      await sftpWriteFile(sftp, remotePath, content || '');
    });
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'edit_file', serverId: server_id, detail: { path: remotePath } });
    res.json({ code: 0, message: '文件已保存' });
  } catch (err) {
    const message = err.code === 3 ? '权限不足，当前 SSH 用户无法写入该文件' : err.message;
    res.json({ code: 500, message });
  }
});

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { server_id, path } = req.body;
    if (!server_id || !path || !req.file) return res.json({ code: 400, message: '参数不完整' });
    const remotePath = normalizeRemotePath(path);
    await withSftp(server_id, async ({ sftp }) => {
      await new Promise((resolve, reject) => {
        const stream = sftp.createWriteStream(remotePath);
        stream.on('close', resolve);
        stream.on('error', reject);
        stream.end(req.file.buffer);
      });
    });
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'upload_file', serverId: server_id, detail: { path: remotePath, size: req.file.size } });
    res.json({ code: 0, message: '上传成功' });
  } catch (err) {
    const message = err.code === 3 ? '权限不足，当前 SSH 用户无法上传到该路径' : err.message;
    res.json({ code: 500, message });
  }
});

router.get('/download', async (req, res) => {
  let conn;
  try {
    const { server_id, filepath } = req.query;
    if (!server_id || !filepath) return res.json({ code: 400, message: '参数不完整' });
    const remotePath = normalizeRemotePath(filepath);
    const server = await getServerById(server_id);
    conn = await createSSHConnection(server);
    const sftp = await getSftp(conn);
    const stat = await sftpStat(sftp, remotePath);
    if (stat.isDirectory()) throw new Error('目录不能直接下载，请选择具体文件');
    const filename = encodeURIComponent(pathModule.posix.basename(remotePath));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Length', stat.size || 0);
    const stream = sftp.createReadStream(remotePath);
    stream.pipe(res);
    stream.on('close', async () => {
      conn.end();
      await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'download_file', serverId: server_id, detail: { path: remotePath } });
    });
    stream.on('error', err => {
      if (!res.headersSent) res.json({ code: 500, message: err.message });
      conn.end();
    });
  } catch (err) {
    if (conn) conn.end();
    const message = err.code === 3 ? '权限不足，当前 SSH 用户无法下载该文件' : err.message;
    if (!res.headersSent) res.json({ code: 500, message });
  }
});

router.delete('/delete', async (req, res) => {
  try {
    const { server_id, path } = req.body;
    if (!server_id || !path) return res.json({ code: 400, message: '参数不完整' });
    const remotePath = normalizeRemotePath(path);
    if (remotePath === '/') return res.json({ code: 400, message: '禁止删除根目录' });
    await withSftp(server_id, async ({ sftp }) => {
      await removeRemoteRecursive(sftp, remotePath);
    });
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'delete_file', serverId: server_id, detail: { path: remotePath } });
    res.json({ code: 0, message: '已删除' });
  } catch (err) {
    const message = err.code === 3 ? '权限不足，当前 SSH 用户无法删除该路径' : err.message;
    res.json({ code: 500, message });
  }
});

router.post('/mkdir', async (req, res) => {
  try {
    const { server_id, path } = req.body;
    const remotePath = normalizeRemotePath(path);
    await withSftp(server_id, async ({ sftp }) => {
      await new Promise((resolve, reject) => sftp.mkdir(remotePath, err => err ? reject(err) : resolve()));
    });
    res.json({ code: 0, message: '目录已创建' });
  } catch (err) {
    const message = err.code === 3 ? '权限不足，当前 SSH 用户无法创建目录' : err.message;
    res.json({ code: 500, message });
  }
});

router.post('/rename', async (req, res) => {
  try {
    const { server_id, old_path, new_path } = req.body;
    const oldRemotePath = normalizeRemotePath(old_path);
    const newRemotePath = normalizeRemotePath(new_path);
    await withSftp(server_id, async ({ sftp }) => {
      await new Promise((resolve, reject) => sftp.rename(oldRemotePath, newRemotePath, err => err ? reject(err) : resolve()));
    });
    res.json({ code: 0, message: '重命名成功' });
  } catch (err) {
    const message = err.code === 3 ? '权限不足，当前 SSH 用户无法重命名该路径' : err.message;
    res.json({ code: 500, message });
  }
});

router.post('/chmod', async (req, res) => {
  try {
    const { server_id, path, mode } = req.body;
    const remotePath = normalizeRemotePath(path);
    if (!/^0?[0-7]{3,4}$/.test(String(mode || ''))) return res.json({ code: 400, message: '权限格式不正确，例如 644 或 755' });
    await withSftp(server_id, async ({ sftp }) => {
      await new Promise((resolve, reject) => sftp.chmod(remotePath, parseInt(String(mode), 8), err => err ? reject(err) : resolve()));
    });
    res.json({ code: 0, message: '权限已修改' });
  } catch (err) {
    const message = err.code === 3 ? '权限不足，当前 SSH 用户无法修改权限' : err.message;
    res.json({ code: 500, message });
  }
});

module.exports = router;
