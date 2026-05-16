console.log('🔵 [1] server.js starting');

require('dotenv').config();
console.log('🔵 [2] dotenv loaded');

const express = require('express');
console.log('🔵 [3] express loaded');

const cors = require('cors');
console.log('🔵 [4] cors loaded');

console.log('🔵 [5] About to require scheduler');
const { startScheduler } = require('./services/scheduler');
console.log('🔵 [6] Scheduler imported OK');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

console.log('🔵 [7] Middleware loaded');

app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/campaigns', require('./routes/campaigns'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/zoom-accounts', require('./routes/zoomAccounts'));

console.log('🔵 [8] Routes loaded');

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), version: '1.0.0' });
});

app.listen(PORT, () => {
  console.log('🚀 ================================');
  console.log('🚀  Webinar Platform Backend');
  console.log('🚀  Running on port ' + PORT);
  console.log('🚀 ================================');

  console.log('🔵 [9] About to start scheduler');
  try {
    startScheduler();
    console.log('🔵 [10] Scheduler started OK');
  } catch (err) {
    console.error('🔴 SCHEDULER CRASH:', err.message);
    console.error(err.stack);
  }

  console.log('🔵 [11] About to require bot');
  try {
    require('./services/bot');
    console.log('🔵 [12] Bot required OK');
  } catch (err) {
    console.error('🔴 BOT CRASH:', err.message);
    console.error(err.stack);
  }

  console.log('🔵 [13] Startup sequence complete');
});

process.on('uncaughtException', (err) => {
  console.error('🔴 UNCAUGHT EXCEPTION:', err.message);
  console.error(err.stack);
});

process.on('unhandledRejection', (err) => {
  console.error('🔴 UNHANDLED REJECTION:', err);
});

module.exports = app;