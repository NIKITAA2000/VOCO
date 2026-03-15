import { Router, Request, Response } from "express";
import { nanoid } from "nanoid";
import { AccessToken } from "livekit-server-sdk";
import { db } from "../lib/db.js";
import { authenticate } from "../middleware/auth.js";
import { createRoomSchema, createInviteSchema, blockUserSchema, changeRoleSchema } from "../schemas/index.js";
import { config } from "../config/index.js";

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

    const { name, maxUsers } = parsed.data;
    const slug = nanoid(10);

    const result = await db.query(
      `INSERT INTO rooms (name, slug, max_users, owner_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, slug, is_active AS "isActive", max_users AS "maxUsers",
                 owner_id AS "ownerId", created_at AS "createdAt"`,
      [name, slug, maxUsers, req.user!.userId]
    );

    const room = result.rows[0];

    // Auto-add owner as participant
    await db.query(
      "INSERT INTO participants (user_id, room_id, role) VALUES ($1, $2, 'OWNER')",
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
       ORDER BY r.created_at DESC`,
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
        owner: { id: row.owner_id, username: row.owner_username },
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
      `SELECT id, name, slug, is_active AS "isActive", max_users AS "maxUsers", owner_id AS "ownerId"
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

    if (existingResult.rows.length === 0) {
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

    // Generate LiveKit token
    const { displayName } = req.body ?? {};
    const at = new AccessToken(
      config.livekit.apiKey,
      config.livekit.apiSecret,
      {
        identity: req.user!.userId,
        name: displayName || req.user!.username,
      }
    );

    at.addGrant({
      roomJoin: true,
      room: room.slug,
      canPublish: true,
      canSubscribe: true,
      canPublishData,
    });

    const livekitToken = await at.toJwt();

    const livekitUrl =
      config.livekit.publicUrl || config.livekit.url;

    res.json({
      message: "Присоединились к комнате",
      token: livekitToken,
      livekitUrl,
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
      `UPDATE participants SET left_at = NOW()
       WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL`,
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

    // Выкидываем из комнаты если сейчас внутри
    await db.query(
      "UPDATE participants SET left_at = NOW() WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
      [userId, room.id]
    );

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
       WHERE user_id = $2 AND room_id = $3 AND left_at IS NULL
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
      res.status(403).json({ error: "Только владелец может закрыть комнату" });
      return;
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