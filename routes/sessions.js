const express = require('express');
const router = express.Router();
const pool = require('../services/database');
const { getZoomService } = require('../services/zoom');

// ========================================
// SESSIONS ROUTES
// ========================================

// GET /api/sessions — All sessions with filters
router.get('/', async (req, res) => {
  try {
    const { status, campaign_id, limit = 50 } = req.query;

    let query = `
      SELECT 
        s.*,
        c.name as campaign_name,
        c.webinar_title,
        c.video_url,
        COUNT(r.id) as registrant_count
      FROM sessions s
      JOIN campaigns c ON s.campaign_id = c.id
      LEFT JOIN registrants r ON r.session_id = s.id
    `;
    const params = [];
    const conditions = [];

    if (status) { conditions.push(`s.status = $${params.length + 1}`); params.push(status); }
    if (campaign_id) { conditions.push(`s.campaign_id = $${params.length + 1}`); params.push(campaign_id); }

    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ` GROUP BY s.id, c.name, c.webinar_title, c.video_url ORDER BY s.scheduled_at ASC LIMIT $${params.length + 1}`;
    params.push(limit);

    const { rows } = await pool.query(query, params);
    res.json({ success: true, sessions: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/sessions/upcoming — Next 7 days
router.get('/upcoming', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        s.*,
        c.name as campaign_name,
        c.webinar_title,
        COUNT(r.id) as registrant_count
      FROM sessions s
      JOIN campaigns c ON s.campaign_id = c.id
      LEFT JOIN registrants r ON r.session_id = s.id
      WHERE s.scheduled_at > NOW()
        AND s.status = 'scheduled'
      GROUP BY s.id, c.name, c.webinar_title
      ORDER BY s.scheduled_at ASC
      LIMIT 20
    `);
    res.json({ success: true, sessions: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/sessions/:id — Cancel session
router.delete('/:id', async (req, res) => {
  try {
    const { rows: [session] } = await pool.query('SELECT * FROM sessions WHERE id = $1', [req.params.id]);
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

    // Cancel on Zoom if meeting exists
    if (session.zoom_meeting_id) {
      try {
        const { rows: [campaign] } = await pool.query(`
          SELECT za.* FROM campaigns c
          JOIN zoom_accounts za ON c.zoom_account_id = za.id
          WHERE c.id = $1
        `, [session.campaign_id]);

        if (campaign) {
          const zoomService = getZoomService(campaign);
          await zoomService.deleteMeeting(session.zoom_meeting_id);
        }
      } catch (e) {
        console.error('Zoom delete error:', e.message);
      }
    }

    await pool.query(`UPDATE sessions SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [req.params.id]);
    res.json({ success: true, message: 'Session cancelled' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
