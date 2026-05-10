const cron = require('node-cron');
const moment = require('moment-timezone');
const pool = require('./database');
const { getZoomService, getDefaultZoomService } = require('./zoom');

const startScheduler = () => {
  console.log('🕐 Scheduler starting...');
  cron.schedule('0 * * * *', async () => {
    console.log('🔄 Scheduler tick:', new Date().toISOString());
    await processUpcomingSessions();
  });
  cron.schedule('* * * * *', async () => {
    await checkLiveSessions();
  });
  setTimeout(async () => {
    await processUpcomingSessions();
  }, 3000);
  console.log('✅ Scheduler started');
};

const processUpcomingSessions = async () => {
  try {
    const { rows: schedules } = await pool.query(`
      SELECT 
        s.id as schedule_id,
        s.campaign_id,
        s.day_of_week,
        s.time_hour,
        s.time_minute,
        s.timezone,
        c.webinar_title,
        c.webinar_agenda,
        c.status as campaign_status,
        c.zoom_account_id,
        za.account_id,
        za.client_id,
        za.client_secret
      FROM schedules s
      JOIN campaigns c ON s.campaign_id = c.id
      JOIN zoom_accounts za ON c.zoom_account_id = za.id
      WHERE s.is_active = true 
        AND c.status = 'active'
        AND za.is_active = true
    `);

    if (schedules.length === 0) {
      console.log('📭 No active schedules found');
      return;
    }

    const now = moment().tz('Asia/Kolkata');
    const lookAhead = moment().tz('Asia/Kolkata').add(48, 'hours');

    for (const schedule of schedules) {
      await generateSessionsForSchedule(schedule, now, lookAhead);
    }
  } catch (error) {
    console.error('❌ Scheduler error:', error.message);
  }
};

const generateSessionsForSchedule = async (schedule, from, to) => {
  const timezone = schedule.timezone || 'Asia/Kolkata';
  const daysOfWeek = schedule.day_of_week;
  let current = moment(from).tz(timezone).startOf('day');
  const end = moment(to).tz(timezone);

  while (current.isBefore(end)) {
    const dayOfWeek = current.day();
    if (daysOfWeek.includes(dayOfWeek)) {
      const sessionTime = current.clone()
        .hour(schedule.time_hour)
        .minute(schedule.time_minute)
        .second(0);
      if (sessionTime.isAfter(moment())) {
        await ensureSessionExists(schedule, sessionTime);
      }
    }
    current.add(1, 'day');
  }
};

const ensureSessionExists = async (schedule, sessionTime) => {
  const scheduledAt = sessionTime.toISOString();
  const { rows: existing } = await pool.query(
    `SELECT id FROM sessions WHERE campaign_id = $1 AND scheduled_at = $2 AND status != 'cancelled'`,
    [schedule.campaign_id, scheduledAt]
  );
  if (existing.length > 0) return;

  try {
    // Use the zoom account from campaign, fallback to env credentials
    let zoomService;
    if (schedule.account_id && schedule.client_id && schedule.client_secret) {
      zoomService = getZoomService({
        account_id: schedule.account_id,
        client_id: schedule.client_id,
        client_secret: schedule.client_secret
      });
    } else {
      zoomService = getDefaultZoomService();
    }

    const meeting = await zoomService.createMeeting({
      title: schedule.webinar_title,
      agenda: schedule.webinar_agenda,
      scheduledAt: sessionTime.format('YYYY-MM-DDTHH:mm:ss'),
      timezone: schedule.timezone || 'Asia/Kolkata'
    });

    await pool.query(
      `INSERT INTO sessions (campaign_id, schedule_id, zoom_meeting_id, zoom_join_url, zoom_start_url, zoom_password, scheduled_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled')`,
      [schedule.campaign_id, schedule.schedule_id, meeting.meetingId, meeting.joinUrl, meeting.startUrl, meeting.password, scheduledAt]
    );

    console.log(`✅ Session created: ${sessionTime.format('ddd DD MMM YYYY HH:mm')} IST — Zoom ID: ${meeting.meetingId}`);
  } catch (error) {
    console.error(`❌ Failed to create session for ${sessionTime.format('YYYY-MM-DD HH:mm')}:`, error.message);
  }
};

const checkLiveSessions = async () => {
  try {
    const now = moment().tz('Asia/Kolkata');
    await pool.query(
      `UPDATE sessions SET status = 'live', updated_at = NOW() WHERE status = 'scheduled' AND scheduled_at BETWEEN $1 AND $2`,
      [now.clone().subtract(5, 'minutes').toISOString(), now.clone().add(5, 'minutes').toISOString()]
    );
    await pool.query(
      `UPDATE sessions SET status = 'completed', updated_at = NOW() WHERE status = 'live' AND scheduled_at < $1`,
      [now.clone().subtract(2, 'hours').toISOString()]
    );
  } catch (error) {
    console.error('❌ Live check error:', error.message);
  }
};

const triggerForCampaign = async (campaignId) => {
  try {
    const { rows: schedules } = await pool.query(`
      SELECT s.id as schedule_id, s.campaign_id, s.day_of_week, s.time_hour, s.time_minute, s.timezone,
        c.webinar_title, c.webinar_agenda, za.account_id, za.client_id, za.client_secret
      FROM schedules s
      JOIN campaigns c ON s.campaign_id = c.id
      JOIN zoom_accounts za ON c.zoom_account_id = za.id
      WHERE s.campaign_id = $1 AND s.is_active = true
    `, [campaignId]);

    const now = moment().tz('Asia/Kolkata');
    const lookAhead = moment().tz('Asia/Kolkata').add(48, 'hours');
    for (const schedule of schedules) {
      await generateSessionsForSchedule(schedule, now, lookAhead);
    }
    console.log(`✅ Manual trigger complete for campaign: ${campaignId}`);
  } catch (error) {
    console.error('❌ Manual trigger error:', error.message);
  }
};

module.exports = { startScheduler, triggerForCampaign, processUpcomingSessions };
