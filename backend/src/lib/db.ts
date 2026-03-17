import pg from "pg";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://voco:voco_password@localhost:5432/voco_db",
});

// Проверка: пользователь уже активен в другой комнате
async function isUserInAnotherRoom(
  client: pg.PoolClient,
  userId: string,
  currentRoomId: string
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM participants
     WHERE user_id = $1 AND room_id != $2
     LIMIT 1`,
    [userId, currentRoomId]
  );
  return result.rows.length > 0;
}

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
        user_id UUID REFERENCES users(id), -- NULL для гостей
        room_id UUID NOT NULL REFERENCES rooms(id),
        session_id VARCHAR(100) UNIQUE NOT NULL, -- Уникальный ID сессии (identity в LiveKit)
        display_name VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'PARTICIPANT' CHECK (role IN ('OWNER', 'MODERATOR', 'PARTICIPANT')),
        joined_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_room (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        room_id UUID NOT NULL REFERENCES rooms(id),
        room_slug VARCHAR(20) NOT NULL,
        room_name VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'PARTICIPANT' CHECK (role IN ('OWNER', 'MODERATOR', 'PARTICIPANT')),
        joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
        left_at TIMESTAMP,
        duration_minutes INT,
        UNIQUE(user_id, room_id, joined_at)
      );

      CREATE TABLE IF NOT EXISTS blocked_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id UUID NOT NULL REFERENCES rooms(id),
        user_id UUID NOT NULL REFERENCES users(id),
        blocked_by UUID NOT NULL REFERENCES users(id),
        reason TEXT,
        blocked_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(room_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS invite_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id UUID NOT NULL REFERENCES rooms(id),
        code VARCHAR(20) UNIQUE NOT NULL,
        created_by UUID NOT NULL REFERENCES users(id),
        expires_at TIMESTAMP,
        max_uses INT,
        uses_count INT DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        allow_guests BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Индексы для скорости
      CREATE INDEX IF NOT EXISTS idx_participants_room_session ON participants(room_id, session_id);
      CREATE INDEX IF NOT EXISTS idx_participants_user ON participants(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_room_user ON user_room(user_id);
    `);
    console.log("Database tables ready");
  } finally {
    client.release();
  }
}

export const db = pool;
