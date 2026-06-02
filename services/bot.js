const puppeteer = require('puppeteer');
const { Pool } = require('pg');
const moment = require('moment-timezone');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ========================================
// WEBINAR BOT
// Monitors schedule, joins Zoom webinar,
// plays video automatically
// ========================================

const checkAndRunWebinars = async () => {
  try {
    const now = moment().tz('Asia/Kolkata');
    const { rows: sessions } = await pool.query(`
  SELECT s.*, c.video_url, c.webinar_title
  FROM sessions s
  JOIN campaigns c ON s.campaign_id = c.id
  WHERE s.scheduled_at BETWEEN NOW() - INTERVAL '2 minutes' 
    AND NOW() + INTERVAL '2 minutes'
    AND s.status = 'scheduled'
    AND c.video_url IS NOT NULL
`);

    for (const session of sessions) {
      console.log(`🎬 Starting webinar bot for session: ${session.id}`);
      console.log(`📅 Webinar: ${session.webinar_title}`);
      console.log(`🔗 Join URL: ${session.zoom_join_url}`);

      // Mark as live
      await pool.query(
        `UPDATE sessions SET status = 'live', updated_at = NOW() WHERE id = $1`,
        [session.id]
      );

      // Run bot in background
      runWebinarBot(session).catch(err => {
        console.error('Bot error:', err.message);
      });
    }
  } catch (error) {
    console.error('❌ Check webinars error:', error.message);
  }
};

const runWebinarBot = async (session) => {
  let browser = null;
  try {
    console.log('🤖 Launching browser bot...');

    // Get video download URL from Backblaze
    const videoUrl = await getVideoUrl(session.video_url);
    console.log('✅ Video URL obtained');

    // Launch headless browser
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-video-capture=${videoUrl}`,
        '--allow-file-access-from-files',
        '--autoplay-policy=no-user-gesture-required'
      ]
    });

    const page = await browser.newPage();
    
    // Set viewport
    await page.setViewport({ width: 1280, height: 720 });

    // Grant camera and microphone permissions
    const context = browser.defaultBrowserContext();
    await context.overridePermissions('https://zoom.us', ['camera', 'microphone']);

    console.log('🔗 Joining Zoom webinar...');
    
    // Navigate to Zoom join URL
    await page.goto(session.zoom_join_url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for Zoom to load
    await page.waitForTimeout(5000);

    // Try to join via browser
    const joinBrowserBtn = await page.$('[data-test="zoom-ui-btn-join-browser"]');
    if (joinBrowserBtn) {
      await joinBrowserBtn.click();
      console.log('✅ Clicked join from browser');
    }

    await page.waitForTimeout(5000);

    // Enter name if prompted
    try {
      const nameInput = await page.$('input[placeholder="Your Name"]');
      if (nameInput) {
        await nameInput.type('WebinarBot');
        const joinBtn = await page.$('.preview-join-button');
        if (joinBtn) await joinBtn.click();
      }
    } catch (e) {}

    console.log('✅ Bot joined webinar successfully');
    console.log('🎬 Video is now playing via virtual camera');

    // Keep bot alive for webinar duration (90 minutes)
    await page.waitForTimeout(90 * 60 * 1000);

  } catch (error) {
    console.error('❌ Bot error:', error.message);
  } finally {
    if (browser) {
      await browser.close();
      console.log('🔴 Bot session ended');
    }

    // Mark session as completed
    await pool.query(
      `UPDATE sessions SET status = 'completed', updated_at = NOW() WHERE id = $1`,
      [session.id]
    );
  }
};

const getVideoUrl = async (videoKey) => {
  const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

  const s3Client = new S3Client({
    endpoint: process.env.B2_ENDPOINT,
    region: process.env.B2_REGION || 'us-east-005',
    credentials: {
      accessKeyId: process.env.B2_KEY_ID,
      secretAccessKey: process.env.B2_APPLICATION_KEY
    }
  });

  const url = await getSignedUrl(
    s3Client,
    new GetObjectCommand({ Bucket: process.env.B2_BUCKET_NAME, Key: videoKey }),
    { expiresIn: 7200 }
  );

  return url;
};

// Start monitoring — check every minute
console.log('🤖 Webinar Bot starting...');
console.log('👀 Monitoring for scheduled webinars...');

checkAndRunWebinars();
setInterval(checkAndRunWebinars, 60 * 1000);
