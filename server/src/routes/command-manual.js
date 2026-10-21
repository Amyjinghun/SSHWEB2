const express = require('express');
const fs = require('fs');
const path = require('path');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// 命令手册数据来自开源项目 jaywcjlove/linux-command（MIT），随 npm 包分发，
// 路由只做索引与读取，避免把 600+ md 文件 vendor 进仓库
let META = null;
let PKG_DIR = null;

function loadMeta() {
  if (META) return META;
  PKG_DIR = path.dirname(require.resolve('linux-command/package.json'));
  const raw = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'dist', 'data.json'), 'utf8'));
  META = Object.values(raw).map(item => ({
    name: String(item.n || ''),
    desc: String(item.d || '')
  })).filter(item => item.name);
  return META;
}

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,31}$/;
const MAX_MD_SIZE = 300 * 1024;

// GET /api/command-manual/list?q=ssh
router.get('/list', (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    let list = loadMeta();
    if (q) {
      list = list.filter(item =>
        item.name.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q)
      );
    }
    res.json({ code: 0, data: list });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

// GET /api/command-manual/:name  → markdown 原文
router.get('/:name', (req, res) => {
  try {
    const name = String(req.params.name || '');
    if (!NAME_RE.test(name)) {
      return res.json({ code: 400, message: '非法命令名' });
    }
    loadMeta();
    const file = path.join(PKG_DIR, 'command', `${name}.md`);
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    if (!stat || !stat.isFile()) {
      return res.json({ code: 404, message: '未找到该命令的手册' });
    }
    if (stat.size > MAX_MD_SIZE) {
      return res.json({ code: 413, message: '手册内容过大' });
    }
    const content = fs.readFileSync(file, 'utf8');
    res.json({ code: 0, data: { name, content } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

module.exports = router;
