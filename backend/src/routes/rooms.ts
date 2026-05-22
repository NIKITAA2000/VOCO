import { Router, Request, Response } from "express";
import { nanoid } from "nanoid";
import { AccessToken } from "livekit-server-sdk";
import { db } from "../lib/db.js";
import { authenticate } from "../middleware/auth.js";
import {
  createRoomSchema,
  updateRoomSchema,
  createInviteSchema,
  blockUserSchema,
  changeRoleSchema,
  pinMessageSchema,
  saveChatMessageSchema,
} from "../schemas/index.js";
import { config } from "../config/index.js";
import {
  roomService,
  buildMetadata,
  PARTICIPANT_STATUS_ACTIVE,
} from "../lib/livekit.js";
import { loadRoomPolls } from "../lib/polls.js";
import { loadRoomSounds, collectRoomSoundFiles } from "../lib/sounds.js";
import { unlinkByUrl as unlinkAudioByUrl } from "./sounds.js";

interface AttachmentDto {
  url: string;
  name: string;
  kind: "image" | "video" | "document";
  size: number | null;
  mime: string;
}

// Сообщения могут иметь до 5 фото/видео или до 10 документов. Хранится в JSONB-колонке
// `attachments`. Старые строки имеют одно вложение в singular-колонках — оборачиваем в массив.
function resolveAttachments(row: {
  attachments?: AttachmentDto[] | null;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentKind?: AttachmentDto["kind"] | null;
  attachmentSize?: number | string | null;
  attachmentMime?: string | null;
}): AttachmentDto[] {
  if (Array.isArray(row.attachments) && row.attachments.length > 0) {
    return row.attachments.map((a) => ({
      url: a.url,
      name: a.name,
      kind: a.kind,
      size: a.size != null ? Number(a.size) : null,
      mime: a.mime,
    }));
  }
  if (row.attachmentUrl && row.attachmentKind) {
    return [
      {
        url: row.attachmentUrl,
        name: row.attachmentName ?? "",
        kind: row.attachmentKind,
        size: row.attachmentSize != null ? Number(row.attachmentSize) : null,
        mime: row.attachmentMime ?? "",
      },
    ];
  }
  return [];
}

const router = Router();

router.use(authenticate);

// POST /api/rooms
router.post("/", async (req: Request, res: Response) => {
  try {
    const parsed = createRoomSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Ошибка валидации",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { name, maxUsers, allowGuests, requireApproval } = parsed.data;
    const slug = nanoid(10);

    const result = await db.query(
      `INSERT INTO rooms (name, slug, max_users, owner_id, allow_guests, require_approval, current_session_started_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id, name, slug, is_active AS "isActive", max_users AS "maxUsers",
                 owner_id AS "ownerId", created_at AS "createdAt",
                 allow_guests AS "allowGuests", require_approval AS "requireApproval"`,
      [name, slug, maxUsers, req.user!.userId, allowGuests, requireApproval]
    );

    const room = result.rows[0];

    // Auto-add owner as participant (уже одобрен)
    await db.query(
      "INSERT INTO participants (user_id, room_id, role, approved) VALUES ($1, $2, 'OWNER', true)",
      [req.user!.userId, room.id]
    );

    // Открываем первую сессию комнаты. Стартуем с created_at, чтобы граница
    // сессии в room_sessions совпадала с rooms.current_session_started_at.
    await db.query(
      `INSERT INTO room_sessions (room_id, started_at)
       SELECT id, current_session_started_at FROM rooms WHERE id = $1`,
      [room.id]
    );

    // Get owner info
    const ownerResult = await db.query(
      "SELECT id, username FROM users WHERE id = $1",
      [req.user!.userId]
    );

    res.status(201).json({
      message: "Комната создана",
      room: { ...room, owner: ownerResult.rows[0] },
    });
  } catch (error) {
    console.error("Create room error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// GET /api/rooms
router.get("/", async (req: Request, res: Response) => {
  try {
    const includeHidden = req.query.includeHidden === "true";

    const result = await db.query(
      `SELECT r.id, r.name, r.slug, r.is_active AS "isActive",
              r.max_users AS "maxUsers", r.owner_id AS "ownerId",
              r.created_at AS "createdAt", r.closed_at AS "closedAt",
              u.id AS "owner_id", u.username AS "owner_username",
              (SELECT COUNT(DISTINCT p.user_id) FROM participants p
               WHERE p.room_id = r.id AND p.left_at IS NULL) AS "activeCount",
              EXISTS (
                SELECT 1 FROM hidden_rooms hr
                WHERE hr.room_id = r.id AND hr.user_id = $1
              ) AS "hidden",
              (SELECT pr.role FROM participants pr
               WHERE pr.room_id = r.id AND pr.user_id = $1
               ORDER BY pr.joined_at DESC LIMIT 1) AS "myRole"
       FROM rooms r
       JOIN users u ON r.owner_id = u.id
       WHERE (r.owner_id = $1 OR EXISTS (
               SELECT 1 FROM participants pp
               WHERE pp.room_id = r.id AND pp.user_id = $1
             ))
         AND ($2 = true OR NOT EXISTS (
           SELECT 1 FROM hidden_rooms hr
           WHERE hr.room_id = r.id AND hr.user_id = $1
         ))
       ORDER BY
         CASE
           WHEN r.is_active = true AND (
             r.owner_id = $1
             OR (SELECT pr.role FROM participants pr
                 WHERE pr.room_id = r.id AND pr.user_id = $1
                 ORDER BY pr.joined_at DESC LIMIT 1) IN ('OWNER', 'MODERATOR')
           ) THEN 0
           WHEN r.is_active = true THEN 1
           ELSE 2
         END,
         r.created_at DESC`,
      [req.user!.userId, includeHidden]
    );

    const rooms = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      isActive: row.isActive,
      maxUsers: row.maxUsers,
      ownerId: row.ownerId,
      createdAt: row.createdAt,
      closedAt: row.closedAt,
      owner: { id: row.owner_id, username: row.owner_username },
      _count: { participants: parseInt(row.activeCount) },
      hidden: Boolean(row.hidden),
      myRole: row.myRole ?? null,
    }));

    res.json({ rooms });
  } catch (error) {
    console.error("List rooms error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// GET /api/rooms/:slug
router.get("/:slug", async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT r.id, r.name, r.slug, r.is_active AS "isActive",
              r.max_users AS "maxUsers", r.owner_id AS "ownerId",
              r.created_at AS "createdAt", r.closed_at AS "closedAt",
              r.allow_guests AS "allowGuests", r.require_approval AS "requireApproval",
              u.id AS "owner_id", u.username AS "owner_username"
       FROM rooms r
       JOIN users u ON r.owner_id = u.id
       WHERE r.slug = $1`,
      [req.params.slug]
    );

    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }

    const row = roomResult.rows[0];

    // Get active participants
    const participantsResult = await db.query(
      `SELECT p.id, p.role, p.joined_at AS "joinedAt",
              u.id AS "userId", u.username, u.avatar_url AS "avatarUrl"
       FROM participants p
       JOIN users u ON p.user_id = u.id
       WHERE p.room_id = $1 AND p.left_at IS NULL`,
      [row.id]
    );

    let myRole: string | null = null;
    if (row.ownerId === req.user!.userId) {
      myRole = "OWNER";
    } else {
      const myRoleResult = await db.query(
        `SELECT role FROM participants
         WHERE room_id = $1 AND user_id = $2
         ORDER BY joined_at DESC
         LIMIT 1`,
        [row.id, req.user!.userId]
      );
      myRole = myRoleResult.rows[0]?.role ?? null;
    }

    const pinsResult = await db.query(
      `SELECT id, message, author_identity AS "authorIdentity",
              author_name AS "authorName",
              original_external_id AS "originalExternalId",
              original_timestamp AS "originalTimestamp",
              attachment_url AS "attachmentUrl",
              attachment_name AS "attachmentName",
              attachment_kind AS "attachmentKind",
              attachment_size AS "attachmentSize",
              attachment_mime AS "attachmentMime",
              attachments,
              pinned_by AS "pinnedBy", pinned_at AS "pinnedAt"
       FROM pinned_messages
       WHERE room_id = $1
       ORDER BY pinned_at ASC`,
      [row.id]
    );

    const chatResult = await db.query(
      `SELECT id, external_id AS "externalId",
              author_identity AS "authorIdentity",
              author_name AS "authorName", message,
              sent_at AS "sentAt", is_guest AS "isGuest",
              attachment_url AS "attachmentUrl",
              attachment_name AS "attachmentName",
              attachment_kind AS "attachmentKind",
              attachment_size AS "attachmentSize",
              attachment_mime AS "attachmentMime",
              attachments
       FROM chat_messages
       WHERE room_id = $1
       ORDER BY sent_at ASC`,
      [row.id]
    );

    // Опросы — viewer's identity = userId зарегистрированного смотрящего.
    const polls = await loadRoomPolls(row.id, req.user!.userId);
    const { playlist, sounds } = await loadRoomSounds(row.id);

    res.json({
      room: {
        id: row.id,
        name: row.name,
        slug: row.slug,
        isActive: row.isActive,
        maxUsers: row.maxUsers,
        ownerId: row.ownerId,
        createdAt: row.createdAt,
        closedAt: row.closedAt,
        allowGuests: row.allowGuests,
        requireApproval: row.requireApproval,
        owner: { id: row.owner_id, username: row.owner_username },
        myRole,
        participants: participantsResult.rows.map((p) => ({
          id: p.id,
          role: p.role,
          joinedAt: p.joinedAt,
          user: { id: p.userId, username: p.username, avatarUrl: p.avatarUrl },
        })),
        pinnedMessages: pinsResult.rows.map((p) => ({
          id: p.id,
          message: p.message ?? "",
          authorIdentity: p.authorIdentity,
          authorName: p.authorName,
          originalExternalId: p.originalExternalId,
          originalTimestamp: p.originalTimestamp != null ? Number(p.originalTimestamp) : null,
          attachments: resolveAttachments(p),
          pinnedBy: p.pinnedBy,
          pinnedAt: p.pinnedAt,
        })),
        chatHistory: chatResult.rows.map((m) => ({
          id: m.id,
          externalId: m.externalId,
          authorIdentity: m.authorIdentity,
          authorName: m.authorName,
          message: m.message ?? "",
          sentAt: Number(m.sentAt),
          isGuest: m.isGuest,
          attachments: resolveAttachments(m),
        })),
        polls,
        playlist,
        sounds,
      },
    });
  } catch (error) {
    console.error("Get room error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// POST /api/rooms/:slug/join
router.post("/:slug/join", async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id, name, slug, is_active AS "isActive", max_users AS "maxUsers",
              owner_id AS "ownerId", require_approval AS "requireApproval"
       FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );

    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }

    const room = roomResult.rows[0];

    if (!room.isActive) {
      res.status(400).json({ error: "Комната закрыта" });
      return;
    }

    // Check if blocked
    const blockedResult = await db.query(
      "SELECT id FROM blocked_users WHERE room_id = $1 AND user_id = $2",
      [room.id, req.user!.userId]
    );
    if (blockedResult.rows.length > 0) {
      res.status(403).json({ error: "Вы заблокированы в этой комнате" });
      return;
    }

    // Check if already in room
    const existingResult = await db.query(
      "SELECT id FROM participants WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
      [req.user!.userId, room.id]
    );
    const alreadyInRoom = existingResult.rows.length > 0;

    if (!alreadyInRoom) {
      // Count active participants
      const countResult = await db.query(
        "SELECT COUNT(DISTINCT user_id) AS count FROM participants WHERE room_id = $1 AND left_at IS NULL",
        [room.id]
      );

      if (parseInt(countResult.rows[0].count) >= room.maxUsers) {
        res.status(400).json({ error: "Комната заполнена" });
        return;
      }

      // Сохраняем роль если пользователь уже был в комнате (MODERATOR не теряется после rejoin)
      const lastRoleResult = await db.query(
        "SELECT role FROM participants WHERE user_id = $1 AND room_id = $2 ORDER BY joined_at DESC LIMIT 1",
        [req.user!.userId, room.id]
      );
      const lastRole = lastRoleResult.rows[0]?.role;
      const role =
        room.ownerId === req.user!.userId
          ? "OWNER"
          : lastRole === "MODERATOR"
          ? "MODERATOR"
          : "PARTICIPANT";
      await db.query(
        "INSERT INTO participants (user_id, room_id, role) VALUES ($1, $2, $3)",
        [req.user!.userId, room.id, role]
      );
    }

    // Get participant role for LiveKit grants
    const roleResult = await db.query(
      "SELECT role FROM participants WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL ORDER BY joined_at DESC LIMIT 1",
      [req.user!.userId, room.id]
    );
    const participantRole = roleResult.rows[0]?.role ?? "PARTICIPANT";
    const canPublishData = participantRole === "OWNER" || participantRole === "MODERATOR";

    // Pending: только для неprivileged участников, которые ранее не были одобрены
    // в этой комнате. approved=true сохраняется между сессиями (даже после /leave),
    // так что повторный вход одобренного юзера не требует нового approval.
    // Сбрасывается только при reject модератором или при создании новой строки
    // после жёсткого reject'а.
    const isPrivileged = participantRole === "OWNER" || participantRole === "MODERATOR";
    let wasApproved = false;
    if (room.requireApproval && !isPrivileged) {
      const approvedResult = await db.query(
        "SELECT 1 FROM participants WHERE user_id = $1 AND room_id = $2 AND approved = true LIMIT 1",
        [req.user!.userId, room.id],
      );
      wasApproved = approvedResult.rows.length > 0;
    }
    const isPending = room.requireApproval && !isPrivileged && !wasApproved;

    const { displayName } = req.body ?? {};
    const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
      identity: req.user!.userId,
      name: displayName || req.user!.username,
      metadata: buildMetadata({
        status: isPending ? "pending" : PARTICIPANT_STATUS_ACTIVE,
        role: participantRole as any,
      }),
    });

    at.addGrant({
      roomJoin: true,
      room: room.slug,
      canPublish: !isPending,
      canSubscribe: !isPending,
      canPublishData: isPending ? false : canPublishData,
      canUpdateOwnMetadata: !isPending,
    });

    const livekitToken = await at.toJwt();

    const livekitUrl = config.livekit.publicUrl || config.livekit.url;

    res.json({
      message: isPending ? "Запрос отправлен модератору" : "Присоединились к комнате",
      token: livekitToken,
      livekitUrl,
      pending: isPending,
      room: { id: room.id, name: room.name, slug: room.slug },
    });
  } catch (error) {
    console.error("Join room error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// POST /api/rooms/:slug/leave
router.post("/:slug/leave", async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      "SELECT id FROM rooms WHERE slug = $1",
      [req.params.slug]
    );

    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }

    await db.query(
      `UPDATE participants
         SET left_at = NOW(), approved = false
       WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL`,
      [req.user!.userId, roomResult.rows[0].id]
    );
    // Сбрасываем все исторические approved=true — следующий вход потребует нового подтверждения
    await db.query(
      `UPDATE participants
         SET approved = false
       WHERE user_id = $1 AND room_id = $2 AND approved = true`,
      [req.user!.userId, roomResult.rows[0].id]
    );

    res.json({ message: "Вы покинули комнату" });
  } catch (error) {
    console.error("Leave room error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// POST /api/rooms/:slug/invite — создать ссылку-приглашение (owner или moderator)
router.post("/:slug/invite", async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );

    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }

    const room = roomResult.rows[0];

    const isOwner = room.ownerId === req.user!.userId;
    let isModerator = false;
    if (!isOwner) {
      const roleResult = await db.query(
        "SELECT role FROM participants WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
        [req.user!.userId, room.id]
      );
      isModerator = roleResult.rows[0]?.role === "MODERATOR";
    }
    if (!isOwner && !isModerator) {
      res.status(403).json({ error: "Только владелец или модератор может создавать ссылки-приглашения" });
      return;
    }

    const parsed = createInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Ошибка валидации", details: parsed.error.flatten().fieldErrors });
      return;
    }

    const { expiresAt, maxUses, allowGuests } = parsed.data;
    const code = nanoid(8);

    const result = await db.query(
      `INSERT INTO invite_links (room_id, code, created_by, expires_at, max_uses, allow_guests)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, code, expires_at AS "expiresAt", max_uses AS "maxUses",
                 uses_count AS "usesCount", is_active AS "isActive",
                 allow_guests AS "allowGuests", created_at AS "createdAt"`,
      [room.id, code, req.user!.userId, expiresAt ?? null, maxUses ?? null, allowGuests]
    );

    res.status(201).json({ message: "Ссылка-приглашение создана", invite: result.rows[0] });
  } catch (error) {
    console.error("Create invite error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// GET /api/rooms/:slug/invites — список ссылок-приглашений (owner или moderator)
router.get("/:slug/invites", async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );

    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }

    const room = roomResult.rows[0];

    const isOwner = room.ownerId === req.user!.userId;
    let isModerator = false;
    if (!isOwner) {
      const roleResult = await db.query(
        "SELECT role FROM participants WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
        [req.user!.userId, room.id]
      );
      isModerator = roleResult.rows[0]?.role === "MODERATOR";
    }
    if (!isOwner && !isModerator) {
      res.status(403).json({ error: "Только владелец или модератор может просматривать ссылки-приглашения" });
      return;
    }

    const result = await db.query(
      `SELECT id, code, expires_at AS "expiresAt", max_uses AS "maxUses",
              uses_count AS "usesCount", is_active AS "isActive",
              allow_guests AS "allowGuests", created_at AS "createdAt"
       FROM invite_links
       WHERE room_id = $1
       ORDER BY created_at DESC`,
      [room.id]
    );

    res.json({ invites: result.rows });
  } catch (error) {
    console.error("List invites error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// DELETE /api/rooms/:slug/invite/:code — деактивировать ссылку (owner или moderator)
router.delete("/:slug/invite/:code", async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );

    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }

    const room = roomResult.rows[0];

    const isOwner = room.ownerId === req.user!.userId;
    let isModerator = false;
    if (!isOwner) {
      const roleResult = await db.query(
        "SELECT role FROM participants WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
        [req.user!.userId, room.id]
      );
      isModerator = roleResult.rows[0]?.role === "MODERATOR";
    }
    if (!isOwner && !isModerator) {
      res.status(403).json({ error: "Только владелец или модератор может деактивировать ссылки-приглашения" });
      return;
    }

    const inviteResult = await db.query(
      `UPDATE invite_links SET is_active = false
       WHERE code = $1 AND room_id = $2
       RETURNING id`,
      [req.params.code, room.id]
    );

    if (inviteResult.rows.length === 0) {
      res.status(404).json({ error: "Ссылка-приглашение не найдена" });
      return;
    }

    res.json({ message: "Ссылка-приглашение деактивирована" });
  } catch (error) {
    console.error("Deactivate invite error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// POST /api/rooms/:slug/block — заблокировать участника (owner или moderator)
router.post("/:slug/block", async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );
    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }
    const room = roomResult.rows[0];

    const authResult = await db.query(
      "SELECT role FROM participants WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
      [req.user!.userId, room.id]
    );
    const requesterRole = authResult.rows[0]?.role;
    if (requesterRole !== "OWNER" && requesterRole !== "MODERATOR") {
      res.status(403).json({ error: "Недостаточно прав" });
      return;
    }

    const parsed = blockUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Ошибка валидации", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const { userId, reason } = parsed.data;

    if (userId === req.user!.userId) {
      res.status(400).json({ error: "Нельзя заблокировать самого себя" });
      return;
    }
    if (userId === room.ownerId) {
      res.status(400).json({ error: "Нельзя заблокировать владельца комнаты" });
      return;
    }

    await db.query(
      `INSERT INTO blocked_users (room_id, user_id, blocked_by, reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (room_id, user_id) DO NOTHING`,
      [room.id, userId, req.user!.userId, reason ?? null]
    );

    // Выкидываем из комнаты если сейчас внутри и сбрасываем все исторические
    // approved=true — после разбана участник должен заново пройти подтверждение
    // в комнатах с require_approval=true (см. /leave и /reject — та же логика).
    await db.query(
      `UPDATE participants
         SET left_at = NOW(), approved = false
       WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL`,
      [userId, room.id]
    );
    await db.query(
      `UPDATE participants
         SET approved = false
       WHERE user_id = $1 AND room_id = $2 AND approved = true`,
      [userId, room.id]
    );

    // Принудительно отключаем от LiveKit (если активно подключён)
    try {
      await roomService.removeParticipant(req.params.slug as string, userId);
    } catch {
      // участник мог быть не подключён к LiveKit — это не ошибка
    }

    res.json({ message: "Пользователь заблокирован" });
  } catch (error) {
    console.error("Block user error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// DELETE /api/rooms/:slug/block/:userId — разблокировать (owner или moderator)
router.delete("/:slug/block/:userId", async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );
    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }
    const room = roomResult.rows[0];

    const authResult = await db.query(
      "SELECT role FROM participants WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
      [req.user!.userId, room.id]
    );
    const requesterRole = authResult.rows[0]?.role;
    if (requesterRole !== "OWNER" && requesterRole !== "MODERATOR") {
      res.status(403).json({ error: "Недостаточно прав" });
      return;
    }

    const deleteResult = await db.query(
      "DELETE FROM blocked_users WHERE room_id = $1 AND user_id = $2 RETURNING id",
      [room.id, req.params.userId]
    );
    if (deleteResult.rows.length === 0) {
      res.status(404).json({ error: "Пользователь не заблокирован в этой комнате" });
      return;
    }

    res.json({ message: "Пользователь разблокирован" });
  } catch (error) {
    console.error("Unblock user error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// GET /api/rooms/:slug/blocked — список заблокированных (owner или moderator)
router.get("/:slug/blocked", async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );
    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }
    const room = roomResult.rows[0];

    const authResult = await db.query(
      "SELECT role FROM participants WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
      [req.user!.userId, room.id]
    );
    const requesterRole = authResult.rows[0]?.role;
    if (requesterRole !== "OWNER" && requesterRole !== "MODERATOR") {
      res.status(403).json({ error: "Недостаточно прав" });
      return;
    }

    const result = await db.query(
      `SELECT bu.id, bu.reason, bu.blocked_at AS "blockedAt",
              u.id AS "userId", u.username, u.avatar_url AS "avatarUrl",
              b.username AS "blockedByUsername"
       FROM blocked_users bu
       JOIN users u ON bu.user_id = u.id
       JOIN users b ON bu.blocked_by = b.id
       WHERE bu.room_id = $1
       ORDER BY bu.blocked_at DESC`,
      [room.id]
    );

    res.json({
      blocked: result.rows.map((row) => ({
        id: row.id,
        reason: row.reason,
        blockedAt: row.blockedAt,
        user: { id: row.userId, username: row.username, avatarUrl: row.avatarUrl },
        blockedBy: { username: row.blockedByUsername },
      })),
    });
  } catch (error) {
    console.error("List blocked error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// PATCH /api/rooms/:slug/participants/:userId/role — изменить роль (только owner)
router.patch("/:slug/participants/:userId/role", async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );
    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }
    const room = roomResult.rows[0];

    if (room.ownerId !== req.user!.userId) {
      res.status(403).json({ error: "Только владелец может изменять роли" });
      return;
    }
    if (req.params.userId === req.user!.userId) {
      res.status(400).json({ error: "Нельзя изменить собственную роль" });
      return;
    }

    const parsed = changeRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Ошибка валидации", details: parsed.error.flatten().fieldErrors });
      return;
    }

    const updateResult = await db.query(
      `UPDATE participants SET role = $1
       WHERE user_id = $2 AND room_id = $3
       RETURNING id`,
      [parsed.data.role, req.params.userId, room.id]
    );
    if (updateResult.rows.length === 0) {
      res.status(404).json({ error: "Участник не найден в комнате" });
      return;
    }

    // Синхронизируем роль в LiveKit-метаданных, чтобы все клиенты (включая гостей)
    // увидели изменение немедленно — иначе пришлось бы ждать переподключения.
    try {
      await roomService.updateParticipant(req.params.slug as string, req.params.userId as string, {
        metadata: buildMetadata({
          status: PARTICIPANT_STATUS_ACTIVE,
          role: parsed.data.role,
        }),
      });
    } catch {
      // участник может быть оффлайн в LiveKit — не критично, при следующем join
      // токен уже выпустится с новой ролью
    }

    res.json({ message: "Роль обновлена" });
  } catch (error) {
    console.error("Change role error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// Общая проверка доступа: владелец комнаты или модератор. Возвращает строку
// комнаты при успехе либо отправляет 403/404 и возвращает null.
async function loadRoomForOwnerOrModerator(
  req: Request,
  res: Response
): Promise<any | null> {
  const roomResult = await db.query(
    `SELECT r.id, r.name, r.slug, r.is_active AS "isActive",
            r.max_users AS "maxUsers", r.owner_id AS "ownerId",
            r.created_at AS "createdAt", r.closed_at AS "closedAt",
            r.current_session_started_at AS "sessionStartedAt",
            u.id AS "owner_id", u.username AS "owner_username"
     FROM rooms r
     JOIN users u ON r.owner_id = u.id
     WHERE r.slug = $1`,
    [req.params.slug]
  );

  if (roomResult.rows.length === 0) {
    res.status(404).json({ error: "Комната не найдена" });
    return null;
  }

  const room = roomResult.rows[0];

  if (room.ownerId !== req.user!.userId) {
    const roleResult = await db.query(
      `SELECT role FROM participants
       WHERE room_id = $1 AND user_id = $2
       ORDER BY joined_at DESC
       LIMIT 1`,
      [room.id, req.user!.userId]
    );
    const role = roleResult.rows[0]?.role;
    if (role !== "MODERATOR") {
      res.status(403).json({ error: "Нет доступа к отчёту" });
      return null;
    }
  }

  return room;
}

// GET /api/rooms/:slug/sessions — список завершённых сессий комнаты
// (только владелец/модератор). Используется выпадашкой «отчёт» на дашборде,
// чтобы выбрать, за какую сессию качать PDF. Открытые (ended_at IS NULL)
// сессии не отдаём — отчёт по ним всё равно недоступен.
router.get("/:slug/sessions", async (req: Request, res: Response) => {
  try {
    const room = await loadRoomForOwnerOrModerator(req, res);
    if (!room) return;

    const result = await db.query(
      `SELECT id, started_at AS "startedAt", ended_at AS "endedAt"
       FROM room_sessions
       WHERE room_id = $1 AND ended_at IS NOT NULL
       ORDER BY started_at DESC`,
      [room.id]
    );

    res.json({
      sessions: result.rows.map((row: any) => ({
        id: row.id,
        startedAt: new Date(row.startedAt).toISOString(),
        endedAt: new Date(row.endedAt).toISOString(),
      })),
    });
  } catch (error) {
    console.error("List sessions error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// GET /api/rooms/:slug/report — отчёт о сессии (только владелец/модератор).
// Без query — последняя сессия (только если комната закрыта).
// С ?sessionId=<uuid> — отчёт по указанной завершённой сессии (можно вызывать
// и для активной комнаты — старые завершённые сессии всё равно доступны).
router.get("/:slug/report", async (req: Request, res: Response) => {
  try {
    const room = await loadRoomForOwnerOrModerator(req, res);
    if (!room) return;

    const sessionIdParam = typeof req.query.sessionId === "string"
      ? req.query.sessionId
      : undefined;

    let sessionStart: Date;
    let sessionEnd: Date;

    if (sessionIdParam) {
      const sessionResult = await db.query(
        `SELECT started_at AS "startedAt", ended_at AS "endedAt"
         FROM room_sessions
         WHERE id = $1 AND room_id = $2`,
        [sessionIdParam, room.id]
      );
      if (sessionResult.rows.length === 0) {
        res.status(404).json({ error: "Сессия не найдена" });
        return;
      }
      const row = sessionResult.rows[0];
      if (!row.endedAt) {
        res.status(400).json({
          error: "Отчёт доступен только по завершённой сессии",
        });
        return;
      }
      sessionStart = new Date(row.startedAt);
      sessionEnd = new Date(row.endedAt);
    } else {
      if (room.isActive) {
        res.status(400).json({
          error: "Отчёт доступен только после закрытия комнаты",
        });
        return;
      }
      // Окно последней сессии: [sessionStartedAt, closedAt].
      // sessionStartedAt всегда заполнен миграцией (для старых строк = created_at),
      // closedAt — закрытая комната гарантирует, что он не NULL.
      sessionStart = new Date(room.sessionStartedAt ?? room.createdAt);
      sessionEnd = new Date(room.closedAt);
    }

    // В отчёт попадают только те участники, чьи сессии (joined_at..left_at)
    // пересеклись с окном последней сессии комнаты.
    const sessionsResult = await db.query(
      `SELECT p.user_id AS "userId", p.role, p.joined_at AS "joinedAt", p.left_at AS "leftAt",
              u.username, u.email
       FROM participants p
       JOIN users u ON p.user_id = u.id
       WHERE p.room_id = $1
         AND p.joined_at < $3
         AND (p.left_at IS NULL OR p.left_at > $2)
       ORDER BY p.joined_at ASC`,
      [room.id, sessionStart, sessionEnd]
    );

    type Session = {
      userId: string;
      role: string;
      joinedAt: Date;
      leftAt: Date | null;
      username: string;
      email: string;
    };

    // Подрезаем joined_at / left_at по окну сессии — участник, заходивший раньше
    // restore-а, в окне видится как «зашёл в момент sessionStart»; тот, кто не
    // успел выйти до закрытия, — как «вышел в момент sessionEnd».
    const sessions: Session[] = sessionsResult.rows.map((row: any) => {
      const rawJoined = new Date(row.joinedAt);
      const rawLeft = row.leftAt ? new Date(row.leftAt) : null;
      const joinedAt = rawJoined < sessionStart ? sessionStart : rawJoined;
      const leftAt = !rawLeft || rawLeft > sessionEnd ? sessionEnd : rawLeft;
      return {
        userId: row.userId,
        role: row.role,
        joinedAt,
        leftAt,
        username: row.username,
        email: row.email,
      };
    });

    // Aggregate by user
    const byUser = new Map<string, {
      userId: string;
      username: string;
      email: string;
      roles: Set<string>;
      sessions: { joinedAt: Date; leftAt: Date | null }[];
      totalMs: number;
    }>();

    for (const s of sessions) {
      const end = s.leftAt ?? sessionEnd;
      const durationMs = Math.max(0, end.getTime() - s.joinedAt.getTime());
      const existing = byUser.get(s.userId);
      if (existing) {
        existing.roles.add(s.role);
        existing.sessions.push({ joinedAt: s.joinedAt, leftAt: s.leftAt });
        existing.totalMs += durationMs;
      } else {
        byUser.set(s.userId, {
          userId: s.userId,
          username: s.username,
          email: s.email,
          roles: new Set([s.role]),
          sessions: [{ joinedAt: s.joinedAt, leftAt: s.leftAt }],
          totalMs: durationMs,
        });
      }
    }

    // Peak concurrent unique users via event timeline.
    // A single user can have overlapping sessions after reconnects, so count
    // active user ids instead of raw participant session rows.
    const events: { time: number; delta: number; userId: string }[] = [];
    for (const s of sessions) {
      const end = s.leftAt ?? sessionEnd;
      events.push({ time: s.joinedAt.getTime(), delta: 1, userId: s.userId });
      events.push({ time: end.getTime(), delta: -1, userId: s.userId });
    }
    events.sort((a, b) => a.time - b.time || a.delta - b.delta);
    let peak = 0;
    const activeUsers = new Map<string, number>();
    for (const e of events) {
      const current = activeUsers.get(e.userId) ?? 0;
      const next = current + e.delta;
      if (next > 0) {
        activeUsers.set(e.userId, next);
      } else {
        activeUsers.delete(e.userId);
      }
      if (activeUsers.size > peak) peak = activeUsers.size;
    }

    const participants = Array.from(byUser.values()).map((u) => ({
      userId: u.userId,
      username: u.username,
      email: u.email,
      wasModerator: u.roles.has("MODERATOR") || u.roles.has("OWNER"),
      roles: Array.from(u.roles),
      sessions: u.sessions.map((s) => ({
        joinedAt: s.joinedAt.toISOString(),
        leftAt: s.leftAt ? s.leftAt.toISOString() : null,
      })),
      totalMs: u.totalMs,
    }));

    // В отчёте «Начало» = начало последней сессии (а не первое создание комнаты),
    // «Завершение» = closed_at, длительность — между ними.
    const durationMs = Math.max(0, sessionEnd.getTime() - sessionStart.getTime());

    res.json({
      report: {
        room: {
          id: room.id,
          name: room.name,
          slug: room.slug,
          isActive: room.isActive,
          createdAt: sessionStart.toISOString(),
          closedAt: sessionEnd.toISOString(),
          durationMs,
          owner: { id: room.owner_id, username: room.owner_username },
        },
        peakConcurrent: peak,
        participants,
      },
    });
  } catch (error) {
    console.error("Room report error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// PATCH /api/rooms/:slug — обновить настройки комнаты (только владелец)
router.patch("/:slug", async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );
    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }
    const room = roomResult.rows[0];

    if (room.ownerId !== req.user!.userId) {
      res.status(403).json({ error: "Только владелец может изменять настройки" });
      return;
    }

    const parsed = updateRoomSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Ошибка валидации",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (parsed.data.name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(parsed.data.name);
    }
    if (parsed.data.maxUsers !== undefined) {
      updates.push(`max_users = $${idx++}`);
      values.push(parsed.data.maxUsers);
    }
    if (parsed.data.allowGuests !== undefined) {
      updates.push(`allow_guests = $${idx++}`);
      values.push(parsed.data.allowGuests);
    }
    if (parsed.data.requireApproval !== undefined) {
      updates.push(`require_approval = $${idx++}`);
      values.push(parsed.data.requireApproval);
    }

    values.push(room.id);
    const result = await db.query(
      `UPDATE rooms SET ${updates.join(", ")}
       WHERE id = $${idx}
       RETURNING id, name, slug, is_active AS "isActive", max_users AS "maxUsers",
                 owner_id AS "ownerId", created_at AS "createdAt", closed_at AS "closedAt",
                 allow_guests AS "allowGuests", require_approval AS "requireApproval"`,
      values
    );

    res.json({ room: result.rows[0] });
  } catch (error) {
    console.error("Update room error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// POST /api/rooms/:slug/restore — восстановить закрытую комнату (владелец или модератор)
router.post("/:slug/restore", async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );

    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }

    const room = roomResult.rows[0];

    if (room.ownerId !== req.user!.userId) {
      const roleResult = await db.query(
        `SELECT role FROM participants
         WHERE room_id = $1 AND user_id = $2
         ORDER BY joined_at DESC
         LIMIT 1`,
        [room.id, req.user!.userId]
      );
      const role = roleResult.rows[0]?.role;
      if (role !== "MODERATOR") {
        res.status(403).json({ error: "Только владелец или модератор может восстановить комнату" });
        return;
      }
    }

    // Восстановление открывает новую сессию: сдвигаем current_session_started_at
    // на текущий момент. Прошлые сессии остаются в room_sessions — отчёт можно
    // выгрузить по любой из них.
    const result = await db.query(
      `UPDATE rooms SET is_active = true, closed_at = NULL, current_session_started_at = NOW()
       WHERE id = $1
       RETURNING id, name, slug, is_active AS "isActive", max_users AS "maxUsers",
                 owner_id AS "ownerId", created_at AS "createdAt", closed_at AS "closedAt",
                 allow_guests AS "allowGuests", require_approval AS "requireApproval"`,
      [room.id]
    );

    await db.query(
      `INSERT INTO room_sessions (room_id, started_at)
       SELECT id, current_session_started_at FROM rooms WHERE id = $1`,
      [room.id]
    );

    res.json({ room: result.rows[0], message: "Комната восстановлена" });
  } catch (error) {
    console.error("Restore room error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// POST /api/rooms/:slug/approve/:identity — одобрить ожидающего (owner или moderator)
router.post("/:slug/approve/:identity", async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id, slug, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );
    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }
    const room = roomResult.rows[0];

    const authResult = await db.query(
      "SELECT role FROM participants WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
      [req.user!.userId, room.id]
    );
    const requesterRole = authResult.rows[0]?.role;
    if (requesterRole !== "OWNER" && requesterRole !== "MODERATOR") {
      res.status(403).json({ error: "Недостаточно прав" });
      return;
    }

    const identity = String(req.params.identity);
    const isGuest = identity.startsWith("guest_");
    let approvedRole: "OWNER" | "MODERATOR" | "PARTICIPANT" = "PARTICIPANT";
    if (!isGuest) {
      const roleResult = await db.query(
        `SELECT role FROM participants WHERE user_id = $1 AND room_id = $2
         ORDER BY joined_at DESC LIMIT 1`,
        [identity, room.id],
      );
      const r = roleResult.rows[0]?.role;
      if (r === "OWNER" || r === "MODERATOR") approvedRole = r;
    }
    await roomService.updateParticipant(room.slug, identity, {
      metadata: buildMetadata({
        status: PARTICIPANT_STATUS_ACTIVE,
        isGuest,
        role: approvedRole,
      }),
      permission: {
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        canUpdateMetadata: true,
        hidden: false,
      },
    });

    // Запоминаем approval в БД, чтобы повторный вход не требовал нового подтверждения
    if (!isGuest) {
      await db.query(
        "UPDATE participants SET approved = true WHERE user_id = $1 AND room_id = $2",
        [identity, room.id],
      );
    }

    res.json({ message: "Участник одобрен" });
  } catch (error) {
    console.error("Approve participant error:", error);
    res.status(500).json({ error: "Не удалось одобрить участника" });
  }
});

// POST /api/rooms/:slug/reject/:identity — отклонить ожидающего (owner или moderator)
router.post("/:slug/reject/:identity", async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id, slug, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );
    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }
    const room = roomResult.rows[0];

    const authResult = await db.query(
      "SELECT role FROM participants WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
      [req.user!.userId, room.id]
    );
    const requesterRole = authResult.rows[0]?.role;
    if (requesterRole !== "OWNER" && requesterRole !== "MODERATOR") {
      res.status(403).json({ error: "Недостаточно прав" });
      return;
    }

    const identity = String(req.params.identity);
    // Снимаем активную запись и сбрасываем все исторические approved — отказ должен снять
    // ранее выданное подтверждение, иначе rejected сможет вернуться без очереди
    if (!identity.startsWith("guest_")) {
      await db.query(
        "UPDATE participants SET left_at = NOW() WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
        [identity, room.id]
      );
      await db.query(
        "UPDATE participants SET approved = false WHERE user_id = $1 AND room_id = $2 AND approved = true",
        [identity, room.id]
      );
    }

    await roomService.removeParticipant(room.slug, identity);

    res.json({ message: "Участнику отказано" });
  } catch (error) {
    console.error("Reject participant error:", error);
    res.status(500).json({ error: "Не удалось отклонить участника" });
  }
});

// POST /api/rooms/:slug/messages — сохранить сообщение чата
// Любой авторизованный участник может вызывать; идемпотентен по (room_id, author_identity, sent_at).
// Авторизованные клиенты вызывают это для каждого нового сообщения в `useChat`,
// включая чужие — чтобы гарантированно сохранить сообщения гостей (у них нет Bearer).
router.post("/:slug/messages", async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );
    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }
    const room = roomResult.rows[0];

    const authResult = await db.query(
      "SELECT 1 FROM participants WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
      [req.user!.userId, room.id]
    );
    if (authResult.rows.length === 0) {
      res.status(403).json({ error: "Вы не в этой комнате" });
      return;
    }

    const parsed = saveChatMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Ошибка валидации", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const {
      externalId,
      message,
      authorIdentity,
      authorName,
      sentAt,
      isGuest,
      attachment,
      attachments,
    } = parsed.data;

    // Группа вложений едет как массив. Для обратной совместимости с однотипным
    // back-compat-path принимаем и `attachment` (одиночный) — оборачиваем в массив.
    const finalAttachments =
      attachments && attachments.length > 0
        ? attachments
        : attachment
          ? [attachment]
          : [];
    const first = finalAttachments[0];

    const inserted = await db.query(
      `INSERT INTO chat_messages (
         room_id, external_id, author_identity, author_name, message, sent_at, is_guest,
         attachment_url, attachment_name, attachment_kind, attachment_size, attachment_mime,
         attachments
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (room_id, external_id) DO NOTHING
       RETURNING id`,
      [
        room.id,
        externalId,
        authorIdentity,
        authorName ?? null,
        message ?? "",
        sentAt,
        isGuest,
        first?.url ?? null,
        first?.name ?? null,
        first?.kind ?? null,
        first?.size ?? null,
        first?.mime ?? null,
        finalAttachments.length > 0 ? JSON.stringify(finalAttachments) : null,
      ]
    );

    res.status(201).json({ saved: (inserted.rowCount ?? 0) > 0 });
  } catch (error) {
    console.error("Save chat message error:", error);
    res.status(500).json({ error: "Не удалось сохранить сообщение" });
  }
});

// DELETE /api/rooms/:slug/messages — очистить весь чат (owner или moderator)
router.delete("/:slug/messages", async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );
    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }
    const room = roomResult.rows[0];

    const authResult = await db.query(
      "SELECT role FROM participants WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
      [req.user!.userId, room.id]
    );
    const requesterRole = authResult.rows[0]?.role;
    if (requesterRole !== "OWNER" && requesterRole !== "MODERATOR") {
      res.status(403).json({ error: "Недостаточно прав" });
      return;
    }

    await db.query(`DELETE FROM chat_messages WHERE room_id = $1`, [room.id]);
    // При очистке чата сбрасываем и закрепления — они становятся «пустыми ссылками»
    await db.query(`DELETE FROM pinned_messages WHERE room_id = $1`, [room.id]);
    // И опросы тоже — они часть чата (CASCADE снесёт options и votes)
    await db.query(`DELETE FROM chat_polls WHERE room_id = $1`, [room.id]);
    res.json({ message: "Чат очищен" });
  } catch (error) {
    console.error("Clear chat error:", error);
    res.status(500).json({ error: "Не удалось очистить чат" });
  }
});

// POST /api/rooms/:slug/pins — закрепить сообщение (owner или moderator)
router.post("/:slug/pins", async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );
    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }
    const room = roomResult.rows[0];

    const authResult = await db.query(
      "SELECT role FROM participants WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
      [req.user!.userId, room.id]
    );
    const requesterRole = authResult.rows[0]?.role;
    if (requesterRole !== "OWNER" && requesterRole !== "MODERATOR") {
      res.status(403).json({ error: "Недостаточно прав" });
      return;
    }

    const parsed = pinMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Ошибка валидации", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const {
      message,
      authorIdentity,
      authorName,
      originalExternalId,
      originalTimestamp,
      attachment,
      attachments,
    } = parsed.data;

    const finalAttachments =
      attachments && attachments.length > 0
        ? attachments
        : attachment
          ? [attachment]
          : [];
    const first = finalAttachments[0];

    const inserted = await db.query(
      `INSERT INTO pinned_messages (
         room_id, message, author_identity, author_name,
         original_external_id, original_timestamp,
         attachment_url, attachment_name, attachment_kind, attachment_size, attachment_mime,
         attachments,
         pinned_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, message, author_identity AS "authorIdentity",
                 author_name AS "authorName",
                 original_external_id AS "originalExternalId",
                 original_timestamp AS "originalTimestamp",
                 attachment_url AS "attachmentUrl",
                 attachment_name AS "attachmentName",
                 attachment_kind AS "attachmentKind",
                 attachment_size AS "attachmentSize",
                 attachment_mime AS "attachmentMime",
                 attachments,
                 pinned_by AS "pinnedBy", pinned_at AS "pinnedAt"`,
      [
        room.id,
        message ?? "",
        authorIdentity ?? null,
        authorName ?? null,
        originalExternalId ?? null,
        originalTimestamp ?? null,
        first?.url ?? null,
        first?.name ?? null,
        first?.kind ?? null,
        first?.size ?? null,
        first?.mime ?? null,
        finalAttachments.length > 0 ? JSON.stringify(finalAttachments) : null,
        req.user!.userId,
      ]
    );

    const pin = inserted.rows[0];
    res.status(201).json({
      pin: {
        id: pin.id,
        message: pin.message ?? "",
        authorIdentity: pin.authorIdentity,
        authorName: pin.authorName,
        originalExternalId: pin.originalExternalId,
        originalTimestamp: pin.originalTimestamp != null ? Number(pin.originalTimestamp) : null,
        attachments: resolveAttachments(pin),
        pinnedBy: pin.pinnedBy,
        pinnedAt: pin.pinnedAt,
      },
    });
  } catch (error) {
    console.error("Pin message error:", error);
    res.status(500).json({ error: "Не удалось закрепить сообщение" });
  }
});

// DELETE /api/rooms/:slug/pins/:pinId — открепить (owner или moderator)
router.delete("/:slug/pins/:pinId", async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );
    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }
    const room = roomResult.rows[0];

    const authResult = await db.query(
      "SELECT role FROM participants WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
      [req.user!.userId, room.id]
    );
    const requesterRole = authResult.rows[0]?.role;
    if (requesterRole !== "OWNER" && requesterRole !== "MODERATOR") {
      res.status(403).json({ error: "Недостаточно прав" });
      return;
    }

    const result = await db.query(
      `DELETE FROM pinned_messages WHERE id = $1 AND room_id = $2`,
      [req.params.pinId, room.id]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: "Закреплённое сообщение не найдено" });
      return;
    }

    res.json({ message: "Сообщение откреплено" });
  } catch (error) {
    console.error("Unpin message error:", error);
    res.status(500).json({ error: "Не удалось открепить сообщение" });
  }
});

// POST /api/rooms/:slug/hide — скрыть комнату из своего списка
// Доступно любому, кто видит комнату (т.е. участвовал или владеет).
router.post("/:slug/hide", async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );
    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }
    const roomId = roomResult.rows[0].id;

    await db.query(
      `INSERT INTO hidden_rooms (user_id, room_id) VALUES ($1, $2)
       ON CONFLICT (user_id, room_id) DO NOTHING`,
      [req.user!.userId, roomId]
    );

    res.json({ message: "Комната скрыта" });
  } catch (error) {
    console.error("Hide room error:", error);
    res.status(500).json({ error: "Не удалось скрыть комнату" });
  }
});

// DELETE /api/rooms/:slug/hide — вернуть комнату в список
router.delete("/:slug/hide", async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );
    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }
    const roomId = roomResult.rows[0].id;

    await db.query(
      `DELETE FROM hidden_rooms WHERE user_id = $1 AND room_id = $2`,
      [req.user!.userId, roomId]
    );

    res.json({ message: "Комната возвращена в список" });
  } catch (error) {
    console.error("Unhide room error:", error);
    res.status(500).json({ error: "Не удалось вернуть комнату" });
  }
});

// DELETE /api/rooms/:slug
// Если комната активна — закрываем её (owner или moderator).
// Если уже закрыта — удаляем запись и все зависимости (только владелец).
router.delete("/:slug", async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const roomResult = await client.query(
      `SELECT id, owner_id AS "ownerId", is_active AS "isActive" FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );

    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }

    const room = roomResult.rows[0];
    const isOwner = room.ownerId === req.user!.userId;

    if (room.isActive) {
      // ЗАКРЫТЬ: разрешено владельцу и модератору
      if (!isOwner) {
        const roleResult = await client.query(
          `SELECT role FROM participants
           WHERE room_id = $1 AND user_id = $2
           ORDER BY joined_at DESC LIMIT 1`,
          [room.id, req.user!.userId]
        );
        if (roleResult.rows[0]?.role !== "MODERATOR") {
          res.status(403).json({ error: "Только владелец или модератор может закрыть комнату" });
          return;
        }
      }

      await client.query(
        "UPDATE rooms SET is_active = false, closed_at = NOW() WHERE id = $1",
        [room.id]
      );
      // Закрываем открытую сессию в room_sessions (если есть). Гарантируем, что
      // ended_at совпадает с rooms.closed_at — чтобы границы были консистентны.
      await client.query(
        `UPDATE room_sessions s
         SET ended_at = r.closed_at
         FROM rooms r
         WHERE s.room_id = r.id AND s.room_id = $1 AND s.ended_at IS NULL`,
        [room.id]
      );
      // Фиксируем выход всех, кто оставался в комнате — нужно для корректной
      // длительности сессий в отчёте и чтобы «зависшие» participants с left_at IS NULL
      // не торчали в следующих сессиях.
      await client.query(
        "UPDATE participants SET left_at = NOW() WHERE room_id = $1 AND left_at IS NULL",
        [room.id]
      );
      // Закрытие комнаты завершает встречу — чат и закрепления стираются
      await client.query("DELETE FROM chat_messages WHERE room_id = $1", [room.id]);
      await client.query("DELETE FROM pinned_messages WHERE room_id = $1", [room.id]);

      res.json({ message: "Комната закрыта" });
      return;
    }

    // УДАЛИТЬ навсегда: только владелец
    if (!isOwner) {
      res.status(403).json({ error: "Только владелец может удалить комнату" });
      return;
    }

    // Собираем урлы аудио ДО транзакции — после DELETE их уже не достанешь.
    const audioFiles = await collectRoomSoundFiles(room.id);

    await client.query("BEGIN");
    try {
      // FK без ON DELETE CASCADE — чистим вручную
      await client.query("DELETE FROM participants WHERE room_id = $1", [room.id]);
      await client.query("DELETE FROM blocked_users WHERE room_id = $1", [room.id]);
      await client.query("DELETE FROM invite_links WHERE room_id = $1", [room.id]);
      // chat_messages, pinned_messages, hidden_rooms, room_playlist_tracks — на CASCADE
      await client.query("DELETE FROM rooms WHERE id = $1", [room.id]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }

    // Физически сносим аудио-файлы с диска (FK CASCADE удаляет только записи).
    for (const url of audioFiles) {
      await unlinkAudioByUrl(url);
    }

    res.json({ message: "Комната удалена" });
  } catch (error) {
    console.error("Delete room error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  } finally {
    client.release();
  }
});

export default router;
