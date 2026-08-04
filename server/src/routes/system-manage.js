// 系统维护：通过 SSH 在选中的服务器上批量执行系统管理命令
// 支持：系统信息、SSH端口、DNS、时区、Swap、BBR、系统更新、系统清理
const express = require('express');
const db = require('../db');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { createSSHConnection, execCommand, shellQuote } = require('../ssh/connection');
const { writeAuditLog } = require('../utils/audit');

const router = express.Router();
router.use(authMiddleware);

// 在多台服务器上批量执行命令，返回每台的结果
async function batchExec(serverIds, commandFn, timeout = 30000) {
  const results = [];
  for (const sid of serverIds) {
    const server = await db.queryOne('SELECT id, name, host FROM servers WHERE id = ?', [sid]);
    if (!server) { results.push({ server_id: sid, server_name: '-', host: '-', success: false, message: '服务器不存在' }); continue; }
    let conn;
    try {
      const full = await db.queryOne('SELECT * FROM servers WHERE id = ?', [sid]);
      conn = await createSSHConnection(full);
      const { out, exitCode, stderr } = await execCommand(conn, commandFn(server), timeout);
      conn.end(); conn = null;
      results.push({ server_id: sid, server_name: server.name, host: server.host, success: exitCode === 0, data: out.trim(), stderr: stderr?.trim() || '', exitCode });
    } catch (err) {
      try { if (conn) conn.end(); } catch {}
      results.push({ server_id: sid, server_name: server.name, host: server.host, success: false, message: err.message });
    }
  }
  return results;
}

// ── 系统信息（概览） ──
router.post('/info', async (req, res) => {
  try {
    const { server_ids } = req.body;
    if (!server_ids?.length) return res.json({ code: 400, message: '请选择服务器' });
    const cmd = () => `echo "=== SSH 端口 ===" && ss -tlnp 2>/dev/null | grep -oP ':(\\d+)' | head -5
echo "=== DNS ===" && cat /etc/resolv.conf 2>/dev/null | grep nameserver | head -3
echo "=== 时区 ===" && timedatectl 2>/dev/null | grep "Time zone" || cat /etc/timezone 2>/dev/null
echo "=== Swap ===" && swapon --show 2>/dev/null || echo "无 Swap"
echo "=== 拥塞算法 ===" && sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null
echo "=== 内核 ===" && uname -r
echo "=== 内存 ===" && free -h | grep Mem
echo "=== 磁盘 ===" && df -h / | tail -1
echo "=== 系统更新可用 ===" && (apt list --upgradable 2>/dev/null | wc -l || yum check-update 2>/dev/null | wc -l) 2>/dev/null`;
    const results = await batchExec(server_ids, cmd, 15000);
    res.json({ code: 0, data: results });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

// ── SSH 端口查看 + 修改 ──
router.post('/ssh-port', async (req, res) => {
  try {
    const { server_ids, action, port } = req.body;
    if (action === 'get') {
      const cmd = () => `ss -tlnp 2>/dev/null | grep -oP ':(\\d+)' | sort -u | head -10; echo "---"; grep -E '^#?Port ' /etc/ssh/sshd_config 2>/dev/null || echo "Port 22"`;
      const results = await batchExec(server_ids, cmd, 10000);
      res.json({ code: 0, data: results });
    } else if (action === 'set') {
      if (!port || port < 1 || port > 65535) return res.json({ code: 400, message: '端口无效' });
      const cmd = () => `sed -i "s/^#\\?Port .*/Port ${Number(port)}/" /etc/ssh/sshd_config && systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null && echo "SSH 端口已改为 ${port}"`;
      const results = await batchExec(server_ids, cmd, 15000);
      await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'ssh_port_change', detail: { port, servers: server_ids.length } });
      res.json({ code: 0, data: results });
    }
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

// ── DNS 查看 + 修改 ──
router.post('/dns', async (req, res) => {
  try {
    const { server_ids, action, dns } = req.body;
    if (action === 'get') {
      const cmd = () => `cat /etc/resolv.conf 2>/dev/null | grep nameserver | awk '{print $2}'`;
      const results = await batchExec(server_ids, cmd, 10000);
      res.json({ code: 0, data: results });
    } else if (action === 'set') {
      if (!dns) return res.json({ code: 400, message: 'DNS 不能为空' });
      const dnsList = String(dns).split(',').map(d => d.trim()).filter(Boolean);
      let dnsContent = dnsList.map(d => `nameserver ${d}`).join('\n');
      const cmd = () => `cat > /etc/resolv.conf << 'EOF'\n${dnsContent}\nEOF\necho "DNS 已更新"`;
      const results = await batchExec(server_ids, cmd, 10000);
      await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'dns_change', detail: { dns: dnsList, servers: server_ids.length } });
      res.json({ code: 0, data: results });
    }
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

// ── 时区查看 + 设置 ──
router.post('/timezone', async (req, res) => {
  try {
    const { server_ids, action, timezone } = req.body;
    if (action === 'get') {
      const cmd = () => `timedatectl 2>/dev/null | grep "Time zone" | awk '{print $3}' || cat /etc/timezone 2>/dev/null || echo "未知"`;
      const results = await batchExec(server_ids, cmd, 10000);
      res.json({ code: 0, data: results });
    } else if (action === 'set') {
      if (!timezone) return res.json({ code: 400, message: '时区不能为空' });
      const cmd = () => `timedatectl set-timezone ${shellQuote(timezone)} 2>/dev/null && echo "时区已设为 ${timezone}" || echo "设置失败"`;
      const results = await batchExec(server_ids, cmd, 10000);
      await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'timezone_change', detail: { timezone, servers: server_ids.length } });
      res.json({ code: 0, data: results });
    }
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

// ── Swap 查看 + 创建 + 删除 ──
router.post('/swap', async (req, res) => {
  try {
    const { server_ids, action, size } = req.body;
    if (action === 'get') {
      const cmd = () => `swapon --show 2>/dev/null; echo "---"; free -h | grep Swap`;
      const results = await batchExec(server_ids, cmd, 10000);
      res.json({ code: 0, data: results });
    } else if (action === 'create') {
      const swapSize = Number(size) || 1024;
      const cmd = () => `fallocate -l ${swapSize}M /swapfile 2>/dev/null && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab && echo "Swap ${swapSize}MB 已创建"`;
      const results = await batchExec(server_ids, cmd, 30000);
      await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'swap_create', detail: { size: swapSize, servers: server_ids.length } });
      res.json({ code: 0, data: results });
    } else if (action === 'delete') {
      const cmd = () => `swapoff /swapfile 2>/dev/null; sed -i '/\\/swapfile/d' /etc/fstab; rm -f /swapfile; echo "Swap 已删除"`;
      const results = await batchExec(server_ids, cmd, 15000);
      await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'swap_delete', detail: { servers: server_ids.length } });
      res.json({ code: 0, data: results });
    }
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

// ── BBR 拥塞控制查看 + 启用 ──
router.post('/bbr', async (req, res) => {
  try {
    const { server_ids, action } = req.body;
    if (action === 'get') {
      const cmd = () => `echo "当前: $(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null)"; echo "可用: $(sysctl -n net.ipv4.tcp_available_congestion_control 2>/dev/null)"`;
      const results = await batchExec(server_ids, cmd, 10000);
      res.json({ code: 0, data: results });
    } else if (action === 'enable') {
      const cmd = () => `sysctl -w net.core.default_qdisc=fq 2>/dev/null; sysctl -w net.ipv4.tcp_congestion_control=bbr 2>/dev/null; grep -q 'tcp_congestion_control' /etc/sysctl.conf || echo -e '\nnet.core.default_qdisc=fq\nnet.ipv4.tcp_congestion_control=bbr' >> /etc/sysctl.conf; echo "BBR 已启用: $(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null)"`;
      const results = await batchExec(server_ids, cmd, 10000);
      await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'bbr_enable', detail: { servers: server_ids.length } });
      res.json({ code: 0, data: results });
    }
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

// ── 系统更新 ──
router.post('/update', roleMiddleware('superadmin', 'admin'), async (req, res) => {
  try {
    const { server_ids } = req.body;
    if (!server_ids?.length) return res.json({ code: 400, message: '请选择服务器' });
    const cmd = () => `(apt-get update -y && apt-get upgrade -y 2>&1) || (yum update -y 2>&1) || (dnf update -y 2>&1) | tail -20`;
    const results = await batchExec(server_ids, cmd, 300000);
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'system_update', detail: { servers: server_ids.length } });
    res.json({ code: 0, data: results });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

// ── 系统清理 ──
router.post('/clean', roleMiddleware('superadmin', 'admin'), async (req, res) => {
  try {
    const { server_ids } = req.body;
    if (!server_ids?.length) return res.json({ code: 400, message: '请选择服务器' });
    const cmd = () => `echo "=== 清理 apt 缓存 ===" && (apt-get autoremove -y 2>/dev/null && apt-get clean 2>/dev/null && echo "apt 清理完成") || echo "无 apt"
echo "=== 清理 yum 缓存 ===" && (yum clean all 2>/dev/null && echo "yum 清理完成") || echo "无 yum"
echo "=== 清理日志 ===" && journalctl --vacuum-time=7d 2>/dev/null || echo "日志清理跳过"
echo "=== 清理 /tmp ===" && find /tmp -type f -atime +7 -delete 2>/dev/null; echo "/tmp 清理完成"
echo "=== 清理 Docker ===" && docker system prune -f 2>/dev/null || echo "无 Docker 或清理跳过"
echo "=== 磁盘使用 ===" && df -h / | tail -1`;
    const results = await batchExec(server_ids, cmd, 60000);
    await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'system_clean', detail: { servers: server_ids.length } });
    res.json({ code: 0, data: results });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

// ── 性能测试（CPU/内存/磁盘基准） ──
router.post('/benchmark', async (req, res) => {
  try {
    const { server_ids } = req.body;
    if (!server_ids?.length) return res.json({ code: 400, message: '请选择服务器' });
    const cmd = () => `echo "=== CPU 性能 ===" && dd if=/dev/zero bs=1M count=1024 2>&1 | tail -1
echo "=== 内存 ===" && free -h | grep Mem
echo "=== 磁盘写入 ===" && dd if=/dev/zero of=/tmp/testfile bs=1M count=512 oflag=direct 2>&1 | tail -1 && rm -f /tmp/testfile
echo "=== 磁盘读取 ===" && dd if=/tmp/testfile of=/dev/null bs=1M 2>/dev/null; rm -f /tmp/testfile 2>/dev/null
echo "=== 网络延迟 ===" && ping -c 3 8.8.8.8 2>&1 | tail -1 || echo "ping 不可用"`;
    const results = await batchExec(server_ids, cmd, 120000);
    res.json({ code: 0, data: results });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

// ── 软件源（镜像源）查看 + 换源 ──
router.post('/mirror', roleMiddleware('superadmin', 'admin'), async (req, res) => {
  try {
    const { server_ids, action, mirror } = req.body;
    if (action === 'get') {
      const cmd = () => `echo "=== 系统 ===" && grep -E '^(ID|VERSION_CODENAME)=' /etc/os-release 2>/dev/null
echo "=== 当前源 ===" && grep -v '^#' /etc/apt/sources.list 2>/dev/null | grep -v '^$' | head -10
echo "=== sources.list.d ===" && ls /etc/apt/sources.list.d/ 2>/dev/null || echo "无额外源"`;
      const results = await batchExec(server_ids, cmd, 10000);
      res.json({ code: 0, data: results });
    } else if (action === 'set') {
      const mirrors = {
        // 国内
        aliyun:    { deb: 'mirrors.aliyun.com',             ubu: 'mirrors.aliyun.com' },
        tsinghua:  { deb: 'mirrors.tuna.tsinghua.edu.cn',   ubu: 'mirrors.tuna.tsinghua.edu.cn' },
        ustc:      { deb: 'mirrors.ustc.edu.cn',            ubu: 'mirrors.ustc.edu.cn' },
        tencent:   { deb: 'mirrors.cloud.tencent.com',      ubu: 'mirrors.cloud.tencent.com' },
        huawei:    { deb: 'mirrors.huaweicloud.com',        ubu: 'mirrors.huaweicloud.com' },
        // 海外
        official:  { deb: 'deb.debian.org',                 ubu: 'archive.ubuntu.com' },
        japan:     { deb: 'ftp.jp.debian.org',              ubu: 'jp.archive.ubuntu.com' },
        korea:     { deb: 'ftp.kr.debian.org',              ubu: 'kr.archive.ubuntu.com' },
        germany:   { deb: 'ftp.de.debian.org',              ubu: 'de.archive.ubuntu.com' },
        us:        { deb: 'ftp.us.debian.org',              ubu: 'us.archive.ubuntu.com' },
        uk:        { deb: 'ftp.uk.debian.org',              ubu: 'uk.archive.ubuntu.com' },
        france:    { deb: 'ftp.fr.debian.org',              ubu: 'fr.archive.ubuntu.com' },
        singapore: { deb: 'ftp.sg.debian.org',              ubu: 'sg.archive.ubuntu.com' },
      };
      const config = mirrors[mirror];
      if (!config) return res.json({ code: 400, message: '镜像源无效' });
      // 用 echo 写入（不用 heredoc 带 'SRCEOF'，否则 shell 变量不展开）
      const cmd = () => `OS_ID=$(grep '^ID=' /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '"')
CODENAME=$(grep '^VERSION_CODENAME=' /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '"')
cp /etc/apt/sources.list /etc/apt/sources.list.bak.$(date +%Y%m%d%H%M%S) 2>/dev/null
if [ "$OS_ID" = "debian" ]; then
  HOST="${config.deb}"
  echo "deb https://$HOST/debian/ $CODENAME main contrib non-free non-free-firmware" > /etc/apt/sources.list
  echo "deb https://$HOST/debian/ $CODENAME-updates main contrib non-free non-free-firmware" >> /etc/apt/sources.list
  echo "deb https://$HOST/debian-security/ $CODENAME-security main contrib non-free non-free-firmware" >> /etc/apt/sources.list
elif [ "$OS_ID" = "ubuntu" ]; then
  HOST="${config.ubu}"
  echo "deb https://$HOST/ubuntu/ $CODENAME main restricted universe multiverse" > /etc/apt/sources.list
  echo "deb https://$HOST/ubuntu/ $CODENAME-updates main restricted universe multiverse" >> /etc/apt/sources.list
  echo "deb https://$HOST/ubuntu/ $CODENAME-backports main restricted universe multiverse" >> /etc/apt/sources.list
  echo "deb https://$HOST/ubuntu/ $CODENAME-security main restricted universe multiverse" >> /etc/apt/sources.list
else
  echo "不支持的系统: $OS_ID"; exit 1
fi
apt-get update -y 2>&1 | tail -5
echo "=== 软件源已切换: ${mirror} ($HOST) | 系统: $OS_ID $CODENAME ==="`;
      const results = await batchExec(server_ids, cmd, 120000);
      await writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'mirror_change', detail: { mirror, deb: config.deb, ubu: config.ubu, servers: server_ids.length } });
      res.json({ code: 0, data: results });
    }
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

module.exports = router;
