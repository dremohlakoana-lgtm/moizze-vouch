require('dotenv').config();
const pool = require('../backend/config/db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Running migrations...');

    // 1. Widen account_number column to 16 chars
    await client.query(`ALTER TABLE users ALTER COLUMN account_number TYPE VARCHAR(16)`);
    console.log('✅ account_number column widened to 16 chars');

    // 2. Create invite_codes table
    await client.query(`
      CREATE TABLE IF NOT EXISTS invite_codes (
        id SERIAL PRIMARY KEY,
        code VARCHAR(20) UNIQUE NOT NULL,
        is_used BOOLEAN DEFAULT false,
        created_by INTEGER REFERENCES users(id),
        used_by INTEGER REFERENCES users(id),
        used_at TIMESTAMP,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ invite_codes table created');

    // 3. Create index
    await client.query(`CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code)`);
    console.log('✅ invite_codes index created');

    console.log('\n🎉 All migrations complete!');
  } catch (err) {
    console.error('Migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}

migrate();
