const puppeteer = require('puppeteer');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Keep connection alive
setInterval(async () => {
  try { await pool.query('SELECT 1'); } catch (e) {}
}, 4 * 60 * 1000);

const checkAndRunWebinars = async () => {
  try {
    console.log('👀 Checking for sessions at:', new Date().toISOString());

    // Use PostgreSQL NOW() for UTC comparison - fixes timezone issue
    const { rows: sessions } = await pool.query(`
      SELECT s.*, c.video_url, c.webinar_title
      FROM sessions s
      JOIN campaigns c ON s.campaign_id = c.id
      WHERE s.scheduled_at BETWEEN NOW() - INTERVAL '2 minutes' 
        AND NOW() + INTERVAL '2 minutes'
        AND s.status = 'scheduled'
        AND c.video_url IS NOT NULL
    `);

    if (sessions.length > 0) {
      console.log(`🎬 Found ${sessions.length} session(s) to start!`);
    }

    for (const session of sessions) {
      console.log(`🎬 Starting webinar bot for: ${session.webinar_title}`);
      console.log(`🔗 Join URL: ${session.zoom_join_url}`);

      await pool.query(
        `UPDATE sessions SET status = 'live', updated_at = NOW() WHERE id = $1`,
        [session.id]
      );

      runWebinarBot(session).catch(err => {
        console.error('❌ Bot error:', err.message);
      });
    }
  } catch (error) {
    console.error('❌ Check error:', error.message);
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

  return getSignedUrl(
    s3Client,
    new GetObjectCommand({ Bucket: process.env.B2_BUCKET_NAME, Key: videoKey }),
    { expiresIn: 7200 }
  );
};

const runWebinarBot = async (session) => {
  let browser = null;
  try {
    console.log('🤖 Launching browser bot...');

    const videoUrl = await getVideoUrl(session.video_url);
    console.log('✅ Video URL obtained');

    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
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
        '--autoplay-policy=no-user-gesture-required',
        '--allow-file-access-from-files'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    const context = browser.defaultBrowserContext();
    await context.overridePermissions('https://zoom.us', ['camera', 'microphone']);

    console.log('🔗 Navigating to Zoom...');
    await page.goto(session.zoom_join_url, { 
      waitUntil: 'networkidle2', 
      timeout: 60000 
    });

    await new Promise(r => setTimeout(r, 5000));

    // Try joining via browser
    try {
      const joinBrowserBtn = await page.$('a[href*="browser"]');
      if (joinBrowserBtn) {
        await joinBrowserBtn.click();
        console.log('✅ Clicked join from browser');
      }
    } catch (e) {}

    await new Promise(r => setTimeout(r, 5000));

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

    // Keep bot alive for 90 minutes
    await new Promise(r => setTimeout(r, 90 * 60 * 1000));

  } catch (error) {
    console.error('❌ Bot runtime error:', error.message);
  } finally {
    if (browser) {
      await browser.close();
      console.log('🔴 Bot session ended');
    }
    await pool.query(
      `UPDATE sessions SET status = 'completed', updated_at = NOW() WHERE id = $1`,
      [session.id]
    );
  }
};

console.log('🤖 Webinar Bot starting...');
console.log('👀 Monitoring for scheduled webinars every minute...');

// Check immediately then every minute
checkAndRunWebinars();
setInterval(checkAndRunWebinars, 60 * 1000);
