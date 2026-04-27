import { Router, Request, Response } from "express";
import { nanoid } from "nanoid";
import { AccessToken } from "livekit-server-sdk";
import { db } from "../lib/db.js";
import { authenticate } from "../middleware/auth.js";
import jwt from "jsonwebtoken";
import { config } from "../config/index.js";
import { RoomServiceClient } from "livekit-server-sdk";

const roomService = new RoomServiceClient(
  config.livekit.url,
  config.livekit.apiKey,
  config.livekit.apiSecret
);

const router = Router();

// POST /api/invites/:code/join
router.post("/:code/join", async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const { displayName: customDisplayName, isGuest: bodyIsGuest } = req.body || {};

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

    // Получаем инвайт и данные комнаты
    const inviteResult = await db.query(
      `SELECT il.*, r.id AS "room_id", r.slug, r.name, r.owner_id AS "owner_id", r.max_users AS "max_users"
       FROM invite_links il
       JOIN rooms r ON il.room_id = r.id
       WHERE il.code = $1 AND il.is_active = true`,
      [code]
    );

    if (!inviteResult.rows.length)
      return res.status(404).json({ error: "Ссылка-приглашение не найдена или неактивна" });

    const invite = inviteResult.rows[0];

    // Проверка срока действия и лимитов
    if ((invite.expires_at && new Date(invite.expires_at) < new Date()) ||
        (invite.max_uses && invite.uses_count >= invite.max_uses))
      return res.status(403).json({ error: "Ссылка-приглашение истекла или исчерпана" });

    // Определяем: гость или авторизованный пользователь
    const isGuest = !!bodyIsGuest || !authUser;
    let userId: string | null = null;
    let sessionId: string;
    let displayName: string;

    if (isGuest) {
    // Гость: генерируем sessionId ДО любых операций с БД (исправляет NOT NULL ошибку!)
      sessionId = `guest_${nanoid(16)}`;
      displayName = customDisplayName || `Guest-${nanoid(6)}`;

      // Проверка: разрешены ли гости для этого инвайта
      if (!invite.allow_guests)
        return res.status(403).json({ error: "Гостевой вход по этой ссылке запрещён" });

    } else {
      // Авторизованный пользователь
      userId = authUser!.userId;
      sessionId = nanoid(16);
      displayName = customDisplayName || authUser!.username;

      // Проверка блокировки
      const blocked = await db.query(
        "SELECT 1 FROM blocked_users WHERE room_id = $1 AND user_id = $2",
        [invite.room_id, userId]
      );
      if (blocked.rows.length > 0)
        return res.status(403).json({ error: "Вы заблокированы в этой комнате" });
    }

    // Транзакция: проверка лимитов + вставка в participants
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // Проверка лимита участников в комнате
      const countRes = await client.query(
        "SELECT COUNT(*) as count FROM participants WHERE room_id = $1 AND left_at IS NULL",
        [invite.room_id]
      );
      if (parseInt(countRes.rows[0].count) >= invite.max_users) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Комната заполнена" });
      }

      // Ключевое: Всегда передаём сгенерированное значение (session_id не может быть null! )
      await client.query(
        `INSERT INTO participants
         (user_id, room_id, session_id, display_name, role, is_guest)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, room_id)
         DO UPDATE SET
         display_name = EXCLUDED.display_name,
         session_id = EXCLUDED.session_id,
         left_at = NULL,
         role = CASE WHEN participants.role = 'OWNER' THEN 'OWNER' ELSE EXCLUDED.role END`,
        [userId, invite.room_id, sessionId, displayName, 'PARTICIPANT', isGuest]
      );

      // Инкремент использования инвайта
      await client.query(
        "UPDATE invite_links SET uses_count = uses_count + 1 WHERE id = $1",
        [invite.id]
      );

      await client.query("COMMIT");

      // Генерация токена LiveKit
      const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
        identity: sessionId,
        name: displayName,
        metadata: JSON.stringify({ userId, role: 'PARTICIPANT', isGuest }),
      });
      at.addGrant({
        roomJoin: true,
        room: invite.slug,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });

      res.json({
        message: "Присоединились по приглашению",
        token: await at.toJwt(),
        livekitUrl: config.livekit.publicUrl || config.livekit.url,
        room: {
          id: invite.room_id,
          name: invite.name,
          slug: invite.slug,
          owner: { id: invite.owner_id }
        },
        sessionId,
        role: "PARTICIPANT",
        isGuest,
      });

    } catch (e) {
      await client.query("ROLLBACK");
      console.error("Invite join transaction error:", e);
      throw e;
    } finally {
      client.release();
    }

  } catch (error: any) {
    if (error.name === "ZodError")
      return res.status(400).json({ error: "Ошибка валидации", details: error.errors });
    console.error("Invite join error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// Проверка валидности инвайта без присоединения (публичный)
router.get("/:code/validate", async (req: Request, res: Response) => {
  try {
    const { code } = req.params;

    const inviteResult = await db.query(
      `SELECT il.*, r.name, r.slug, r.owner_id AS "owner_id",
              u.username AS "owner_username"
       FROM invite_links il
       JOIN rooms r ON il.room_id = r.id
       JOIN users u ON r.owner_id = u.id
       WHERE il.code = $1`,
      [code]
    );

    if (!inviteResult.rows.length)
      return res.status(404).json({ valid: false, error: "Ссылка не найдена" });

    const invite = inviteResult.rows[0];
    const isValid = invite.is_active &&
          (!invite.expires_at || new Date(invite.expires_at) >= new Date()) &&
          (!invite.max_uses || invite.uses_count < invite.max_uses);

    res.json({
      valid: isValid,
      room: {
        name: invite.name,
        slug: invite.slug,
        owner: { username: invite.owner_username },
      },
      allowGuests: invite.allow_guests,
      expiresAt: invite.expires_at,
      maxUses: invite.max_uses,
      usesCount: invite.uses_count,
    });
  } catch (error) {
    console.error("Validate invite error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// Деактивация инвайта (только владелец)
router.delete("/:code", authenticate, async (req: Request, res: Response) => {
  try {
    const { code } = req.params;

    const inviteResult = await db.query(
      `SELECT il.room_id, r.owner_id AS "owner_id"
       FROM invite_links il
       JOIN rooms r ON il.room_id = r.id
       WHERE il.code = $1`,
      [code]
    );

    if (!inviteResult.rows.length)
      return res.status(404).json({ error: "Ссылка-приглашение не найдена" });

    const invite = inviteResult.rows[0];
    if (invite.owner_id !== req.user!.userId)
      return res.status(403).json({ error: "Только владелец может управлять приглашениями" });

    const updateResult = await db.query(
      "UPDATE invite_links SET is_active = false WHERE code = $1 RETURNING id",
      [code]
    );

    if (!updateResult.rows.length)
      return res.status(404).json({ error: "Ссылка не найдена" });

    res.json({ message: "Ссылка-приглашение деактивирована" });
  } catch (error) {
    console.error("Deactivate invite error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// Статистика по инвайту (только владелец)
router.get("/:code/stats", authenticate, async (req: Request, res: Response) => {
  try {
    const { code } = req.params;

    const inviteResult = await db.query(
      `SELECT il.*, r.owner_id AS "owner_id"
       FROM invite_links il
       JOIN rooms r ON il.room_id = r.id
       WHERE il.code = $1`,
       [code]
    );

    if (!inviteResult.rows.length)
      return res.status(404).json({ error: "Ссылка не найдена" });

    const invite = inviteResult.rows[0];
    if (invite.owner_id !== req.user!.userId)
      return res.status(403).json({ error: "Нет доступа к статистике" });

    const participantsResult = await db.query(
      `SELECT COUNT(*) as total,
       COUNT(CASE WHEN is_guest = true THEN 1 END) as guests,
       COUNT(CASE WHEN is_guest = false THEN 1 END) as users
       FROM participants
       WHERE room_id = $1 AND session_id LIKE $2`,
      [invite.room_id, `%${invite.id}%`] // упрощённая логика, можно улучшить
    );

    res.json({
      invite: {
        code: invite.code,
        createdAt: invite.created_at,
        expiresAt: invite.expires_at,
        maxUses: invite.max_uses,
        usesCount: invite.uses_count,
        allowGuests: invite.allow_guests,
        isActive: invite.is_active,
      },
      participants: participantsResult.rows[0],
    });
  } catch (error) {
    console.error("Invite guest join error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

export default router;