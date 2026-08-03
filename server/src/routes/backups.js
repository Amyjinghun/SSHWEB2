const express = require('express');
const fs = require('fs');
const zlib = require('zlib');
const { spawn } = require('child_process');
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { createSSHConnection, execCommand, shellQuote } = require('../ssh/connection');
const { encrypt, decrypt } = require('../utils/crypto');
const { writeAuditLog } = require('../utils/audit');

const router = express.Router();
router.use(authMiddleware);


function runLocalMysqlDump(config, dbPass, filePath) {
  return new Promise(async (resolve, reject) => {
    try {
      await fs.promises.mkdir(config.backup_dir, { recursive: true });
    } catch (err) {
      return reject(err);
    }

    const args = [
      `-h${config.db_host}`,
      `-P${Number(config.db_port) || 3306}`,
      `-u${config.db_username}`,
      String(config.db_name)
    ];
    const env = { ...process.env };
    if (dbPass) env.MYSQL_PWD = dbPass;

    const dump = spawn('mysqldump', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const gzip = zlib.createGzip();
    const out = fs.createWriteStream(filePath, { flags: 'w' });
    let stderr = '';
    let settled = false;

    const done = (err) => {
      if (settled) return;
      settled = true;
      try { dump.kill(); } catch {}
      if (err) return reject(err);
      fs.promises.stat(filePath).then(stat => resolve(stat.size || 0)).catch(reject);
    };

    dump.stderr.on('data', chunk => { stderr += chunk.toString(); });
    dump.on('error', done);
    gzip.on('error', done);
    out.on('error', done);
    dump.on('close', code => {
      if (code !== 0) done(new Error(`mysqldump 失败: ${stderr || `退出码 ${code}`}`));
    });
    out.on('close', () => done());

    dump.stdout.pipe(gzip).pipe(out);
  });
}


// ===== 数据库备份配置 =====
router.get('/db/configs', async (req, res) => {
  try {
    const configs = await db.query('SELECT dbc.*, s.name as server_name FROM db_backup_configs dbc LEFT JOIN servers s ON dbc.server_id = s.id ORDER BY dbc.id DESC');
    configs.forEach(c => { c.db_password = c.db_password_encrypted ? '******' : ''; delete c.db_password_encrypted; });
    res.json({ code: 0, data: configs });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

router.post('/db/configs', async (req, res) => {
  try {
    const { name, server_id, db_type, db_host, db_port, db_username, db_password, db_name, backup_dir, retention_count, enabled, remark } = req.body;
    if (!name || !db_name) return res.json({ code: 400, message: '名称和数据库名为必填项' });
    const id = await db.insert('INSERT INTO db_backup_configs (name, server_id, db_type, db_host, db_port, db_username, db_password_encrypted, db_name, backup_dir, retention_count, enabled, remark) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [name, server_id || null, db_type || 'mysql', db_host || 'localhost', db_port || 3306, db_username || 'root', db_password ? encrypt(db_password) : null, db_name, backup_dir || '/tmp/backups', retention_count || 7, enabled ?? 1, remark || null]);
    res.json({ code: 0, message: '备份配置创建成功', data: { id } });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

router.put('/db/configs/:id', async (req, res) => {
  try {
    const fields = []; const params = [];
    const add = (col, val) => { if (val !== undefined) { fields.push(`${col}=?`); params.push(val); } };
    const { name, db_type, db_host, db_port, db_username, db_password, db_name, backup_dir, retention_count, enabled, remark } = req.body;
    add('name', name); add('db_type', db_type); add('db_host', db_host); add('db_port', db_port);
    add('db_username', db_username); add('db_name', db_name); add('backup_dir', backup_dir);
    add('retention_count', retention_count); add('enabled', enabled); add('remark', remark);
    if (db_password !== undefined) { fields.push('db_password_encrypted=?'); params.push(db_password ? encrypt(db_password) : null); }
    params.push(req.params.id);
    await db.update(`UPDATE db_backup_configs SET ${fields.join(',')} WHERE id=?`, params);
    res.json({ code: 0, message: '更新成功' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

router.delete('/db/configs/:id', async (req, res) => {
  try {
    await db.remove('DELETE FROM db_backup_configs WHERE id=?', [req.params.id]);
    res.json({ code: 0, message: '已删除' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

router.post('/db/configs/:id/run', async (req, res) => {
  try {
    const config = await db.queryOne('SELECT * FROM db_backup_configs WHERE id=?', [req.params.id]);
    if (!config) return res.json({ code: 404, message: '配置不存在' });
    const dbPass = config.db_password_encrypted ? decrypt(config.db_password_encrypted) : '';
    const safeDbName = String(config.db_name || 'database').replace(/[^a-zA-Z0-9_.-]/g, '_') || 'database';
    const fileName = `${safeDbName}_${new Date().toISOString().replace(/[:.]/g, '-')}.sql.gz`;
    const filePath = `${String(config.backup_dir || '/tmp/backups').replace(/\/$/, '')}/${fileName}`;
    const dumpCmd = [
      `mkdir -p ${shellQuote(config.backup_dir || '/tmp/backups')}`,
      [
        'MYSQL_PWD=' + shellQuote(dbPass || ''),
        'mysqldump',
        '-h' + shellQuote(config.db_host || 'localhost'),
        '-P' + shellQuote(String(Number(config.db_port) || 3306)),
        '-u' + shellQuote(config.db_username || 'root'),
        shellQuote(config.db_name),
        '| gzip > ' + shellQuote(filePath) + ' 2>&1'
      ].join(' '),
      `stat -c %s ${shellQuote(filePath)}`
    ].join(' && ');

    if (config.server_id) {
      const server = await db.queryOne('SELECT * FROM servers WHERE id=?', [config.server_id]);
      const conn = await createSSHConnection(server);
      const { out, exitCode } = await execCommand(conn, dumpCmd);
      conn.end();
      if (exitCode !== 0) return res.json({ code: 500, message: '备份失败: ' + out });
      const fileSize = parseInt(out.trim());
      await db.insert('INSERT INTO backup_files (config_id, server_id, backup_type, file_name, file_path, file_size, status) VALUES (?,?,?,?,?,?,?)', [config.id, config.server_id, 'database', fileName, filePath, fileSize || 0, 'success']);
    } else {
      const fileSize = await runLocalMysqlDump(config, dbPass, filePath);
      await db.insert('INSERT INTO backup_files (config_id, backup_type, file_name, file_path, file_size, status) VALUES (?,?,?,?,?,?)', [config.id, 'database', fileName, filePath, fileSize || 0, 'success']);
    }
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'db_backup', detail: { db: config.db_name } });
    res.json({ code: 0, message: '备份成功' });
  } catch (err) {
    await db.insert('INSERT INTO backup_files (config_id, server_id, backup_type, file_name, file_path, status, error_message) VALUES (?,?,?,?,?,?,?)', [req.params.id, null, 'database', 'failed', '', 'failed', err.message]);
    res.json({ code: 500, message: err.message });
  }
});

// ===== 备份文件列表 =====
router.get('/files', async (req, res) => {
  try {
    const { backup_type, config_id } = req.query;
    let sql = 'SELECT bf.*, s.name as server_name FROM backup_files bf LEFT JOIN servers s ON bf.server_id = s.id WHERE 1=1';
    const params = [];
    if (backup_type) { sql += ' AND bf.backup_type=?'; params.push(backup_type); }
    if (config_id) { sql += ' AND bf.config_id=?'; params.push(config_id); }
    sql += ' ORDER BY bf.id DESC LIMIT 100';
    const files = await db.query(sql, params);
    res.json({ code: 0, data: files });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

router.delete('/files/:id', async (req, res) => {
  try {
    await db.remove('DELETE FROM backup_files WHERE id=?', [req.params.id]);
    res.json({ code: 0, message: '已删除' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

// ===== 配置备份 =====
router.get('/config/tasks', async (req, res) => {
  try {
    const tasks = await db.query('SELECT cbt.*, s.name as server_name FROM config_backup_tasks cbt LEFT JOIN servers s ON cbt.server_id = s.id ORDER BY cbt.id DESC');
    res.json({ code: 0, data: tasks });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

router.post('/config/tasks', async (req, res) => {
  try {
    const { name, server_id, paths, backup_dir, cron_expr, retention_count, enabled, remark } = req.body;
    if (!name || !server_id || !paths?.length) return res.json({ code: 400, message: '参数不完整' });
    const id = await db.insert('INSERT INTO config_backup_tasks (name, server_id, paths, backup_dir, cron_expr, retention_count, enabled, remark) VALUES (?,?,?,?,?,?,?,?)',
      [name, server_id, JSON.stringify(paths), backup_dir || '/tmp/config-backups', cron_expr || null, retention_count || 10, enabled ?? 1, remark || null]);
    res.json({ code: 0, message: '配置备份任务创建成功', data: { id } });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});


router.put('/config/tasks/:id', async (req, res) => {
  try {
    const fields = []; const params = [];
    const add = (col, val) => { if (val !== undefined) { fields.push(`${col}=?`); params.push(val); } };
    const { name, server_id, paths, backup_dir, cron_expr, retention_count, enabled, remark } = req.body;
    add('name', name);
    add('server_id', server_id || null);
    if (paths !== undefined) { fields.push('paths=?'); params.push(JSON.stringify(paths || [])); }
    add('backup_dir', backup_dir);
    add('cron_expr', cron_expr || null);
    add('retention_count', retention_count);
    add('enabled', enabled);
    add('remark', remark);
    if (!fields.length) return res.json({ code: 400, message: '没有需要更新的字段' });
    params.push(req.params.id);
    await db.update(`UPDATE config_backup_tasks SET ${fields.join(',')} WHERE id=?`, params);
    res.json({ code: 0, message: '更新成功' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

router.post('/config/tasks/:id/run', async (req, res) => {
  try {
    const row = await db.queryOne(`SELECT cbt.id AS task_id, cbt.name AS task_name, cbt.paths, cbt.backup_dir, cbt.retention_count, cbt.server_id,
      s.id, s.name, s.host, s.port, s.username, s.auth_type, s.password_encrypted, s.private_key_encrypted, s.private_key_passphrase_encrypted
      FROM config_backup_tasks cbt JOIN servers s ON cbt.server_id = s.id WHERE cbt.id=?`, [req.params.id]);
    if (!row) return res.json({ code: 404, message: '任务不存在' });
    const task = row;
    const conn = await createSSHConnection(row);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeTaskName = String(task.task_name || 'config').replace(/[^a-zA-Z0-9_.-]/g, '_') || 'config';
    const fileName = `config_${safeTaskName}_${timestamp}.tar.gz`;
    const filePath = `${String(task.backup_dir || '/tmp/config-backups').replace(/\/$/, '')}/${fileName}`;
    const backupPaths = JSON.parse(task.paths || '[]');
    if (!Array.isArray(backupPaths) || backupPaths.length === 0) return res.json({ code: 400, message: '备份路径为空' });
    const paths = backupPaths.map(p => shellQuote(String(p))).join(' ');
    const cmd = `mkdir -p ${shellQuote(task.backup_dir || '/tmp/config-backups')} && tar czf ${shellQuote(filePath)} ${paths} 2>&1 && stat -c %s ${shellQuote(filePath)}`;
    const { exitCode, out } = await execCommand(conn, cmd);
    conn.end();
    if (exitCode !== 0) return res.json({ code: 500, message: '备份失败: ' + out });
    await db.insert('INSERT INTO backup_files (config_id, server_id, backup_type, file_name, file_path, file_size, status) VALUES (?,?,?,?,?,?,?)', [task.task_id, task.server_id, 'config', fileName, filePath, parseInt(out.trim()) || 0, 'success']);
    res.json({ code: 0, message: '备份成功' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

router.delete('/config/tasks/:id', async (req, res) => {
  try {
    await db.remove('DELETE FROM config_backup_tasks WHERE id=?', [req.params.id]);
    res.json({ code: 0, message: '已删除' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

// ===== SFTP 辅助 =====
function getSftp(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => err ? reject(err) : resolve(sftp));
  });
}

// ===== 本地 MySQL 恢复（gunzip → mysql）=====
function runLocalMysqlRestore(cfg, dbPass, filePath) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (dbPass) env.MYSQL_PWD = dbPass;
    const gunzip = spawn('gunzip', ['-c', filePath]);
    const mysql = spawn('mysql', [
      `-h${cfg.db_host || 'localhost'}`,
      `-P${Number(cfg.db_port) || 3306}`,
      `-u${cfg.db_username || 'root'}`,
      cfg.db_name
    ], { env });
    let stderr = '';
    mysql.stderr.on('data', c => { stderr += c.toString(); });
    gunzip.stderr.on('data', c => { stderr += c.toString(); });
    gunzip.stdout.pipe(mysql.stdin);
    let settled = false;
    const done = (err) => { if (settled) return; settled = true; err ? reject(err) : resolve(); };
    mysql.on('close', code => done(code !== 0 ? new Error(`mysql 恢复失败: ${stderr || `退出码 ${code}`}`) : null));
    gunzip.on('error', done);
    mysql.on('error', done);
  });
}

// ===== 备份文件下载 =====
router.get('/files/:id/download', async (req, res) => {
  try {
    const file = await db.queryOne('SELECT * FROM backup_files WHERE id=?', [req.params.id]);
    if (!file) return res.status(404).json({ code: 404, message: '文件不存在' });
    const fileName = file.file_name || 'backup.sql.gz';
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    if (file.server_id) {
      // 远程文件：SSH SFTP 拉取流式返回
      const server = await db.queryOne('SELECT * FROM servers WHERE id=?', [file.server_id]);
      const conn = await createSSHConnection(server);
      const sftp = await getSftp(conn);
      const stream = sftp.createReadStream(file.file_path);
      stream.on('error', () => { try { conn.end(); } catch {} });
      stream.on('close', () => { try { conn.end(); } catch {} });
      stream.pipe(res);
    } else {
      // 本地文件：直接读
      if (!fs.existsSync(file.file_path)) return res.status(404).json({ code: 404, message: '文件不存在' });
      fs.createReadStream(file.file_path).pipe(res);
    }
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'db_backup_download', detail: { file: fileName } });
  } catch (err) {
    if (!res.headersSent) res.json({ code: 500, message: err.message });
  }
});

// ===== 备份文件恢复 =====
router.post('/files/:id/restore', roleMiddleware('superadmin', 'admin'), async (req, res) => {
  try {
    const file = await db.queryOne(
      'SELECT bf.*, dbc.db_host, dbc.db_port, dbc.db_username, dbc.db_password_encrypted, dbc.db_name FROM backup_files bf LEFT JOIN db_backup_configs dbc ON bf.config_id = dbc.id WHERE bf.id=?',
      [req.params.id]
    );
    if (!file) return res.json({ code: 404, message: '文件不存在' });
    if (file.status !== 'success') return res.json({ code: 400, message: '该备份状态不可用' });

    const dbPass = file.db_password_encrypted ? decrypt(file.db_password_encrypted) : '';

    if (file.server_id) {
      // 远程恢复：SSH 执行 gunzip | mysql
      const server = await db.queryOne('SELECT * FROM servers WHERE id=?', [file.server_id]);
      const conn = await createSSHConnection(server);
      const cmd = `gunzip -c ${shellQuote(file.file_path)} | MYSQL_PWD=${shellQuote(dbPass || '')} mysql -h${shellQuote(file.db_host || 'localhost')} -P${shellQuote(String(Number(file.db_port) || 3306))} -u${shellQuote(file.db_username || 'root')} ${shellQuote(file.db_name)} 2>&1`;
      const result = await execCommand(conn, cmd);
      conn.end();
      if (result.exitCode !== 0) return res.json({ code: 500, message: '恢复失败: ' + result.out });
    } else {
      // 本地恢复
      if (!fs.existsSync(file.file_path)) return res.json({ code: 404, message: '文件不存在' });
      await runLocalMysqlRestore(file, dbPass, file.file_path);
    }

    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'db_backup_restore', detail: { file: file.file_name, db: file.db_name } });
    res.json({ code: 0, message: '恢复成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

// ===== 面板数据库导出（SSHWeb 自身库）=====
router.get('/panel/export', roleMiddleware('superadmin', 'admin'), async (req, res) => {
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    res.setHeader('Content-Disposition', `attachment; filename="sshweb_panel_${ts}.sql.gz"`);
    res.setHeader('Content-Type', 'application/gzip');

    const dump = spawn('mysqldump', [
      `-h${config.mysql.host}`,
      `-P${config.mysql.port}`,
      `-u${config.mysql.user}`,
      config.mysql.database
    ], { env: { ...process.env, MYSQL_PWD: config.mysql.password } });

    const gzip = zlib.createGzip();
    let stderr = '';
    dump.stderr.on('data', c => { stderr += c.toString(); });
    dump.stdout.pipe(gzip).pipe(res);

    dump.on('error', err => {
      console.error('面板导出失败:', err.message);
      if (!res.headersSent) res.status(500).json({ code: 500, message: err.message });
    });
    dump.on('close', code => {
      if (code !== 0 && stderr) console.error('mysqldump stderr:', stderr);
    });

    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'panel_db_export' });
  } catch (err) {
    if (!res.headersSent) res.json({ code: 500, message: err.message });
  }
});

// ===== 面板数据库导入 =====
const panelUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });
router.post('/panel/import', roleMiddleware('superadmin', 'admin'), panelUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.json({ code: 400, message: '请上传 .sql.gz 文件' });

    const pathModule = require('path');
    const os = require('os');
    const tmpFile = pathModule.join(os.tmpdir(), `sshweb_import_${Date.now()}.sql.gz`);
    await fs.promises.writeFile(tmpFile, req.file.buffer);

    const env = { ...process.env, MYSQL_PWD: config.mysql.password };
    const gunzip = spawn('gunzip', ['-c', tmpFile]);
    const mysql = spawn('mysql', [
      `-h${config.mysql.host}`,
      `-P${config.mysql.port}`,
      `-u${config.mysql.user}`,
      config.mysql.database
    ], { env });

    let stderr = '';
    mysql.stderr.on('data', c => { stderr += c.toString(); });
    gunzip.stdout.pipe(mysql.stdin);

    await new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        fs.promises.unlink(tmpFile).catch(() => {});
        err ? reject(err) : resolve();
      };
      mysql.on('close', code => done(code !== 0 ? new Error(`导入失败: ${stderr || `退出码 ${code}`}`) : null));
      gunzip.on('error', done);
      mysql.on('error', done);
    });

    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'panel_db_import', detail: { file: req.file.originalname, size: req.file.size } });
    res.json({ code: 0, message: '导入成功，建议刷新页面重新登录' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

module.exports = router;
