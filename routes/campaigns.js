const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../services/database');
const { uploadVideo, deleteVideo } = require('../services/storage');
const { triggerForCampaign } = require('../services/scheduler');
const { v4: uuidv4 } = require('uuid');

// Multer: store in memory before uploading to B2
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB max
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'));
    }
  }
});

// ----------------------------------------
// GET /api/campaigns — List all campaigns
// ----------------------------------------
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        c.*,
        za.name as zoom_account_name,
        COUNT(DISTINCT s.id) as total_sessions,
        COUNT(DISTINCT CASE WHEN s.status = 'scheduled' THEN s.id END) as upcoming_sessions,
        COUNT(DISTINCT r.id) as total_registrants
      FROM campaigns c
      LEFT JOIN zoom_accounts za ON c.zoom_account_id = za.id
      LEFT JOIN sessions s ON s.campaign_id = c.id
      LEFT JOIN registrants r ON r.campaign_id = c.id
      GROUP BY c.id, za.name
      ORDER BY c.created_at DESC
    `);
    res.json({ success: true, campaigns: rows });
  } catch (error) {
    console.error('Get campaigns error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------
// GET /api/campaigns/:id — Get single campaign
// ----------------------------------------
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*, za.name as zoom_account_name
      FROM campaigns c
      LEFT JOIN zoom_accounts za ON c.zoom_account_id = za.id
      WHERE c.id = $1
    `, [req.params.id]);

    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Campaign not found' });

    // Get schedules
    const { rows: schedules } = await pool.query(
      'SELECT * FROM schedules WHERE campaign_id = $1',
      [req.params.id]
    );

    // Get upcoming sessions
    const { rows: sessions } = await pool.query(`
      SELECT * FROM sessions 
      WHERE campaign_id = $1 
        AND scheduled_at > NOW()
        AND status != 'cancelled'
      ORDER BY scheduled_at ASC
      LIMIT 10
    `, [req.params.id]);

    res.json({
      success: true,
      campaign: rows[0],
      schedules,
      upcomingSessions: sessions
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------
// POST /api/campaigns — Create new campaign
// ----------------------------------------
router.post('/', upload.single('video'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      name, description, webinar_title, webinar_agenda,
      zoom_account_id, schedule_days, schedule_hour, schedule_minute, timezone
    } = req.body;

    // Upload video if provided
    let videoUrl = null;
    let videoFilename = null;
    let videoSize = null;

    if (req.file) {
      const uploaded = await uploadVideo(req.file.buffer, req.file.originalname, req.file.mimetype);
      videoUrl = uploaded.key;
      videoFilename = req.file.originalname;
      videoSize = req.file.size;
    }

    // Create campaign
    const { rows: [campaign] } = await client.query(
      `INSERT INTO campaigns 
        (name, description, webinar_title, webinar_agenda, zoom_account_id, video_url, video_filename, video_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [name, description, webinar_title, webinar_agenda, zoom_account_id, videoUrl, videoFilename, videoSize]
    );

    // Create schedule if provided
    if (schedule_days && schedule_hour !== undefined) {
      const days = Array.isArray(schedule_days) ? schedule_days.map(Number) : [Number(schedule_days)];
      
      await client.query(
        `INSERT INTO schedules (campaign_id, day_of_week, time_hour, time_minute, timezone)
         VALUES ($1, $2, $3, $4, $5)`,
        [campaign.id, days, parseInt(schedule_hour), parseInt(schedule_minute || 0), timezone || 'Asia/Kolkata']
      );
    }

    await client.query('COMMIT');

    // Trigger scheduler to create Zoom meetings immediately
    setTimeout(() => triggerForCampaign(campaign.id), 1000);

    res.json({ success: true, campaign });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create campaign error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

// ----------------------------------------
// PUT /api/campaigns/:id — Update campaign
// ----------------------------------------
router.put('/:id', upload.single('video'), async (req, res) => {
  try {
    const { name, description, webinar_title, webinar_agenda, zoom_account_id, status } = req.body;

    let videoUrl = undefined;
    let videoFilename = undefined;
    let videoSize = undefined;

    if (req.file) {
      // Get old video to delete
      const { rows: [old] } = await pool.query('SELECT video_url FROM campaigns WHERE id = $1', [req.params.id]);
      if (old?.video_url) await deleteVideo(old.video_url);

      const uploaded = await uploadVideo(req.file.buffer, req.file.originalname, req.file.mimetype);
      videoUrl = uploaded.key;
      videoFilename = req.file.originalname;
      videoSize = req.file.size;
    }

    const fields = [];
    const values = [];
    let idx = 1;

    if (name) { fields.push(`name = $${idx++}`); values.push(name); }
    if (description !== undefined) { fields.push(`description = $${idx++}`); values.push(description); }
    if (webinar_title) { fields.push(`webinar_title = $${idx++}`); values.push(webinar_title); }
    if (webinar_agenda !== undefined) { fields.push(`webinar_agenda = $${idx++}`); values.push(webinar_agenda); }
    if (zoom_account_id) { fields.push(`zoom_account_id = $${idx++}`); values.push(zoom_account_id); }
    if (status) { fields.push(`status = $${idx++}`); values.push(status); }
    if (videoUrl) {
      fields.push(`video_url = $${idx++}`); values.push(videoUrl);
      fields.push(`video_filename = $${idx++}`); values.push(videoFilename);
      fields.push(`video_size = $${idx++}`); values.push(videoSize);
    }

    fields.push(`updated_at = NOW()`);
    values.push(req.params.id);

    const { rows: [campaign] } = await pool.query(
      `UPDATE campaigns SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    res.json({ success: true, campaign });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------
// DELETE /api/campaigns/:id — Delete campaign
// ----------------------------------------
router.delete('/:id', async (req, res) => {
  try {
    const { rows: [campaign] } = await pool.query('SELECT * FROM campaigns WHERE id = $1', [req.params.id]);
    if (!campaign) return res.status(404).json({ success: false, error: 'Not found' });

    if (campaign.video_url) await deleteVideo(campaign.video_url);

    await pool.query('DELETE FROM campaigns WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Campaign deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
