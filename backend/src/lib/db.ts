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
        closed_at TIMESTAMP,
        allow_guests BOOLEAN DEFAULT true,
        require_approval BOOLEAN DEFAULT false
      );

      ALTER TABLE rooms ADD COLUMN IF NOT EXISTS allow_guests BOOLEAN DEFAULT true;
      ALTER TABLE rooms ADD COLUMN IF NOT EXISTS require_approval BOOLEAN DEFAULT false;

      CREATE TABLE IF NOT EXISTS participants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        room_id UUID NOT NULL REFERENCES rooms(id),
        role VARCHAR(20) DEFAULT 'PARTICIPANT',
        joined_at TIMESTAMP DEFAULT NOW(),
        left_at TIMESTAMP,
        approved BOOLEAN DEFAULT false
      );

      ALTER TABLE participants ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT false;
      UPDATE participants SET approved = true
        WHERE role IN ('OWNER', 'MODERATOR') AND approved = false;

      CREATE TABLE IF NOT EXISTS blocked_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id UUID NOT NULL REFERENCES rooms(id),
        user_id UUID NOT NULL REFERENCES users(id),
        blocked_by UUID NOT NULL REFERENCES users(id),
        reason TEXT,
        blocked_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(room_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        external_id TEXT,
        author_identity VARCHAR(120) NOT NULL,
        author_name VARCHAR(120),
        message TEXT NOT NULL DEFAULT '',
        sent_at BIGINT NOT NULL,
        is_guest BOOLEAN DEFAULT false,
        attachment_url TEXT,
        attachment_name TEXT,
        attachment_kind VARCHAR(16),
        attachment_size BIGINT,
        attachment_mime VARCHAR(160),
        created_at TIMESTAMP DEFAULT NOW()
      );

      ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS external_id TEXT;
      ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_url TEXT;
      ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_name TEXT;
      ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_kind VARCHAR(16);
      ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_size BIGINT;
      ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_mime VARCHAR(160);
      ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachments JSONB;
      ALTER TABLE chat_messages ALTER COLUMN message DROP NOT NULL;
      ALTER TABLE chat_messages ALTER COLUMN message SET DEFAULT '';
      -- Старый UNIQUE по (room_id, author_identity, sent_at) был ненадёжен:
      -- LiveKit entry.timestamp может быть Date-объектом, после save/reload
      -- значения расходились и сообщения дублировались в чате.
      ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_room_id_author_identity_sent_at_key;
      -- Чистим записи без external_id (они с старым дедупом и могут дать дубли)
      DELETE FROM chat_messages WHERE external_id IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_room_external_id_key
        ON chat_messages(room_id, external_id);

      CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id, sent_at);

      CREATE TABLE IF NOT EXISTS pinned_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        message TEXT NOT NULL DEFAULT '',
        author_identity VARCHAR(120),
        author_name VARCHAR(120),
        original_external_id TEXT,
        original_timestamp BIGINT,
        attachment_url TEXT,
        attachment_name TEXT,
        attachment_kind VARCHAR(16),
        attachment_size BIGINT,
        attachment_mime VARCHAR(160),
        pinned_by UUID NOT NULL REFERENCES users(id),
        pinned_at TIMESTAMP DEFAULT NOW()
      );

      ALTER TABLE pinned_messages ADD COLUMN IF NOT EXISTS original_external_id TEXT;
      ALTER TABLE pinned_messages ADD COLUMN IF NOT EXISTS attachment_url TEXT;
      ALTER TABLE pinned_messages ADD COLUMN IF NOT EXISTS attachment_name TEXT;
      ALTER TABLE pinned_messages ADD COLUMN IF NOT EXISTS attachment_kind VARCHAR(16);
      ALTER TABLE pinned_messages ADD COLUMN IF NOT EXISTS attachment_size BIGINT;
      ALTER TABLE pinned_messages ADD COLUMN IF NOT EXISTS attachment_mime VARCHAR(160);
      ALTER TABLE pinned_messages ADD COLUMN IF NOT EXISTS attachments JSONB;
      ALTER TABLE pinned_messages ALTER COLUMN message DROP NOT NULL;
      ALTER TABLE pinned_messages ALTER COLUMN message SET DEFAULT '';
      CREATE INDEX IF NOT EXISTS idx_pinned_messages_room ON pinned_messages(room_id, pinned_at);

      CREATE TABLE IF NOT EXISTS hidden_rooms (
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        hidden_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, room_id)
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
    `);
    console.log("Database tables ready");
  } finally {
    client.release();
  }
}

export const db = pool;
