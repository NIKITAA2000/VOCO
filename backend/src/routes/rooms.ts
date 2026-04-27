import { Router, Request, Response } from "express";
import { nanoid } from "nanoid";
import { AccessToken } from "livekit-server-sdk";
import { db } from "../lib/db.js";
import { authenticate } from "../middleware/auth.js";
import jwt from "jsonwebtoken";

import { createRoomSchema, createInviteSchema, blockUserSchema, changeRoleSchema, joinRoomSchema, kickUserSchema, muteTrackSchema, } from "../schemas/index.js";

import { config } from "../config/index.js";
import { RoomServiceClient } from "livekit-server-sdk";
import { isUserInAnotherRoom } from "../lib/db.js";

const roomService = new RoomServiceClient(
  config.livekit.url,
  config.livekit.apiKey,
  config.livekit.apiSecret
);

const router = Router();

// Создание комнаты (только авторизованные)
// POST /api/rooms
router.post("/", authenticate, async (req: Request, res: Response) => {
  try {
    const parsed = createRoomSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Ошибка валидации",
        details: parsed.error.flatten().fieldErrors
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
      "INSERT INTO participants (user_id, room_id, session_id, display_name, role) VALUES ($1, $2, $3, $4, 'OWNER')",
      [req.user!.userId, room.id, `owner_${nanoid(16)}`, req.user!.username]
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

// Список комнат (только авторизованные)
// GET /api/rooms
router.get("/", authenticate, async (req: Request, res: Response) => {
  try {
    const result = await db.query(
      `SELECT DISTINCT r.id, r.name, r.slug, r.is_active AS "isActive",
              r.max_users AS "maxUsers", r.owner_id AS "ownerId",
              r.created_at AS "createdAt", r.closed_at AS "closedAt",
              u.id AS "owner_id", u.username AS "owner_username",
       (SELECT COUNT(*) FROM participants p
       WHERE p.room_id = r.id AND p.left_at IS NULL) AS "activeCount"
       FROM rooms r
       JOIN users u ON r.owner_id = u.id
       LEFT JOIN participants p ON p.room_id = r.id
       WHERE r.is_active = true AND (r.owner_id = $1 OR p.user_id = $1)
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


// Информация о комнате (публичный, но обогащается для авторизованных)
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
      `SELECT p.id, p.role, p.display_name AS "displayName", p.is_guest AS "isGuest",
              u.id AS "userId", u.username, u.avatar_url AS "avatarUrl"
       FROM participants p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE p.room_id = $1 AND p.left_at IS NULL`,
      [row.id]
    );

    const participants = participantsResult.rows.map((p) => ({
        id: p.id,
        role: p.role,
        isGuest: p.isGuest,
        user: {
        id: p.userId,
        username: p.username || p.displayName,
        avatarUrl: p.avatarUrl,
      },
    }));

    let myRole: string | null = null;
    if (req.user) {
      if (row.ownerId === req.user.userId) {
        myRole = "OWNER";
      } else {
        const myRoleResult = await db.query(
          `SELECT role FROM participants
          WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL
          LIMIT 1`,
          [row.id, req.user.userId]
        );
        myRole = myRoleResult.rows[0]?.role ?? null;
      }
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
        owner: { id: row.owner_id, username: row.owner_username },
        myRole,
        participants,
      },
    });
  } catch (error) {
    console.error("Get room error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// Вход в комнату (публичный: гости и пользователи равноправны)
// POST /api/rooms/:slug/join
router.post("/:slug/join", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const { displayName: customDisplayName, isGuest, inviteCode } = joinRoomSchema.parse(req.body || {});

    // «Мягкая» аутентификация: пробуем получить пользователя, если есть токен
    let authUser: { userId: string; username: string } | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string; username: string };
      authUser = { userId: decoded.userId, username: decoded.username };
    } catch {
      authUser = undefined;
    }
  }

  const roomResult = await db.query(
    `SELECT id, name, slug, is_active AS "isActive", max_users AS "maxUsers", owner_id AS "ownerId"
     FROM rooms WHERE slug = $1`,
    [slug]
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

  let userId: string | null = null;
  let sessionId: string;
  let displayName: string;
  const isGuestUser = !!isGuest;

  if (isGuestUser) {
    // Принимаем sessionId от фронтенда, если он валиден
    const providedSessionId = req.body.sessionId;
    const sessionIdPattern = /^guest_[a-zA-Z0-9]{16}$/;

    if (providedSessionId && typeof providedSessionId === 'string'&& sessionIdPattern.test(providedSessionId))
      sessionId = providedSessionId;
    else
      sessionId = `guest_${nanoid(16)}`;

    displayName = customDisplayName || `Guest-${nanoid(6)}`;

    if (inviteCode) {
      const inviteRes = await db.query(
        `SELECT id, allow_guests, expires_at, max_uses, uses_count, is_active
         FROM invite_links WHERE code = $1 AND room_id = $2`,
        [inviteCode, room.id]
      );
      if (inviteRes.rows.length === 0) {
        res.status(404).json({ error: "Ссылка-приглашение не найдена" });
        return;
      }
      const invite = inviteRes.rows[0];
      if (!invite.allow_guests || !invite.is_active ||
         (invite.expires_at && new Date(invite.expires_at) < new Date()) ||
         (invite.max_uses && invite.uses_count >= invite.max_uses)) {
        res.status(403).json({ error: "Ссылка-приглашение недействительна" });
        return;
      }
      await db.query("UPDATE invite_links SET uses_count = uses_count + 1 WHERE id = $1", [invite.id]);
    }
  } else {
    // Авторизованный пользователь: требуем валидный токен
    if (!authUser) {
      res.status(401).json({ error: "Требуется авторизация" });
      return;
    }
    userId = authUser.userId;
    sessionId = nanoid(16);
    displayName = customDisplayName || authUser.username;

    const blockedRes = await db.query(
      "SELECT id FROM blocked_users WHERE room_id = $1 AND user_id = $2",
      [room.id, userId]
    );
    if (blockedRes.rows.length > 0) {
      res.status(403).json({ error: "Вы заблокированы в этой комнате" });
      return;
    }
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const inOther = await isUserInAnotherRoom(client, userId, room.id, isGuestUser ? sessionId : undefined);
    if (inOther) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "Вы уже находитесь в другой комнате" });
      return;
    }

    const countRes = await client.query(
      "SELECT COUNT(*) as count FROM participants WHERE room_id = $1 AND left_at IS NULL",
      [room.id]
    );
    if (parseInt(countRes.rows[0].count) >= room.maxUsers) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "Комната заполнена" });
      return;
    }

    // Проверка существующей сессии (для переподключения)
    // Ищем любую запись этого пользователя/сессии в комнате (даже если left_at IS NOT NULL)
    const existing = await client.query(
      `SELECT id, session_id, role, left_at
       FROM participants
       WHERE room_id = $1 AND (
         (user_id IS NOT NULL AND user_id = $2) OR
         (user_id IS NULL AND session_id = $3)
       )
       ORDER BY joined_at DESC LIMIT 1`,
       [room.id, userId, sessionId]
    );

    let role: "OWNER" | "MODERATOR" | "PARTICIPANT" = "PARTICIPANT";

    if (existing.rows.length > 0) {
      // Запись уже существует — просто "открываем" её заново
      role = existing.rows[0].role;
      await client.query(
        `UPDATE participants
         SET session_id = $1, display_name = $2, left_at = NULL, joined_at = NOW(), duration_minutes = NULL
         WHERE id = $3`,
        [sessionId, displayName, existing.rows[0].id]
      );
    } else {
      // Записи нет — определяем роль
      if (!isGuestUser && room.ownerId === userId) {
        role = "OWNER";
      } else if (!isGuestUser) {
        const lastRoleRes = await client.query(
          `SELECT role FROM participants WHERE user_id = $1 AND room_id = $2 ORDER BY joined_at DESC LIMIT 1`,
          [userId, room.id]
        );
        if (lastRoleRes.rows[0]?.role === "MODERATOR") role = "MODERATOR";
      }

      if (isGuestUser) {
        await client.query(
          `INSERT INTO participants (user_id, room_id, session_id, display_name, role, is_guest, joined_at, left_at, duration_minutes)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NULL, NULL)
           ON CONFLICT (session_id)
           DO UPDATE SET
             display_name = EXCLUDED.display_name,
             left_at = NULL,
             joined_at = NOW(),
             duration_minutes = NULL`,
         [null, room.id, sessionId, displayName, role, true]
        );
      } else {
        await client.query(
          `INSERT INTO participants (user_id, room_id, session_id, display_name, role, is_guest, joined_at, left_at, duration_minutes)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NULL, NULL)
           ON CONFLICT (user_id, room_id)
           DO UPDATE SET
             session_id = EXCLUDED.session_id,
             display_name = EXCLUDED.display_name,
             left_at = NULL,
             joined_at = NOW(),
             duration_minutes = NULL`,
          [userId, room.id, sessionId, displayName, role, isGuestUser]
        );
      }
    }

    await client.query("COMMIT");

    // Генерация токена LiveKit
    const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
      identity: sessionId,
      name: displayName, // Оставляем для обратной совместимости
      metadata: JSON.stringify({
        userId,
        role,
        isGuest: isGuestUser,
        displayName: displayName
      }),
    });

    at.addGrant({
      roomJoin: true,
      room: room.slug,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: role === "OWNER",
    });

    res.json({
      message: "Присоединились к комнате",
      token: await at.toJwt(),
      livekitUrl: config.livekit.publicUrl || config.livekit.url,
      room: { id: room.id, name: room.name, slug: room.slug },
      sessionId,
      role,
      isGuest: isGuestUser,
    });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
      client.release();
  }
  } catch (error: any) {
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Ошибка валидации", details: error.errors });
      return;
    }
    console.error("Join error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// Выход из комнаты (публичный: работает через sessionId)
// POST /api/rooms/:slug/leave
router.post("/:slug/leave", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const { sessionId } = req.body as { sessionId?: string };

    if (!sessionId)
      return res.status(400).json({ error: "Требуется sessionId" });

    const roomResult = await db.query("SELECT id FROM rooms WHERE slug = $1", [slug]);
    if (roomResult.rows.length === 0)
      return res.status(404).json({ error: "Комната не найдена" });

    const roomId = roomResult.rows[0].id;

    const result = await db.query(
      `UPDATE participants
       SET left_at = NOW(),
           duration_minutes = ROUND(EXTRACT(EPOCH FROM (NOW() - joined_at)) / 60)
       WHERE room_id = $1 AND session_id = $2 AND left_at IS NULL
       RETURNING id`,
      [roomId, sessionId]
    );

    // Если ничего не обновилось — пробуем найти запись без фильтра left_at
    if (result.rowCount === 0) {
      console.warn(`[LEAVE] No active session found, trying fallback for sessionId=${sessionId}`);

      const fallback = await db.query(
        `UPDATE participants
         SET left_at = COALESCE(left_at, NOW()),  -- если уже был left_at, не перезаписываем
             duration_minutes = COALESCE(duration_minutes, ROUND(EXTRACT(EPOCH FROM (NOW() - joined_at)) / 60))
         WHERE room_id = $1 AND session_id = $2
         RETURNING id`,
        [roomId, sessionId]
      );
    }

    res.json({ message: "Вы покинули комнату" });
  } catch (error) {
    console.error("Leave room error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// Администрирование (Только авторизованные + проверка ролей в БД)
// POST /api/rooms/:slug/invite
router.post("/:slug/invite", authenticate, async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );
    if (!roomResult.rows.length)
      return res.status(404).json({ error: "Комната не найдена" });

    if (roomResult.rows[0].ownerId !== req.user!.userId)
      return res.status(403).json({ error: "Только владелец может создавать ссылки-приглашения" });

    const parsed = createInviteSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Ошибка валидации", details: parsed.error.flatten().fieldErrors });

    const { expiresAt, maxUses, allowGuests } = parsed.data;
    const code = nanoid(8);

    const result = await db.query(
      `INSERT INTO invite_links (room_id, code, created_by, expires_at, max_uses, allow_guests)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, code, expires_at AS "expiresAt", max_uses AS "maxUses",
                 uses_count AS "usesCount", is_active AS "isActive",
                 allow_guests AS "allowGuests", created_at AS "createdAt"`,
      [roomResult.rows[0].id, code, req.user!.userId, expiresAt ?? null, maxUses ?? null, allowGuests]
    );

    res.status(201).json({ message: "Ссылка-приглашение создана", invite: result.rows[0] });
  } catch (error) {
    console.error("Create invite error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// GET /api/rooms/:slug/invites
router.get("/:slug/invites", authenticate, async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );
    if (!roomResult.rows.length)
      return res.status(404).json({ error: "Комната не найдена" });
    if (roomResult.rows[0].ownerId !== req.user!.userId)
      return res.status(403).json({ error: "Только владелец может просматривать ссылки-приглашения" });

    const result = await db.query(
      `SELECT id, code, expires_at AS "expiresAt", max_uses AS "maxUses",
              uses_count AS "usesCount", is_active AS "isActive",
              allow_guests AS "allowGuests", created_at AS "createdAt"
       FROM invite_links WHERE room_id = $1 ORDER BY created_at DESC`,
      [roomResult.rows[0].id]
    );

    res.json({ invites: result.rows });
  } catch (error) {
    console.error("List invites error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// DELETE /api/rooms/:slug/invite/:code
router.delete("/:slug/invite/:code", authenticate, async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );
    if (!roomResult.rows.length)
      return res.status(404).json({ error: "Комната не найдена" });
    if (roomResult.rows[0].ownerId !== req.user!.userId)
      return res.status(403).json({ error: "Только владелец может деактивировать ссылки-приглашения" });

    const inviteResult = await db.query(
      `UPDATE invite_links SET is_active = false WHERE code = $1 AND room_id = $2 RETURNING id`,
      [req.params.code, roomResult.rows[0].id]
    );

    if (!inviteResult.rows.length)
      return res.status(404).json({ error: "Ссылка-приглашение не найдена" });
    res.json({ message: "Ссылка-приглашение деактивирована" });
  } catch (error) {
    console.error("Deactivate invite error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// POST /api/rooms/:slug/block
router.post("/:slug/block", authenticate, async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );
    if (!roomResult.rows.length)
      return res.status(404).json({ error: "Комната не найдена" });
    const room = roomResult.rows[0];

    const authResult = await db.query(
      "SELECT role FROM participants WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
      [req.user!.userId, room.id]
    );
    const requesterRole = authResult.rows[0]?.role;
    if (requesterRole !== "OWNER"&& requesterRole !== "MODERATOR")
      return res.status(403).json({ error: "Недостаточно прав" });

    const parsed = blockUserSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        error: "Ошибка валидации",
        details: parsed.error.flatten().fieldErrors
      });
    const { userId, reason } = parsed.data;

    if (userId === req.user!.userId)
      return res.status(400).json({ error: "Нельзя заблокировать самого себя" });
    if (userId === room.ownerId)
      return res.status(400).json({ error: "Нельзя заблокировать владельца комнаты" });

    await db.query(
      `INSERT INTO blocked_users (room_id, user_id, blocked_by, reason)
       VALUES ($1, $2, $3, $4) ON CONFLICT (room_id, user_id) DO NOTHING`,
    [room.id, userId, req.user!.userId, reason ?? null]
    );

    // Выкидываем из комнаты если сейчас внутри
    await db.query(
      "UPDATE participants SET left_at = NOW() WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
      [userId, room.id]
    );

    const activeSession = await db.query(
      "SELECT session_id FROM participants WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
      [userId, room.id]
    );
    if (activeSession.rows.length > 0) {
      try {
        await roomService.removeParticipant(room.slug, activeSession.rows[0].session_id);
      } catch (lkErr: any) {
        if (!lkErr.message?.includes("participant not found"))
          console.warn("LiveKit disconnect failed during block:", lkErr);
      }
    }

    res.json({ message: "Пользователь заблокирован" });
  } catch (error) {
    console.error("Block user error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// DELETE /api/rooms/:slug/block/:userId
router.delete("/:slug/block/:userId", authenticate, async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );
    if (!roomResult.rows.length)
      return res.status(404).json({ error: "Комната не найдена" });

    const authResult = await db.query(
      "SELECT role FROM participants WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
      [req.user!.userId, roomResult.rows[0].id]
    );
    const requesterRole = authResult.rows[0]?.role;
    if (requesterRole !== "OWNER"&& requesterRole !== "MODERATOR")
      return res.status(403).json({ error: "Недостаточно прав" });

    const deleteResult = await db.query(
      "DELETE FROM blocked_users WHERE room_id = $1 AND user_id = $2 RETURNING id",
      [roomResult.rows[0].id, req.params.userId]
    );
    if (!deleteResult.rows.length)
      return res.status(404).json({ error: "Пользователь не заблокирован в этой комнате" });

    res.json({ message: "Пользователь разблокирован" });
  } catch (error) {
    console.error("Unblock user error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// GET /api/rooms/:slug/blocked
router.get("/:slug/blocked", authenticate, async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );
    if (!roomResult.rows.length)
      return res.status(404).json({ error: "Комната не найдена" });

    const authResult = await db.query(
      "SELECT role FROM participants WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
      [req.user!.userId, roomResult.rows[0].id]
    );
    const requesterRole = authResult.rows[0]?.role;
    if (requesterRole !== "OWNER"&& requesterRole !== "MODERATOR")
      return res.status(403).json({ error: "Недостаточно прав" });

    const result = await db.query(
      `SELECT bu.id, bu.reason, bu.blocked_at AS "blockedAt",
              u.id AS "userId", u.username, b.username AS "blockedByUsername"
       FROM blocked_users bu
       JOIN users u ON bu.user_id = u.id
       JOIN users b ON bu.blocked_by = b.id
       WHERE bu.room_id = $1 ORDER BY bu.blocked_at DESC`,
      [roomResult.rows[0].id]
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

// PATCH /api/rooms/:slug/participants/:userId/role
router.patch("/:slug/participants/:userId/role", authenticate, async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );
    if (!roomResult.rows.length)
      return res.status(404).json({ error: "Комната не найдена" });
    const room = roomResult.rows[0];

    if (room.ownerId !== req.user!.userId)
      return res.status(403).json({ error: "Только владелец может изменять роли" });
    if (req.params.userId === req.user!.userId)
      return res.status(400).json({ error: "Нельзя изменить собственную роль" });

    const parsed = changeRoleSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        error: "Ошибка валидации",
        details: parsed.error.flatten().fieldErrors
      });

    const updateResult = await db.query(
      `UPDATE participants SET role = $1
       WHERE user_id = $2 AND room_id = $3 AND left_at IS NULL
       RETURNING id`,
      [parsed.data.role, req.params.userId, room.id]
    );
    if (!updateResult.rows.length)
      return res.status(404).json({ error: "Участник не найден в комнате" });

    res.json({ message: "Роль обновлена" });
  } catch (error) {
    console.error("Change role error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// GET /api/rooms/:slug/report
router.get("/:slug/report", authenticate, async (req: Request, res: Response) => {
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

    if (!roomResult.rows.length)
      return res.status(404).json({ error: "Комната не найдена" });
    const room = roomResult.rows[0];

    if (room.ownerId !== req.user!.userId) {
      const roleResult = await db.query(
        `SELECT role FROM participants
         WHERE room_id = $1 AND user_id = $2
         ORDER BY joined_at DESC
         LIMIT 1`,
        [room.id, req.user!.userId]
      );
      if (roleResult.rows[0]?.role !== "MODERATOR")
        return res.status(403).json({ error: "Нет доступа к отчёту" });
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
      if (current > peak)
        peak = current;
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
          owner: {
            id: room.owner_id,
            username: room.owner_username
          },
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

// DELETE /api/rooms/:slug
router.delete("/:slug", authenticate, async (req: Request, res: Response) => {
  try {
    const roomResult = await db.query(
      `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [req.params.slug]
    );
    if (!roomResult.rows.length)
      return res.status(404).json({ error: "Комната не найдена" });
    const room = roomResult.rows[0];

    if (room.ownerId !== req.user!.userId) {
      const roleResult = await db.query(
        `SELECT role FROM participants
         WHERE room_id = $1 AND user_id = $2
         ORDER BY joined_at DESC
         LIMIT 1`,
        [room.id, req.user!.userId]
      );
      if (roleResult.rows[0]?.role !== "MODERATOR")
        return res.status(403).json({ error: "Только владелец или модератор может закрыть комнату" });
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

// POST /api/rooms/:slug/kick
router.post("/:slug/kick", authenticate, async (req: Request, res: Response) => {
  try {
    const parsed = kickUserSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        error: "Ошибка валидации",
        details: parsed.error.flatten().fieldErrors
      });
    const { sessionId, reason } = parsed.data;

    const roomResult = await db.query(
      `SELECT id, slug, owner_id AS "ownerId" FROM rooms WHERE slug = $1 AND is_active = true`,
      [req.params.slug]
    );
    if (!roomResult.rows.length)
      return res.status(404).json({ error: "Комната не найдена" });
    const room = roomResult.rows[0];

    const authResult = await db.query(
      "SELECT role FROM participants WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
     [req.user!.userId, room.id]
    );
    const requesterRole = authResult.rows[0]?.role;
    if (requesterRole !== "OWNER"&& requesterRole !== "MODERATOR")
      return res.status(403).json({ error: "Недостаточно прав" });

    const targetResult = await db.query(
      "SELECT session_id, user_id, role FROM participants WHERE room_id = $1 AND session_id = $2 AND left_at IS NULL",
      [room.id, sessionId]
    );
    if (!targetResult.rows.length)
      return res.status(404).json({ error: "Участник не найден в комнате" });
    const target = targetResult.rows[0];

    if (requesterRole === "MODERATOR"&& ["OWNER", "MODERATOR"].includes(target.role))
      return res.status(403).json({ error: "Модератор не может управлять старшими ролями" });
    if (target.user_id === req.user!.userId)
      return res.status(400).json({ error: "Нельзя кикнуть самого себя" });

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      try {
        await roomService.removeParticipant(room.slug, target.session_id);
      }
      catch (lkErr: any) {
        if (!lkErr.message?.includes("participant not found"))
        throw lkErr;
      }

      await client.query(
        `UPDATE participants SET left_at = NOW(), duration_minutes = ROUND(EXTRACT(EPOCH FROM (NOW() - joined_at)) / 60)
         WHERE room_id = $1 AND session_id = $2 AND left_at IS NULL`,
        [room.id, sessionId]
      );
      await client.query("COMMIT");
        res.json({ message: "Участник исключён из комнаты", reason: reason || null });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    if (error.name === "ZodError")
      return res.status(400).json({
        error: "Ошибка валидации",
        details: error.errors
      });
    console.error("Kick error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// POST /api/rooms/:slug/mute
router.post("/:slug/mute", authenticate, async (req: Request, res: Response) => {
  try {
    const parsed = muteTrackSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Ошибка валидации", details: parsed.error.flatten().fieldErrors });
    const { sessionId, trackSid, mute } = parsed.data;

    const roomResult = await db.query(
      `SELECT id, slug, owner_id AS "ownerId" FROM rooms WHERE slug = $1 AND is_active = true`,
      [req.params.slug]
    );
    if (!roomResult.rows.length)
      return res.status(404).json({ error: "Комната не найдена" });
    const room = roomResult.rows[0];

    const authResult = await db.query(
      "SELECT role FROM participants WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
      [req.user!.userId, room.id]
    );
    const requesterRole = authResult.rows[0]?.role;
    if (requesterRole !== "OWNER"&& requesterRole !== "MODERATOR")
      return res.status(403).json({ error: "Недостаточно прав" });

    const targetResult = await db.query(
      "SELECT session_id, user_id, role FROM participants WHERE room_id = $1 AND session_id = $2 AND left_at IS NULL",
      [room.id, sessionId]);
    if (!targetResult.rows.length)
      return res.status(404).json({ error: "Участник не найден в комнате" });
    const target = targetResult.rows[0];

    if (requesterRole === "MODERATOR"&& ["OWNER", "MODERATOR"].includes(target.role))
      return res.status(403).json({ error: "Модератор не может управлять старшими ролями" });
    if (target.user_id === req.user!.userId)
      return res.status(400).json({ error: "Нельзя мутировать самого себя" });

    if (trackSid) {
    await roomService.mutePublishedTrack(room.slug, target.session_id, trackSid, mute);
    } else {
      const participant = await roomService.getParticipant(room.slug, target.session_id);
      const audioTracks = participant.tracks.filter((t) => t.source === "microphone" || t.type === "audio");
      for (const track of audioTracks) {
        await roomService.mutePublishedTrack(room.slug, target.session_id, track.sid, mute);
      }
    }

    res.json({ message: mute ? "Аудио заглушено" : "Аудио включено", sessionId });
  } catch (error) {
    console.error("Mute error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

export default router;