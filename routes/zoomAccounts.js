const express = require('express');
const router = express.Router();
const pool = require('../services/database');
const { getZoomService } = require('../services/zoom');

// GET /api/zoom-accounts — List all Zoom accounts
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, account_id, client_id, is_active, created_at FROM zoom_accounts ORDER BY created_at ASC`
    );
    res.json({ success: true, accounts: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/zoom-accounts — Add new Zoom account
router.post('/', async (req, res) => {
  try {
    const { name, account_id, client_id, client_secret } = req.body;

    // Validate credentials first
    const zoomService = getZoomService({ account_id, client_id, client_secret });
    const validation = await zoomService.validateCredentials();
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: 'Invalid Zoom credentials. Please check and try again.' });
    }

    const { rows: [account] } = await pool.query(
      `INSERT INTO zoom_accounts (name, account_id, client_id, client_secret) VALUES ($1, $2, $3, $4) RETURNING id, name, account_id, client_id, is_active, created_at`,
      [name, account_id, client_id, client_secret]
    );

    res.json({ success: true, account });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/zoom-accounts/:id — Update account
router.put('/:id', async (req, res) => {
  try {
    const { name, is_active } = req.body;
    const { rows: [account] } = await pool.query(
      `UPDATE zoom_accounts SET name = COALESCE($1, name), is_active = COALESCE($2, is_active), updated_at = NOW() WHERE id = $3 RETURNING id, name, account_id, is_active`,
      [name, is_active, req.params.id]
    );
    res.json({ success: true, account });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/zoom-accounts/:id/validate — Test credentials
router.post('/:id/validate', async (req, res) => {
  try {
    const { rows: [account] } = await pool.query('SELECT * FROM zoom_accounts WHERE id = $1', [req.params.id]);
    if (!account) return res.status(404).json({ success: false, error: 'Account not found' });

    const zoomService = getZoomService(account);
    const result = await zoomService.validateCredentials();
    res.json({ success: true, valid: result.valid });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/zoom-accounts/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM zoom_accounts WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Account removed' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
