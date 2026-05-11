require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { startScheduler } = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/campaigns', require('./routes/campaigns'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/zoom-accounts', require('./routes/zoomAccounts'));

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), version: '1.0.0' });
});

app.listen(PORT, () => {
  console.log('🚀 ================================');
  console.log(`🚀  Webinar Platform Backend`);
  console.log(`🚀  Running on port ${PORT}`);
  console.log('🚀 ================================');

  startScheduler();

  // Start bot
  console.log('🤖 Starting Webinar Bot...');
  require('./services/bot');
  console.log('🤖 Webinar Bot started');
});

module.exports = app;
