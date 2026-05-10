const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const initDB = async () => {
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS zoom_accounts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL,
        account_id VARCHAR(255) NOT NULL,
        client_id VARCHAR(255) NOT NULL,
        client_secret VARCHAR(255) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        zoom_account_id UUID REFERENCES zoom_accounts(id),
        video_url TEXT,
        video_filename VARCHAR(255),
        video_size BIGINT,
        status VARCHAR(50) DEFAULT 'active',
        webinar_title VARCHAR(255) NOT NULL,
        webinar_agenda TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS schedules (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
        day_of_week INTEGER[],
        time_hour INTEGER NOT NULL,
        time_minute INTEGER NOT NULL,
        timezone VARCHAR(100) DEFAULT 'Asia/Kolkata',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        campaign_id UUID REFERENCES campaigns(id),
        schedule_id UUID REFERENCES schedules(id),
        zoom_meeting_id VARCHAR(255),
        zoom_join_url TEXT,
        zoom_start_url TEXT,
        zoom_password VARCHAR(100),
        scheduled_at TIMESTAMP NOT NULL,
        status VARCHAR(50) DEFAULT 'scheduled',
        registrant_count INTEGER DEFAULT 0,
        attendee_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS registrants (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        session_id UUID REFERENCES sessions(id),
        campaign_id UUID REFERENCES campaigns(id),
        first_name VARCHAR(255) NOT NULL,
        last_name VARCHAR(255),
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        zoom_registrant_id VARCHAR(255),
        join_url TEXT,
        registered_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_scheduled_at ON sessions(scheduled_at);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_campaign_id ON sessions(campaign_id);`);

    // Insert default Zoom account if not exists
    await pool.query(`
      INSERT INTO zoom_accounts (name, account_id, client_id, client_secret)
      VALUES ('Primary Zoom Account', '5100910723', 'Omi3MN9SUyjF0rV0ALX0A', 'HDWieM1v0pKXx51r10r38hR8MYHWs4ah')
      ON CONFLICT DO NOTHING;
    `);

    console.log('✅ Database tables ready');
  } catch (error) {
    console.error('❌ Database init error:', error.message);
  }
};

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection error:', err.stack);
  } else {
    console.log('✅ Database connected successfully');
    release();
    initDB();
  }
});

module.exports = pool;
