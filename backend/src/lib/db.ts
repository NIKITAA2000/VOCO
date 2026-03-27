import pg from "pg";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://voco:voco_password@localhost:5432/voco_db",
});

export async function isUserInAnotherRoom(
  client: pg.PoolClient,
  userId: string,
  currentRoomId?: string
): Promise<boolean> {
  let query: string;
  let params: any[];

  if (currentRoomId) {
    // Проверка: есть ли активная сессия в другой комнате (для join)
    query = `SELECT 1 FROM participants
             WHERE user_id = $1 AND room_id != $2 AND left_at IS NULL
             LIMIT 1`;
    params = [userId, currentRoomId];
  } else {
    // Проверка: есть ли любая активная сессия (для создания комнаты)
    query = `SELECT 1 FROM participants
             WHERE user_id = $1 AND left_at IS NULL
             LIMIT 1`;
    params = [userId];
  }

  const result = await client.query(query, params);
  return result.rows.length > 0;
}

export async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Таблица пользователей
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        username VARCHAR(30) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        avatar_url TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Таблица комнат
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

      -- Единая таблица участников (активные сессии + история)
      CREATE TABLE IF NOT EXISTS participants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),  -- NULL для гостей
        room_id UUID NOT NULL REFERENCES rooms(id),
        session_id VARCHAR(100) UNIQUE NOT NULL,  -- identity в LiveKit
        display_name VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'PARTICIPANT'
          CHECK (role IN ('OWNER', 'MODERATOR', 'PARTICIPANT')),
        joined_at TIMESTAMP DEFAULT NOW(),
        left_at TIMESTAMP,  -- NULL = активная сессия
        duration_minutes INT,  -- заполняется при выходе
        is_guest BOOLEAN DEFAULT FALSE  -- флаг гостя
      );

      -- Таблица заблокированных пользователей
      CREATE TABLE IF NOT EXISTS blocked_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id UUID NOT NULL REFERENCES rooms(id),
        user_id UUID NOT NULL REFERENCES users(id),
        blocked_by UUID NOT NULL REFERENCES users(id),
        reason TEXT,
        blocked_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(room_id, user_id)
      );

      -- Таблица ссылок-приглашений
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

      -- ИНДЕКСЫ для производительности

      -- Уникальность: один пользователь — одна активная сессия в комнате
      CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_active_session
        ON participants(user_id, room_id)
        WHERE user_id IS NOT NULL AND left_at IS NULL;

      -- Быстрый поиск активных участников в комнате
      CREATE INDEX IF NOT EXISTS idx_participants_room_active
        ON participants(room_id, left_at)
        WHERE left_at IS NULL;

      -- История посещений пользователя
      CREATE INDEX IF NOT EXISTS idx_participants_user_history
        ON participants(user_id, room_id, joined_at DESC);

      -- Поиск по session_id (для кика, токенов)
      CREATE INDEX IF NOT EXISTS idx_participants_session
        ON participants(session_id);

      -- Индексы для других таблиц
      CREATE INDEX IF NOT EXISTS idx_participants_user ON participants(user_id);
      CREATE INDEX IF NOT EXISTS idx_blocked_users_room ON blocked_users(room_id, user_id);
      CREATE INDEX IF NOT EXISTS idx_invite_links_code ON invite_links(code);
      CREATE INDEX IF NOT EXISTS idx_invite_links_room ON invite_links(room_id);
    `);
    console.log("Database tables ready");
  } finally {
    client.release();
  }
}

export const db = pool;
