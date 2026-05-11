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
    const TEMPLATE_ID = 'qId8cAzTSReIeLMtn6II0g';

    try {
      // First try with template
      const response = await axios.post(
        `https://api.zoom.us/v2/users/me/webinars`,
        {
          topic: title,
          type: 5,
          start_time: scheduledAt,
          duration: durationMinutes,
          timezone,
          agenda: agenda || '',
          template_id: TEMPLATE_ID,
          settings: {
            host_video: true,
            panelists_video: true,
            approval_type: 0,
            audio: 'both',
            auto_recording: 'none'
          }
        },
        { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );

      const w = response.data;
      console.log('✅ Zoom webinar created from template:', w.id);
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
