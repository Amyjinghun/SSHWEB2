const express = require('express');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const serverTotal = await db.queryOne('SELECT COUNT(*) as count FROM servers');
    const serverOnline = await db.queryOne("SELECT COUNT(*) as count FROM servers WHERE status='online'");
    const serverOffline = await db.queryOne("SELECT COUNT(*) as count FROM servers WHERE status='offline'");
    const alertActive = await db.queryOne("SELECT COUNT(*) as count FROM alert_logs WHERE status='active'");
    const todayExecs = await db.queryOne("SELECT COUNT(*) as count FROM command_logs WHERE DATE(created_at) = CURDATE()");
    const todayFailed = await db.queryOne("SELECT COUNT(*) as count FROM command_logs WHERE DATE(created_at) = CURDATE() AND status='failed'");
    const avgCpu = await db.queryOne('SELECT ROUND(AVG(cpu_usage),2) as val FROM servers WHERE status=?', ['online']);
    const avgMem = await db.queryOne('SELECT ROUND(AVG(memory_usage),2) as val FROM servers WHERE status=?', ['online']);
    const avgDisk = await db.queryOne('SELECT ROUND(AVG(disk_usage),2) as val FROM servers WHERE status=?', ['online']);

    const recentCommands = await db.query(
      'SELECT cl.*, s.name as server_name FROM command_logs cl LEFT JOIN servers s ON cl.server_id = s.id ORDER BY cl.id DESC LIMIT 10'
    );
    const recentAlerts = await db.query(
      'SELECT al.*, s.name as server_name FROM alert_logs al LEFT JOIN servers s ON al.server_id = s.id ORDER BY al.id DESC LIMIT 10'
    );
    const execStats = await db.query(
      "SELECT DATE(created_at) as date, COUNT(*) as total, SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as success_count, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed_count FROM command_logs WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY DATE(created_at) ORDER BY date"
    );

    res.json({
      code: 0,
      data: {
        server_total: serverTotal.count,
        server_online: serverOnline.count,
        server_offline: serverOffline.count,
        alert_active: alertActive.count,
        today_execs: todayExecs.count,
        today_failed: todayFailed.count,
        avg_cpu: avgCpu.val || 0,
        avg_memory: avgMem.val || 0,
        avg_disk: avgDisk.val || 0,
        recent_commands: recentCommands,
        recent_alerts: recentAlerts,
        exec_stats: execStats
      }
    });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

module.exports = router;
