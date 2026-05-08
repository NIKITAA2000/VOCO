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
} from "../schemas/index.js";
import { config } from "../config/index.js";
import {
  roomService,
  buildMetadata,
  PARTICIPANT_STATUS_ACTIVE,
} from "../lib/livekit.js";

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
      `INSERT INTO rooms (name, slug, max_users, owner_id, allow_guests, require_approval)
       VALUES ($1, $2, $3, $4, $5, $6)
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
    const result = await db.query(
      `SELECT DISTINCT r.id, r.name, r.slug, r.is_active AS "isActive",
              r.max_users AS "maxUsers", r.owner_id AS "ownerId",
              r.created_at AS "createdAt", r.closed_at AS "closedAt",
              u.id AS "owner_id", u.username AS "owner_username",
              (SELECT COUNT(DISTINCT p.user_id) FROM participants p
               WHERE p.room_id = r.id AND p.left_at IS NULL) AS "activeCount"
       FROM rooms r
       JOIN users u ON r.owner_id = u.id
       LEFT JOIN participants p ON p.room_id = r.id
       WHERE r.owner_id = $1 OR p.user_id = $1
       ORDER BY r.is_active DESC, r.created_at DESC`,
      [req.user!.userId]
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

// POST /api/rooms/:slug/invite — создать ссылку-приглашение (только владелец)
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

    if (room.ownerId !== req.user!.userId) {
      res.status(403).json({ error: "Только владелец может создавать ссылки-приглашения" });
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

// GET /api/rooms/:slug/invites — список ссылок-приглашений (только владелец)
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

    if (room.ownerId !== req.user!.userId) {
      res.status(403).json({ error: "Только владелец может просматривать ссылки-приглашения" });
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

// DELETE /api/rooms/:slug/invite/:code — деактивировать ссылку (только владелец)
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

    if (room.ownerId !== req.user!.userId) {
      res.status(403).json({ error: "Только владелец может деактивировать ссылки-приглашения" });
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
              u.id AS "userId", u.username,
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
        user: { id: row.userId, username: row.username },
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

    res.json({ message: "Роль обновлена" });
  } catch (error) {
    console.error("Change role error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// GET /api/rooms/:slug/report — отчёт о конференции (только владелец/модератор)
router.get("/:slug/report", async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT r.id, r.name, r.slug, r.is_active AS "isActive",
              r.max_users AS "maxUsers", r.owner_id AS "ownerId",
              r.created_at AS "createdAt", r.closed_at AS "closedAt",
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
        return;
      }
    }

    const sessionsResult = await db.query(
      `SELECT p.user_id AS "userId", p.role, p.joined_at AS "joinedAt", p.left_at AS "leftAt",
              u.username, u.email
       FROM participants p
       JOIN users u ON p.user_id = u.id
       WHERE p.room_id = $1
       ORDER BY p.joined_at ASC`,
      [room.id]
    );

    type Session = {
      userId: string;
      role: string;
      joinedAt: Date;
      leftAt: Date | null;
      username: string;
      email: string;
    };

    const sessions: Session[] = sessionsResult.rows.map((row: any) => ({
      userId: row.userId,
      role: row.role,
      joinedAt: new Date(row.joinedAt),
      leftAt: row.leftAt ? new Date(row.leftAt) : null,
      username: row.username,
      email: row.email,
    }));

    // Aggregate by user
    const byUser = new Map<string, {
      userId: string;
      username: string;
      email: string;
      roles: Set<string>;
      sessions: { joinedAt: Date; leftAt: Date | null }[];
      totalMs: number;
    }>();

    const closedAt = room.closedAt ? new Date(room.closedAt) : new Date();

    for (const s of sessions) {
      const end = s.leftAt ?? closedAt;
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

    // Peak concurrent participants via event timeline
    const events: { time: number; delta: number }[] = [];
    for (const s of sessions) {
      const end = s.leftAt ?? closedAt;
      events.push({ time: s.joinedAt.getTime(), delta: 1 });
      events.push({ time: end.getTime(), delta: -1 });
    }
    events.sort((a, b) => a.time - b.time || b.delta - a.delta);
    let peak = 0;
    let current = 0;
    for (const e of events) {
      current += e.delta;
      if (current > peak) peak = current;
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

    const createdAt = new Date(room.createdAt);
    const durationMs = Math.max(0, closedAt.getTime() - createdAt.getTime());

    res.json({
      report: {
        room: {
          id: room.id,
          name: room.name,
          slug: room.slug,
          isActive: room.isActive,
          createdAt: room.createdAt,
          closedAt: room.closedAt,
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

    const result = await db.query(
      `UPDATE rooms SET is_active = true, closed_at = NULL
       WHERE id = $1
       RETURNING id, name, slug, is_active AS "isActive", max_users AS "maxUsers",
                 owner_id AS "ownerId", created_at AS "createdAt", closed_at AS "closedAt",
                 allow_guests AS "allowGuests", require_approval AS "requireApproval"`,
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
    await roomService.updateParticipant(room.slug, identity, {
      metadata: buildMetadata({ status: PARTICIPANT_STATUS_ACTIVE, isGuest }),
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

// DELETE /api/rooms/:slug
router.delete("/:slug", async (req: Request, res: Response) => {
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
        res.status(403).json({ error: "Только владелец или модератор может закрыть комнату" });
        return;
      }
    }

    await db.query(
      "UPDATE rooms SET is_active = false, closed_at = NOW() WHERE id = $1",
      [room.id]
    );

    res.json({ message: "Комната закрыта" });
  } catch (error) {
    console.error("Delete room error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

export default router;
