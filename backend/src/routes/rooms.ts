import { Router, Request, Response } from "express";
import { nanoid } from "nanoid";
import { AccessToken } from "livekit-server-sdk";
import { db } from "../lib/db.js";
import { authenticate } from "../middleware/auth.js";
import {
  createRoomSchema,
  createInviteSchema,
  blockUserSchema,
  changeRoleSchema,
  joinRoomSchema,
  kickUserSchema,
} from "../schemas/index.js";
import { config } from "../config/index.js";
import { isUserInAnotherRoom } from "../lib/db.js";

const router = Router();

// Все маршруты требуют авторизации
router.use(authenticate);

// ============================================================================
// Вспомогательная: Генерация токена LiveKit
// ============================================================================
async function generateLiveKitToken(
  roomSlug: string,
  sessionId: string,
  displayName: string,
  role: string,
  userId?: string,
  isGuest: boolean = false
) {
  const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity: sessionId,
    name: displayName,
    metadata: JSON.stringify({ userId, role, isGuest }),
  });
  at.addGrant({
    roomJoin: true,
    room: roomSlug,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: role === "OWNER",
  });
  return {
    token: await at.toJwt(),
    livekitUrl: config.livekit.publicUrl || config.livekit.url,
  };
}

// ============================================================================
// 1. Создание комнаты
// POST /api/rooms
// ============================================================================
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

    const userId = req.user!.userId;
    const { name, maxUsers } = parsed.data;
    const slug = nanoid(10);
    const username = req.user!.username;
    const sessionId = nanoid(16);

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // Проверка: Не находится ли пользователь уже в какой-либо комнате?
      const inOtherRoom = await isUserInAnotherRoom(client, userId);
      if (inOtherRoom) {
        await client.query("ROLLBACK");
        res.status(400).json({
          error: "Нельзя создать новую комнату, пока вы находитесь в другой. Покиньте текущую комнату.",
        });
        return;
      }

      const roomResult = await client.query(
        `INSERT INTO rooms (name, slug, max_users, owner_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, slug, is_active AS "isActive", max_users AS "maxUsers",
                   owner_id AS "ownerId", created_at AS "createdAt"`,
        [name, slug, maxUsers, userId]
      );
      const room = roomResult.rows[0];

      // Записываем владельца в participants (активная сессия)
      await client.query(
        `INSERT INTO participants (user_id, room_id, session_id, display_name, role, is_guest)
         VALUES ($1, $2, $3, $4, 'OWNER', FALSE)`,
        [userId, room.id, sessionId, username]
      );

      await client.query("COMMIT");

      const { token, livekitUrl } = await generateLiveKitToken(
        room.slug,
        sessionId,
        username,
        "OWNER",
        userId,
        false
      );

      res.status(201).json({
        message: "Комната создана",
        room: { ...room, owner: { id: userId, username }, mySessionId: sessionId },
        token,
        livekitUrl,
      });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Create room error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// ============================================================================
// 2. Список комнат пользователя
// GET /api/rooms
// ============================================================================
router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const result = await db.query(
      `SELECT DISTINCT r.id, r.name, r.slug, r.is_active AS "isActive",
              r.max_users AS "maxUsers", r.owner_id AS "ownerId",
              r.created_at AS "createdAt", r.closed_at AS "closedAt",
              u.username AS "owner_username",
              (SELECT COUNT(*) FROM participants p
               WHERE p.room_id = r.id AND p.left_at IS NULL) AS "activeCount"
       FROM rooms r
       JOIN users u ON r.owner_id = u.id
       JOIN participants ur ON ur.room_id = r.id
       WHERE ur.user_id = $1 AND ur.is_guest = FALSE
       ORDER BY r.created_at DESC`,
      [userId]
    );

    const rooms = result.rows.map((row) => ({
      ...row,
      owner: { username: row.owner_username },
      activeCount: parseInt(row.activeCount),
    }));

    res.json({ rooms });
  } catch (error) {
    console.error("List rooms error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// ============================================================================
// 3. Детали комнаты
// GET /api/rooms/:slug
// ============================================================================
router.get("/:slug", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { slug } = req.params;

    const roomResult = await db.query(
      `SELECT r.id, r.name, r.slug, r.is_active AS "isActive",
              r.max_users AS "maxUsers", r.owner_id AS "ownerId",
              r.created_at AS "createdAt", r.closed_at AS "closedAt",
              u.username AS "owner_username"
       FROM rooms r JOIN users u ON r.owner_id = u.id
       WHERE r.slug = $1`,
      [slug]
    );

    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }
    const row = roomResult.rows[0];

    // Проверка доступа (участник или владелец)
    const accessCheck = await db.query(
      `SELECT 1 FROM participants
       WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL
       LIMIT 1`,
      [userId, row.id]
    );

    // Если не активный участник, проверяем историю посещений
    if (accessCheck.rows.length === 0 && row.ownerId !== userId) {
      const historyCheck = await db.query(
        `SELECT 1 FROM participants
         WHERE user_id = $1 AND room_id = $2 AND is_guest = FALSE
         LIMIT 1`,
        [userId, row.id]
      );

      if (historyCheck.rows.length === 0) {
        res.status(403).json({ error: "Доступ запрещён" });
        return;
      }
    }

    const participantsResult = await db.query(
      `SELECT p.id, p.session_id, p.display_name, p.role, p.joined_at,
              p.user_id AS "db_user_id", u.username, u.avatar_url AS "avatarUrl",
              p.is_guest
       FROM participants p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE p.room_id = $1 AND p.left_at IS NULL
       ORDER BY p.joined_at ASC`,
      [row.id]
    );

    // Определяем роль текущего пользователя
    const myParticipant = await db.query(
      `SELECT role FROM participants
       WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL`,
      [userId, row.id]
    );
    const myRole = myParticipant.rows[0]?.role;
    const isAdmin = myRole === "OWNER" || myRole === "MODERATOR";

    const participants = participantsResult.rows.map((p) => ({
      id: p.id,
      sessionId: isAdmin ? p.session_id : undefined,
      displayName: p.display_name,
      role: p.role,
      joinedAt: p.joined_at,
      user: p.db_user_id
        ? { id: p.db_user_id, username: p.username, avatarUrl: p.avatarUrl }
        : null,
      isGuest: p.is_guest || !p.db_user_id,
    }));

    res.json({
      room: {
        ...row,
        owner: { username: row.owner_username },
        participants,
      },
    });
  } catch (error) {
    console.error("Get room error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// ============================================================================
// 4. Вход в комнату
// POST /api/rooms/:slug/join
// ============================================================================
router.post("/:slug/join", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const username = req.user!.username;
    const { slug } = req.params;
    const { displayName: customDisplayName } = joinRoomSchema.parse(
      req.body || {}
    );
    const displayName = customDisplayName || username;

    // Получаем информацию о комнате
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

    // Транзакция
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // Проверка блокировки
      const blockedResult = await client.query(
        "SELECT id FROM blocked_users WHERE room_id = $1 AND user_id = $2",
        [room.id, userId]
      );
      if (blockedResult.rows.length > 0) {
        await client.query("ROLLBACK");
        res.status(403).json({ error: "Вы заблокированы в этой комнате" });
        return;
      }

      // Проверка: Уже в другой комнате?
      const inOtherRoom = await isUserInAnotherRoom(client, userId, room.id);
      if (inOtherRoom) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "Вы уже находитесь в другой комнате" });
        return;
      }

      // Основная логика входа
      const existing = await client.query(
        "SELECT id, session_id, role FROM participants WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
        [userId, room.id]
      );

      let role: "OWNER" | "MODERATOR" | "PARTICIPANT" = "PARTICIPANT";
      let sessionId = nanoid(16);

      if (existing.rows.length > 0) {
        // Уже внутри: обновляем имя, используем старую сессию
        await client.query(
          "UPDATE participants SET display_name = $1 WHERE user_id = $2 AND room_id = $3 AND left_at IS NULL",
          [displayName, userId, room.id]
        );
        role = existing.rows[0].role;
        sessionId = existing.rows[0].session_id;
      } else {
        // Новый вход
        const countResult = await client.query(
          "SELECT COUNT(*) as count FROM participants WHERE room_id = $1 AND left_at IS NULL",
          [room.id]
        );
        if (parseInt(countResult.rows[0].count) >= room.maxUsers) {
          await client.query("ROLLBACK");
          res.status(400).json({ error: "Комната заполнена" });
          return;
        }

        // Определение роли
        if (room.ownerId === userId) {
          role = "OWNER";
        } else {
          // Восстановление роли из истории (завершённые сессии)
          const lastRoleRes = await client.query(
            `SELECT role FROM participants
             WHERE user_id = $1 AND room_id = $2 AND left_at IS NOT NULL
             ORDER BY joined_at DESC LIMIT 1`,
            [userId, room.id]
          );
          if (lastRoleRes.rows[0]?.role === "MODERATOR") {
            role = "MODERATOR";
          }
        }

        await client.query(
          `INSERT INTO participants (user_id, room_id, session_id, display_name, role, is_guest)
           VALUES ($1, $2, $3, $4, $5, FALSE)`,
          [userId, room.id, sessionId, displayName, role]
        );
      }

      await client.query("COMMIT");

      // Генерация токена
      const { token, livekitUrl } = await generateLiveKitToken(
        room.slug,
        sessionId,
        displayName,
        role,
        userId,
        false
      );

      res.json({
        message: "Присоединились к комнате",
        token,
        livekitUrl,
        room: { id: room.id, name: room.name, slug: room.slug },
        sessionId,
        role,
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
    console.error("Join room error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// ============================================================================
// 5. Выход из комнаты
// POST /api/rooms/:slug/leave
// ============================================================================
router.post("/:slug/leave", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { slug } = req.params;

    const roomResult = await db.query(
      "SELECT id FROM rooms WHERE slug = $1",
      [slug]
    );
    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }
    const roomId = roomResult.rows[0].id;

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // Обновляем сессию: ставим left_at и считаем длительность
      const updateRes = await client.query(
        `UPDATE participants
         SET left_at = NOW(),
             duration_minutes = ROUND(EXTRACT(EPOCH FROM (NOW() - joined_at)) / 60)
         WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL
         RETURNING joined_at`,
        [userId, roomId]
      );

      if (updateRes.rows.length === 0) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "Вы не находитесь в этой комнате" });
        return;
      }

      await client.query("COMMIT");
      res.json({ message: "Вы покинули комнату" });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Leave room error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// ============================================================================
// 6. Кик участника
// POST /api/rooms/:slug/kick
// ============================================================================
router.post("/:slug/kick", async (req: Request, res: Response) => {
  try {
    const requesterId = req.user!.userId;
    const { slug } = req.params;
    const { sessionId, reason } = kickUserSchema.parse(req.body);

    const roomResult = await db.query(
      `SELECT id, owner_id AS "ownerId" FROM rooms
       WHERE slug = $1 AND is_active = true`,
      [slug]
    );
    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }
    const room = roomResult.rows[0];

    // Проверка прав инициатора
    const requesterPart = await db.query(
      `SELECT role FROM participants
       WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL`,
      [requesterId, room.id]
    );
    const requesterRole = requesterPart.rows[0]?.role;
    if (!["OWNER", "MODERATOR"].includes(requesterRole)) {
      res.status(403).json({ error: "Недостаточно прав" });
      return;
    }

    // Поиск жертвы
    const targetPart = await db.query(
      `SELECT id, user_id, role FROM participants
       WHERE room_id = $1 AND session_id = $2 AND left_at IS NULL`,
      [room.id, sessionId]
    );
    if (targetPart.rows.length === 0) {
      res.status(404).json({ error: "Участник не найден" });
      return;
    }
    const target = targetPart.rows[0];

    // Нельзя кикнуть себя
    if (target.user_id === requesterId) {
      res.status(400).json({ error: "Нельзя кикнуть себя" });
      return;
    }

    // Ограничения для модераторов
    if (
      requesterRole === "MODERATOR" &&
      ["OWNER", "MODERATOR"].includes(target.role)
    ) {
      res.status(403).json({
        error: "Модераторы не могут кикать владельцев и других модераторов",
      });
      return;
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // Закрываем сессию
      await client.query(
        `UPDATE participants
         SET left_at = NOW(),
             duration_minutes = ROUND(EXTRACT(EPOCH FROM (NOW() - joined_at)) / 60)
         WHERE id = $1 AND left_at IS NULL`,
        [target.id]
      );

      await client.query("COMMIT");
      res.json({ message: "Участник исключён из комнаты" });
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
    console.error("Kick error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// ============================================================================
// 7. Изменение роли
// PATCH /api/rooms/:slug/participants/:userId/role
// ============================================================================
router.patch(
  "/:slug/participants/:userId/role",
  async (req: Request, res: Response) => {
    try {
      const requesterId = req.user!.userId;
      const { slug, userId } = req.params;
      const { role } = changeRoleSchema.parse(req.body);

      const roomResult = await db.query(
        `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
        [slug]
      );
      if (roomResult.rows.length === 0 || roomResult.rows[0].ownerId !== requesterId) {
        res.status(403).json({ error: "Только владелец может менять роли" });
        return;
      }
      if (userId === requesterId) {
        res.status(400).json({ error: "Нельзя изменить свою роль" });
        return;
      }

      const client = await db.connect();
      try {
        await client.query("BEGIN");

        const up1 = await client.query(
          `UPDATE participants
           SET role = $1
           WHERE user_id = $2 AND room_id = $3 AND left_at IS NULL
           RETURNING id`,
          [role, userId, roomResult.rows[0].id]
        );

        if (up1.rows.length === 0) {
          await client.query("ROLLBACK");
          res.status(404).json({ error: "Пользователь не найден в комнате" });
          return;
        }

        await client.query("COMMIT");
        res.json({ message: `Роль изменена на ${role}` });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    } catch (error: any) {
      if (error.name === "ZodError") {
        res
          .status(400)
          .json({ error: "Ошибка валидации", details: error.errors });
        return;
      }
      console.error("Change role error:", error);
      res.status(500).json({ error: "Внутренняя ошибка сервера" });
    }
  }
);

// ============================================================================
// 8. Снятие модератора
// POST /api/rooms/:slug/moderators/:userId/demote
// ============================================================================
router.post(
  "/:slug/moderators/:userId/demote",
  async (req: Request, res: Response) => {
    try {
      const requesterId = req.user!.userId;
      const { slug, userId } = req.params;

      const roomResult = await db.query(
        `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
        [slug]
      );
      if (roomResult.rows.length === 0 || roomResult.rows[0].ownerId !== requesterId) {
        res.status(403).json({ error: "Только владелец может снимать модераторов" });
        return;
      }
      if (userId === requesterId) {
        res.status(400).json({ error: "Нельзя снять себя" });
        return;
      }

      const client = await db.connect();
      try {
        await client.query("BEGIN");

        const targetCheck = await client.query(
          `SELECT role FROM participants
           WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL`,
          [userId, roomResult.rows[0].id]
        );

        if (
          targetCheck.rows.length === 0 ||
          targetCheck.rows[0].role !== "MODERATOR"
        ) {
          await client.query("ROLLBACK");
          res.status(400).json({ error: "Пользователь не является модератором" });
          return;
        }

        await client.query(
          `UPDATE participants
           SET role = 'PARTICIPANT'
           WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL`,
          [userId, roomResult.rows[0].id]
        );

        await client.query("COMMIT");
        res.json({ message: "Модератор снят" });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("Demote error:", error);
      res.status(500).json({ error: "Внутренняя ошибка сервера" });
    }
  }
);

// ============================================================================
// 9. Блокировка пользователя
// POST /api/rooms/:slug/block
// ============================================================================
router.post("/:slug/block", async (req: Request, res: Response) => {
  try {
    const requesterId = req.user!.userId;
    const { slug } = req.params;
    const { userId, reason } = blockUserSchema.parse(req.body);

    const roomResult = await db.query(
      `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [slug]
    );
    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }
    const room = roomResult.rows[0];

    const requesterPart = await db.query(
      `SELECT role FROM participants
       WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL`,
      [requesterId, room.id]
    );
    const requesterRole = requesterPart.rows[0]?.role;
    if (!["OWNER", "MODERATOR"].includes(requesterRole)) {
      res.status(403).json({ error: "Недостаточно прав" });
      return;
    }

    if (userId === requesterId) {
      res.status(400).json({ error: "Нельзя заблокировать себя" });
      return;
    }
    if (userId === room.ownerId) {
      res.status(400).json({ error: "Нельзя заблокировать владельца" });
      return;
    }

    if (requesterRole === "MODERATOR") {
      const targetRoleRes = await db.query(
        `SELECT role FROM participants
         WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL`,
        [userId, room.id]
      );
      const targetRole = targetRoleRes.rows[0]?.role;
      if (targetRole === "OWNER" || targetRole === "MODERATOR") {
        res.status(403).json({
          error: "Модераторы не могут блокировать владельцев и других модераторов",
        });
        return;
      }
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // Блокировка
      await client.query(
        `INSERT INTO blocked_users (room_id, user_id, blocked_by, reason)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (room_id, user_id) DO UPDATE
         SET reason = $4, blocked_at = NOW()`,
        [room.id, userId, requesterId, reason || null]
      );

      // Исключение из комнаты (закрываем сессию)
      const targetPart = await client.query(
        `SELECT id, joined_at FROM participants
         WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL`,
        [userId, room.id]
      );

      if (targetPart.rows.length > 0) {
        await client.query(
          `UPDATE participants
           SET left_at = NOW(),
               duration_minutes = ROUND(EXTRACT(EPOCH FROM (NOW() - joined_at)) / 60)
           WHERE id = $1 AND left_at IS NULL`,
          [targetPart.rows[0].id]
        );
      }

      await client.query("COMMIT");
      res.json({ message: "Пользователь заблокирован и исключён" });
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
    console.error("Block error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// ============================================================================
// 10. Список заблокированных
// GET /api/rooms/:slug/blocked
// ============================================================================
router.get("/:slug/blocked", async (req: Request, res: Response) => {
  try {
    const requesterId = req.user!.userId;
    const { slug } = req.params;

    const roomResult = await db.query(
      `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [slug]
    );
    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }
    const room = roomResult.rows[0];

    const requesterPart = await db.query(
      `SELECT role FROM participants
       WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL`,
      [requesterId, room.id]
    );
    const requesterRole = requesterPart.rows[0]?.role;
    if (!["OWNER", "MODERATOR"].includes(requesterRole)) {
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

// ============================================================================
// 11. Разблокировка
// DELETE /api/rooms/:slug/block/:userId
// ============================================================================
router.delete("/:slug/block/:userId", async (req: Request, res: Response) => {
  try {
    const requesterId = req.user!.userId;
    const { slug, userId } = req.params;

    const roomResult = await db.query(
      `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [slug]
    );
    if (roomResult.rows.length === 0) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }
    const room = roomResult.rows[0];

    const requesterPart = await db.query(
      `SELECT role FROM participants
       WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL`,
      [requesterId, room.id]
    );
    const requesterRole = requesterPart.rows[0]?.role;
    if (!["OWNER", "MODERATOR"].includes(requesterRole)) {
      res.status(403).json({ error: "Недостаточно прав" });
      return;
    }

    const deleteResult = await db.query(
      "DELETE FROM blocked_users WHERE room_id = $1 AND user_id = $2 RETURNING id",
      [room.id, userId]
    );

    if (deleteResult.rows.length === 0) {
      res.status(404).json({ error: "Пользователь не заблокирован" });
      return;
    }

    res.json({ message: "Пользователь разблокирован" });
  } catch (error) {
    console.error("Unblock error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// ============================================================================
// 12. Приглашения
// ============================================================================
router.post("/:slug/invite", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const userId = req.user!.userId;

    const roomResult = await db.query(
      `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [slug]
    );
    if (roomResult.rows.length === 0 || roomResult.rows[0].ownerId !== userId) {
      res.status(403).json({ error: "Только владелец" });
      return;
    }

    const parsed = createInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Ошибка валидации",
        details: parsed.error.flatten().fieldErrors,
      });
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
      [roomResult.rows[0].id, code, userId, expiresAt ?? null, maxUses ?? null, allowGuests]
    );

    res.status(201).json({ message: "Ссылка создана", invite: result.rows[0] });
  } catch (error) {
    console.error("Create invite error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

router.get("/:slug/invites", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const userId = req.user!.userId;

    const roomResult = await db.query(
      `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [slug]
    );
    if (roomResult.rows.length === 0 || roomResult.rows[0].ownerId !== userId) {
      res.status(403).json({ error: "Доступ запрещён" });
      return;
    }

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

router.delete("/:slug/invite/:code", async (req: Request, res: Response) => {
  try {
    const { slug, code } = req.params;
    const userId = req.user!.userId;

    const roomResult = await db.query(
      `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [slug]
    );
    if (roomResult.rows.length === 0 || roomResult.rows[0].ownerId !== userId) {
      res.status(403).json({ error: "Доступ запрещён" });
      return;
    }

    const resDel = await db.query(
      `UPDATE invite_links SET is_active = false WHERE code = $1 AND room_id = $2`,
      [code, roomResult.rows[0].id]
    );

    if (resDel.rowCount === 0) {
      res.status(404).json({ error: "Ссылка не найдена" });
      return;
    }

    res.json({ message: "Ссылка деактивирована" });
  } catch (error) {
    console.error("Delete invite error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// ============================================================================
// 13. Закрытие комнаты
// DELETE /api/rooms/:slug
// ============================================================================
router.delete("/:slug", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const userId = req.user!.userId;

    const roomResult = await db.query(
      `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
      [slug]
    );
    if (roomResult.rows.length === 0 || roomResult.rows[0].ownerId !== userId) {
      res.status(403).json({ error: "Только владелец" });
      return;
    }

    // Закрываем все активные сессии перед закрытием комнаты
    await db.query(
      `UPDATE participants
       SET left_at = NOW(),
           duration_minutes = ROUND(EXTRACT(EPOCH FROM (NOW() - joined_at)) / 60)
       WHERE room_id = $1 AND left_at IS NULL`,
      [roomResult.rows[0].id]
    );

    await db.query(
      "UPDATE rooms SET is_active = false, closed_at = NOW() WHERE id = $1",
      [roomResult.rows[0].id]
    );

    res.json({ message: "Комната закрыта" });
  } catch (error) {
    console.error("Delete room error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

export default router;