import pg from "pg";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://voco:voco_password@localhost:5432/voco_db",
});

// Initialize tables on startup
export async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        username VARCHAR(30) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        avatar_url TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS rooms (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(20) UNIQUE NOT NULL,
        is_active BOOLEAN DEFAULT true,
        max_users INT DEFAULT 10,
        owner_id UUID NOT NULL REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        closed_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS participants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        room_id UUID NOT NULL REFERENCES rooms(id),
        role VARCHAR(20) DEFAULT 'PARTICIPANT',
        joined_at TIMESTAMP DEFAULT NOW(),
        left_at TIMESTAMP
      );
    `);
    console.log("Database tables ready");
  } finally {
    client.release();
  }
}

export const db = pool;
