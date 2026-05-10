const axios = require('axios');

class ZoomService {
  constructor(accountId, clientId, clientSecret) {
    this.accountId = accountId;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  async getAccessToken() {
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }
    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await axios.post(
      'https://zoom.us/oauth/token',
      `grant_type=account_credentials&account_id=${this.accountId}`,
      { headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    this.accessToken = response.data.access_token;
    this.tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000;
    console.log('✅ Zoom access token obtained for account:', this.accountId);
    return this.accessToken;
  }

  async createWebinar({ title, agenda, scheduledAt, durationMinutes = 90, timezone = 'Asia/Kolkata' }) {
    const token = await this.getAccessToken();
    try {
      const response = await axios.post(
        `https://api.zoom.us/v2/users/me/webinars`,
        {
          topic: title,
          type: 5,
          start_time: scheduledAt,
          duration: durationMinutes,
          timezone,
          agenda: agenda || '',
          settings: {
            host_video: true,
            panelists_video: true,
            practice_session: false,
            hd_video: true,
            approval_type: 0,
            registration_type: 1,
            audio: 'both',
            auto_recording: 'none',
            enforce_login: false,
            close_registration: false,
            show_share_button: false,
            allow_multiple_devices: true,
            on_demand: false
          }
        },
        { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
      const w = response.data;
      console.log('✅ Zoom webinar created:', w.id);
      return {
        meetingId: w.id.toString(),
        joinUrl: w.join_url,
        startUrl: w.start_url,
        password: w.password || ''
      };
    } catch (error) {
      console.error('❌ Zoom create webinar error:', JSON.stringify(error.response?.data));
      throw error;
    }
  }

  async createMeeting(params) {
    return this.createWebinar(params);
  }

  async deleteWebinar(webinarId) {
    try {
      const token = await this.getAccessToken();
      await axios.delete(`https://api.zoom.us/v2/webinars/${webinarId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      return true;
    } catch { return false; }
  }

  async deleteMeeting(meetingId) {
    return this.deleteWebinar(meetingId);
  }

  async validateCredentials() {
    try { await this.getAccessToken(); return { valid: true }; }
    catch (e) { return { valid: false, error: e.message }; }
  }
}

const getZoomService = (account) => new ZoomService(account.account_id, account.client_id, account.client_secret);
const getDefaultZoomService = () => new ZoomService(process.env.ZOOM_ACCOUNT_ID, process.env.ZOOM_CLIENT_ID, process.env.ZOOM_CLIENT_SECRET);

module.exports = { ZoomService, getZoomService, getDefaultZoomService };
