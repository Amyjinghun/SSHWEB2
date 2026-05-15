const express = require('express');
const tls = require('tls');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { writeAuditLog } = require('../utils/audit');

const router = express.Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const certs = await db.query('SELECT * FROM certificates ORDER BY id DESC');
    res.json({ code: 0, data: certs });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { domain, port, remark } = req.body;
    if (!domain) return res.json({ code: 400, message: '域名为必填项' });
    const id = await db.insert('INSERT INTO certificates (domain, port, remark) VALUES (?, ?, ?)', [domain, port || 443, remark || null]);
    res.json({ code: 0, message: '证书监控添加成功', data: { id } });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { domain, port, remark } = req.body;
    await db.update('UPDATE certificates SET domain=COALESCE(?,domain), port=COALESCE(?,port), remark=COALESCE(?,remark) WHERE id=?', [domain || null, port || null, remark || null, req.params.id]);
    res.json({ code: 0, message: '更新成功' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.remove('DELETE FROM certificates WHERE id=?', [req.params.id]);
    res.json({ code: 0, message: '已删除' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

router.post('/:id/check', async (req, res) => {
  try {
    const cert = await db.queryOne('SELECT * FROM certificates WHERE id=?', [req.params.id]);
    if (!cert) return res.json({ code: 404, message: '证书不存在' });
    const info = await new Promise((resolve, reject) => {
      const socket = tls.connect({ host: cert.domain, port: cert.port, rejectUnauthorized: false }, () => {
        const peerCert = socket.getPeerCertificate();
        socket.end();
        resolve(peerCert);
      });
      socket.setTimeout(10000, () => { socket.destroy(); reject(new Error('连接超时')); });
      socket.on('error', reject);
    });
    if (!info || !info.valid_to) return res.json({ code: 500, message: '无法获取证书信息' });
    const validTo = new Date(info.valid_to);
    const validFrom = new Date(info.valid_from);
    const daysLeft = Math.ceil((validTo - new Date()) / (1000 * 60 * 60 * 24));
    const status = daysLeft <= 0 ? 'expired' : daysLeft <= 7 ? 'expiring' : 'valid';
    await db.update('UPDATE certificates SET issuer=?, valid_from=?, valid_to=?, days_left=?, status=?, last_checked_at=NOW() WHERE id=?',
      [info.issuer?.O || '', validFrom, validTo, daysLeft, status, req.params.id]);
    res.json({ code: 0, data: { issuer: info.issuer?.O, validFrom, validTo, daysLeft, status } });
  } catch (err) {
    await db.update('UPDATE certificates SET status=?, last_checked_at=NOW() WHERE id=?', ['error', req.params.id]);
    res.json({ code: 500, message: err.message });
  }
});

module.exports = router;
