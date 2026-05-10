const express = require('express');
const router = express.Router();
const pool = require('../services/database');

// GET /api/dashboard — Overview stats
router.get('/', async (req, res) => {
  try {
    const [campaigns, sessions, registrants, upcoming, live] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN status='active' THEN 1 END) as active FROM campaigns`),
      pool.query(`SELECT COUNT(*) as total FROM sessions WHERE status != 'cancelled'`),
      pool.query(`SELECT COUNT(*) as total FROM registrants`),
      pool.query(`SELECT COUNT(*) as total FROM sessions WHERE status = 'scheduled' AND scheduled_at > NOW()`),
      pool.query(`SELECT COUNT(*) as total FROM sessions WHERE status = 'live'`),
    ]);

    // Next 5 upcoming sessions
    const { rows: nextSessions } = await pool.query(`
      SELECT s.*, c.name as campaign_name, c.webinar_title
      FROM sessions s
      JOIN campaigns c ON s.campaign_id = c.id
      WHERE s.status = 'scheduled' AND s.scheduled_at > NOW()
      ORDER BY s.scheduled_at ASC
      LIMIT 5
    `);

    res.json({
      success: true,
      stats: {
        totalCampaigns: parseInt(campaigns.rows[0].total),
        activeCampaigns: parseInt(campaigns.rows[0].active),
        totalSessions: parseInt(sessions.rows[0].total),
        totalRegistrants: parseInt(registrants.rows[0].total),
        upcomingSessions: parseInt(upcoming.rows[0].total),
        liveSessions: parseInt(live.rows[0].total),
      },
      nextSessions
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
