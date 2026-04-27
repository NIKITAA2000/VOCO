import pg from "pg";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://voco:voco_password@localhost:5432/voco_db",
});

// Проверяет, что пользователь уже в другой комнате
export async function isUserInAnotherRoom(
  client: pg.PoolClient,
  userId: string | null, // nullable для гостей
  currentRoomId?: string,
  sessionId?: string // Для гостей
): Promise<boolean> {
  if (!userId && !sessionId)
    return false;

  let query: string;
  let params: any[];

  if (sessionId) {
    // Для гостей: проверяем по session_id
    query = `SELECT 1 FROM participants WHERE session_id = $1 AND left_at IS NULL LIMIT 1`;
    params = [sessionId];
  } else if (currentRoomId) {
    // Для авторизованных: проверяем в других комнатах
    query = `SELECT 1 FROM participants WHERE user_id = $1 AND room_id != $2 AND left_at IS NULL LIMIT 1`;
    params = [userId, currentRoomId];
  } else {
    query = `SELECT 1 FROM participants WHERE user_id = $1 AND left_at IS NULL LIMIT 1`;
    params = [userId];
  }

  const result = await client.query(query, params);
  return result.rows.length > 0;
}

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

      -- Расширенная таблица participants (гости + сессии)
      CREATE TABLE IF NOT EXISTS participants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id), -- nullable для гостей
        session_id VARCHAR(100) UNIQUE NOT NULL, -- identity в LiveKit
        display_name VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'PARTICIPANT'
          CHECK (role IN ('OWNER', 'MODERATOR', 'PARTICIPANT')),
        joined_at TIMESTAMP DEFAULT NOW(),
        left_at TIMESTAMP,
        duration_minutes INT,
        is_guest BOOLEAN DEFAULT FALSE,
        UNIQUE(user_id, room_id) -- защита от дублирования авторизованных
      );

      CREATE TABLE IF NOT EXISTS blocked_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
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

      -- Индексы
      CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_active_session
        ON participants(user_id, room_id) WHERE user_id IS NOT NULL AND left_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_participants_room_active
        ON participants(room_id, left_at) WHERE left_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_participants_session ON participants(session_id);
      CREATE INDEX IF NOT EXISTS idx_blocked_users_room ON blocked_users(room_id, user_id);
      CREATE INDEX IF NOT EXISTS idx_invite_links_code ON invite_links(code);

      -- Индекс для быстрого поиска сессии при выходе
      CREATE INDEX IF NOT EXISTS idx_participants_session_lookup
        ON participants(session_id, room_id, left_at);
    `);
    console.log("Database tables ready");
  } finally {
    client.release();
  }
}

export const db = pool;
