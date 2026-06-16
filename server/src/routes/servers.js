const express = require('express');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { createSSHConnection, execCommand } = require('../ssh/connection');
const { writeAuditLog } = require('../utils/audit');
const { checkOneServer } = require('../scheduler');
const config = require('../config');

const router = express.Router();
router.use(authMiddleware);

function normalizeServerInput(body) {
  const data = { ...body };
  data.name = typeof data.name === 'string' ? data.name.trim() : data.name;
  data.host = typeof data.host === 'string' ? data.host.trim() : data.host;
  data.username = typeof data.username === 'string' ? data.username.trim() : data.username;
  if (data.host) {
    const match = String(data.host).match(/^([^:\[\]]+):(\d+)$/);
    if (match) {
      data.host = match[1];
      if (!data.port) data.port = Number(match[2]);
    }
  }
  data.port = Number(data.port) || 22;
  if (data.expires_at === '') data.expires_at = null;
  if (data.group_id === '' || data.group_id === undefined) data.group_id = null;
  if (Array.isArray(data.tags)) data.tags = data.tags;
  else if (typeof data.tags === 'string' && data.tags.trim()) {
    try { data.tags = JSON.parse(data.tags); } catch { data.tags = data.tags.split(',').map(t => t.trim()).filter(Boolean); }
  }
  return data;
}


function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"' && inQuotes && next === '"') { current += '"'; i += 1; continue; }
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { values.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  values.push(current.trim());
  return values;
}

function parseImportContent(content) {
  const raw = String(content || '').replace(/^\ufeff/, '').trim();
  if (!raw) return [];
  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (err) {
      err.statusCode = 400;
      err.message = '导入内容不是有效的 JSON 格式';
      throw err;
    }
  }

  const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]).map((h, i) => (i === 0 ? h.replace(/^\ufeff/, '') : h).trim());
  return lines.slice(1).map(line => {
    const cols = parseCsvLine(line);
    const item = {};
    headers.forEach((h, i) => { item[h] = cols[i] || ''; });
    return item;
  });
}


function normalizeAuthType(value) {
  const raw = String(value || 'password').trim();
  const map = {
    '密码': 'password',
    '私钥': 'private_key',
    '密码+私钥': 'password_private_key',
    '密码私钥': 'password_private_key',
    'password': 'password',
    'private_key': 'private_key',
    'key': 'private_key',
    'password_private_key': 'password_private_key'
  };
  return map[raw] || 'password';
}

function pickImportValue(row, keys, fallback = undefined) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') return row[key];
  }
  return fallback;
}

async function getOrCreateGroupId(groupName) {
  const name = String(groupName || '').trim();
  if (!name) return null;
  const exist = await db.queryOne('SELECT id FROM server_groups WHERE name = ?', [name]);
  if (exist) return exist.id;
  return db.insert('INSERT INTO server_groups (name) VALUES (?)', [name]);
}

function buildImportTemplate() {
  return [
    'name,host,port,username,auth_type,password,private_key,private_key_passphrase,group_name,tags,expires_at,os_info,remark',
    '示例服务器,1.2.3.4,22,root,password,你的SSH密码,,,生产环境,"nginx,web",2026-12-31,Debian 11,备注信息'
  ].join('\n');
}


function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = Array.isArray(value) ? value.join(',') : String(value);
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}


function parseTagsField(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(value).split(/[，,;；]/).map(t => t.trim()).filter(Boolean);
  }
}

function parseTagsForExport(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(tags).split(/[，,;；]/).map(t => t.trim()).filter(Boolean);
  }
}

function buildExportWhere(query) {
  const params = [];
  const conditions = ['1=1'];

  if (query.ids) {
    const ids = String(query.ids).split(',').map(id => Number(id)).filter(Boolean);
    if (ids.length) {
      conditions.push(`s.id IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }
  }
  if (query.group_id) { conditions.push('s.group_id = ?'); params.push(query.group_id); }
  if (query.status) { conditions.push('s.status = ?'); params.push(query.status); }
  if (query.keyword) {
    conditions.push('(s.name LIKE ? OR s.host LIKE ? OR s.remark LIKE ?)');
    params.push(`%${query.keyword}%`, `%${query.keyword}%`, `%${query.keyword}%`);
  }

  return { where: conditions.join(' AND '), params };
}

function safeDecrypt(value) {
  if (!value) return '';
  try {
    const { decrypt } = require('../utils/crypto');
    return decrypt(value) || '';
  } catch (err) {
    return '';
  }
}

function normalizeExportRow(row, includeCredentials = false) {
  const tags = parseTagsForExport(row.tags);
  const password = includeCredentials ? safeDecrypt(row.password_encrypted) : '';
  const privateKey = includeCredentials ? safeDecrypt(row.private_key_encrypted) : '';
  const privateKeyPassphrase = includeCredentials ? safeDecrypt(row.private_key_passphrase_encrypted) : '';
  return {
    name: row.name || '',
    host: row.host || '',
    port: row.port || 22,
    username: row.username || '',
    auth_type: row.auth_type || 'password',
    password,
    private_key: privateKey,
    private_key_passphrase: privateKeyPassphrase,
    group_name: row.group_name || '',
    tags,
    expires_at: row.expires_at || '',
    os_info: row.os_info || '',
    status: row.status || 'unknown',
    cpu_usage: row.cpu_usage ?? '',
    memory_usage: row.memory_usage ?? '',
    disk_usage: row.disk_usage ?? '',
    last_connected_at: row.last_connected_at || '',
    remark: row.remark || '',
    has_password: !!password,
    has_private_key: !!privateKey
  };
}

function buildExportCsv(rows) {
  const headers = [
    '服务器名称','主机地址','端口','用户名','认证方式','密码','私钥','私钥密码','分组','标签','到期日期','系统版本','状态','CPU','内存','磁盘','最后连接时间','备注'
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      r.name, r.host, r.port, r.username, r.auth_type, r.password, r.private_key, r.private_key_passphrase,
      r.group_name, r.tags.join(','), r.expires_at, r.os_info, r.status, r.cpu_usage, r.memory_usage,
      r.disk_usage, r.last_connected_at, r.remark
    ].map(csvEscape).join(','));
  }
  return lines.join('\n');
}


router.get('/', async (req, res) => {
  try {
    const { group_id, status, keyword } = req.query;
    let sql = `SELECT s.*, DATE_FORMAT(s.expires_at, '%Y-%m-%d') as expires_at, g.name as group_name FROM servers s LEFT JOIN server_groups g ON s.group_id = g.id WHERE 1=1`;
    const params = [];
    if (group_id) { sql += ' AND s.group_id = ?'; params.push(group_id); }
    if (status) { sql += ' AND s.status = ?'; params.push(status); }
    if (keyword) { sql += ' AND (s.name LIKE ? OR s.host LIKE ? OR s.remark LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
    sql += ' ORDER BY s.id DESC';
    const servers = await db.query(sql, params);
    servers.forEach(s => { s.tags = parseTagsField(s.tags); delete s.password_encrypted; delete s.private_key_encrypted; delete s.private_key_passphrase_encrypted; });
    res.json({ code: 0, data: servers });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, host, port, username, auth_type, password, private_key, private_key_passphrase, group_id, tags, expires_at, remark } = normalizeServerInput(req.body);
    if (!name || !host || !username) return res.json({ code: 400, message: '服务器名称、主机地址和用户名为必填项' });
    const { encrypt } = require('../utils/crypto');
    const id = await db.insert(
      `INSERT INTO servers (name, host, port, username, auth_type, password_encrypted, private_key_encrypted, private_key_passphrase_encrypted, group_id, tags, expires_at, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, host, port || 22, username, auth_type || 'password', password ? encrypt(password) : null, private_key ? encrypt(private_key) : null, private_key_passphrase ? encrypt(private_key_passphrase) : null, group_id || null, tags ? JSON.stringify(tags) : null, expires_at || null, remark || null]
    );
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'add_server', targetType: 'server', targetId: id, detail: { name, host } });
    res.json({ code: 0, message: '服务器添加成功', data: { id } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});


router.get('/import/template', async (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="servers_import_template.csv"');
  res.send('\ufeff' + buildImportTemplate());
});

router.post('/import', async (req, res) => {
  try {
    const rows = Array.isArray(req.body.servers) ? req.body.servers : parseImportContent(req.body.content);
    if (!rows.length) return res.json({ code: 400, message: '没有读取到可导入的服务器配置' });

    const { encrypt } = require('../utils/crypto');
    const result = { total: rows.length, success: 0, failed: 0, errors: [] };

    for (let i = 0; i < rows.length; i += 1) {
      try {
        const row = rows[i] || {};
        const groupName = pickImportValue(row, ['group_name', 'group', '分组']);
        const groupId = pickImportValue(row, ['group_id'], null) || await getOrCreateGroupId(groupName);
        const tagsRaw = pickImportValue(row, ['tags', '标签'], '');
        const tags = Array.isArray(tagsRaw) ? tagsRaw : String(tagsRaw || '').split(/[，,;；]/).map(t => t.trim()).filter(Boolean);
        const normalized = normalizeServerInput({
          name: pickImportValue(row, ['name', '服务器名称', '名称']),
          host: pickImportValue(row, ['host', 'ip', 'IP', '主机地址', '地址']),
          port: pickImportValue(row, ['port', '端口'], 22),
          username: pickImportValue(row, ['username', 'user', '用户', '用户名'], 'root'),
          auth_type: normalizeAuthType(pickImportValue(row, ['auth_type', '认证方式'], 'password')),
          password: pickImportValue(row, ['password', '密码'], ''),
          private_key: pickImportValue(row, ['private_key', '私钥'], ''),
          private_key_passphrase: pickImportValue(row, ['private_key_passphrase', '私钥密码'], ''),
          group_id: groupId,
          tags,
          expires_at: pickImportValue(row, ['expires_at', '到期日期', '到期时间'], null),
          os_info: pickImportValue(row, ['os_info', '系统版本'], null),
          remark: pickImportValue(row, ['remark', '备注'], '')
        });

        if (!normalized.name || !normalized.host || !normalized.username) {
          throw new Error('服务器名称、主机地址、用户名为必填项');
        }

        await db.insert(
          `INSERT INTO servers (name, host, port, username, auth_type, password_encrypted, private_key_encrypted, private_key_passphrase_encrypted, group_id, tags, expires_at, os_info, remark)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            normalized.name,
            normalized.host,
            normalized.port || 22,
            normalized.username,
            normalized.auth_type || 'password',
            normalized.password ? encrypt(normalized.password) : null,
            normalized.private_key ? encrypt(normalized.private_key) : null,
            normalized.private_key_passphrase ? encrypt(normalized.private_key_passphrase) : null,
            normalized.group_id || null,
            normalized.tags ? JSON.stringify(normalized.tags) : null,
            normalized.expires_at || null,
            normalized.os_info || null,
            normalized.remark || null
          ]
        );
        result.success += 1;
      } catch (err) {
        result.failed += 1;
        result.errors.push({ row: i + 1, message: err.message });
      }
    }

    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'import_servers', targetType: 'server', detail: result, status: result.failed ? 'failed' : 'success' });
    res.json({ code: 0, message: `导入完成，成功 ${result.success} 条，失败 ${result.failed} 条`, data: result });
  } catch (err) {
    res.json({ code: err.statusCode || 500, message: err.message });
  }
});



router.get('/export', async (req, res) => {
  try {
    const format = String(req.query.format || 'csv').toLowerCase() === 'json' ? 'json' : 'csv';
    const includeCredentials = ['1', 'true', 'yes'].includes(String(req.query.include_credentials || '').toLowerCase());
    if (includeCredentials && !config.security.allowPlainCredentialExport) {
      return res.status(403).json({ code: 403, message: 'Plain credential export is disabled by server configuration' });
    }
    if (includeCredentials && req.user.role !== 'superadmin') {
      return res.status(403).json({ code: 403, message: '只有超级管理员可以导出明文凭据' });
    }
    const { where, params } = buildExportWhere(req.query);
    const rows = await db.query(
      `SELECT s.*, DATE_FORMAT(s.expires_at, '%Y-%m-%d') as expires_at, DATE_FORMAT(s.last_connected_at, '%Y-%m-%d %H:%i:%s') as last_connected_at, g.name as group_name
       FROM servers s
       LEFT JOIN server_groups g ON s.group_id = g.id
       WHERE ${where}
       ORDER BY s.id DESC`,
      params
    );
    const data = rows.map(row => normalizeExportRow(row, includeCredentials));
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');

    await writeAuditLog({
      userId: req.user.id,
      username: req.user.username,
      action: 'export_servers',
      targetType: 'server',
      detail: { format, count: data.length, include_plain_credentials: includeCredentials, ids: req.query.ids || null, keyword: req.query.keyword || null, group_id: req.query.group_id || null, status: req.query.status || null }
    });

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="servers_export_${stamp}.json"`);
      return res.send(JSON.stringify(data, null, 2));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="servers_export_${stamp}.csv"`);
    return res.send('\ufeff' + buildExportCsv(data));
  } catch (err) {
    return res.status(500).json({ code: 500, message: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const server = await db.queryOne("SELECT s.*, DATE_FORMAT(s.expires_at, '%Y-%m-%d') as expires_at, g.name as group_name FROM servers s LEFT JOIN server_groups g ON s.group_id = g.id WHERE s.id = ?", [req.params.id]);
    if (!server) return res.json({ code: 404, message: '服务器不存在' });
    server.has_password = !!server.password_encrypted;
    server.has_private_key = !!server.private_key_encrypted;
    server.tags = parseTagsField(server.tags);
    delete server.password_encrypted;
    delete server.private_key_encrypted;
    delete server.private_key_passphrase_encrypted;
    res.json({ code: 0, data: server });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, host, port, username, auth_type, password, private_key, private_key_passphrase, group_id, tags, expires_at, remark } = normalizeServerInput(req.body);
    const { encrypt } = require('../utils/crypto');
    const fields = [];
    const params = [];
    const addField = (col, val) => { if (val !== undefined) { fields.push(`${col} = ?`); params.push(val); } };
    addField('name', name); addField('host', host); addField('port', port);
    addField('username', username); addField('auth_type', auth_type);
    addField('group_id', group_id); addField('expires_at', expires_at); addField('remark', remark);
    if (tags !== undefined) { fields.push('tags = ?'); params.push(JSON.stringify(tags)); }
    if (password !== undefined) { fields.push('password_encrypted = ?'); params.push(password ? encrypt(password) : null); }
    if (private_key !== undefined) { fields.push('private_key_encrypted = ?'); params.push(private_key ? encrypt(private_key) : null); }
    if (private_key_passphrase !== undefined) { fields.push('private_key_passphrase_encrypted = ?'); params.push(private_key_passphrase ? encrypt(private_key_passphrase) : null); }
    if (!fields.length) return res.json({ code: 400, message: '没有可更新的字段' });
    params.push(req.params.id);
    await db.update(`UPDATE servers SET ${fields.join(', ')} WHERE id = ?`, params);
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'update_server', targetType: 'server', targetId: req.params.id });
    res.json({ code: 0, message: '更新成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.remove('DELETE FROM servers WHERE id = ?', [req.params.id]);
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'delete_server', targetType: 'server', targetId: req.params.id });
    res.json({ code: 0, message: '服务器已删除' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.post('/:id/test', async (req, res) => {
  try {
    const server = await db.queryOne('SELECT * FROM servers WHERE id = ?', [req.params.id]);
    if (!server) return res.json({ code: 404, message: '服务器不存在' });
    const conn = await createSSHConnection(server);
    let osInfo = null;
    try {
      const { out } = await execCommand(conn, "if [ -f /etc/os-release ]; then . /etc/os-release; echo ${PRETTY_NAME:-$NAME}; else uname -srm; fi", 8000);
      osInfo = String(out || '').trim().slice(0, 255) || null;
    } catch {}
    conn.end();
    await db.update('UPDATE servers SET status = ?, os_info = COALESCE(?, os_info), last_connected_at = NOW() WHERE id = ?', ['online', osInfo, req.params.id]);
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'test_connection', targetType: 'server', targetId: req.params.id, status: 'success' });
    res.json({ code: 0, message: '连接成功' });
  } catch (err) {
    await db.update('UPDATE servers SET status = ? WHERE id = ?', ['offline', req.params.id]);
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'test_connection', targetType: 'server', targetId: req.params.id, status: 'failed', errorMessage: err.message });
    res.json({ code: 500, message: err.message });
  }
});

router.post('/:id/renew', async (req, res) => {
  try {
    const months = Number(req.body.months);
    if (!months || months < 1 || months > 12) return res.json({ code: 400, message: '续费月数须为 1-12' });
    const server = await db.queryOne('SELECT id, name, expires_at FROM servers WHERE id = ?', [req.params.id]);
    if (!server) return res.json({ code: 404, message: '服务器不存在' });
    const base = server.expires_at ? new Date(server.expires_at) : new Date();
    base.setMonth(base.getMonth() + months);
    const newDate = base.toISOString().slice(0, 10);
    await db.update('UPDATE servers SET expires_at = ? WHERE id = ?', [newDate, req.params.id]);
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'renew_server', targetType: 'server', targetId: req.params.id, detail: { months, newDate } });
    res.json({ code: 0, message: `已续费 ${months} 个月，新到期日期：${newDate}`, data: { expires_at: newDate } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.post('/:id/monitor', async (req, res) => {
  try {
    const server = await db.queryOne('SELECT * FROM servers WHERE id = ?', [req.params.id]);
    if (!server) return res.json({ code: 404, message: '服务器不存在' });
    const result = await checkOneServer(server);
    if (result.ok) {
      await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'refresh_server_metrics', targetType: 'server', targetId: req.params.id, status: 'success' });
      return res.json({ code: 0, message: '采集成功', data: result.metrics });
    }
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'refresh_server_metrics', targetType: 'server', targetId: req.params.id, status: 'failed', errorMessage: result.error });
    res.json({ code: 500, message: result.error || '采集失败' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});


router.get('/:id/metrics', async (req, res) => {
  try {
    const { hours = 24 } = req.query;
    const metrics = await db.query(
      'SELECT * FROM server_metrics WHERE server_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL ? HOUR) ORDER BY created_at',
      [req.params.id, hours]
    );
    res.json({ code: 0, data: metrics });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.get('/:id/status-changes', async (req, res) => {
  try {
    const { page = 1, page_size = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(page_size);
    const list = await db.query(
      'SELECT * FROM server_status_changes WHERE server_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [req.params.id, Number(page_size), offset]
    );
    const total = await db.queryOne('SELECT COUNT(*) as cnt FROM server_status_changes WHERE server_id = ?', [req.params.id]);
    res.json({ code: 0, data: { list, total: total.cnt } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

module.exports = router;
