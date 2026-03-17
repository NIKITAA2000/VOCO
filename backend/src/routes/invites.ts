import { Router, Request, Response, NextFunction } from "express";
import { nanoid } from "nanoid";
import { AccessToken } from "livekit-server-sdk";
import { db } from "../lib/db.js";
import { config } from "../config/index.js";
import { joinInviteSchema } from "../schemas/index.js";
import jwt from "jsonwebtoken";
import { JwtPayload } from "../middleware/auth.js";

const router = Router();

// ============================================================================
// Вспомогательные функции
// ============================================================================

export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    // Токена нет, продолжаем как гость
    return next();
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    (req as any).user = decoded;
  } catch {
    // Токен невалиден, игнорируем и продолжаем как гость
    // return res.status(401).json({ error: "Недействительный токен" });
  }

  next();
}

// Проверка: пользователь уже активен в другой комнате
async function isUserInAnotherRoom(
  client: any,
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

interface InviteRow {
  id: string;
  roomId: string;
  code: string;
  expiresAt: Date | null;
  maxUses: number | null;
  usesCount: number;
  isActive: boolean;
  allowGuests: boolean;
  roomIsActive: boolean;
  roomSlug: string;
  roomName: string;
  maxUsers: number;
}

async function validateInvite(
  code: string
): Promise<{ invite: InviteRow } | { error: string; status: 400 | 404 }> {
  const result = await db.query(
    `SELECT il.id, il.room_id AS "roomId", il.code,
            il.expires_at AS "expiresAt", il.max_uses AS "maxUses",
            il.uses_count AS "usesCount", il.is_active AS "isActive",
            il.allow_guests AS "allowGuests",
            r.is_active AS "roomIsActive", r.slug AS "roomSlug",
            r.name AS "roomName", r.max_users AS "maxUsers"
     FROM invite_links il
     JOIN rooms r ON il.room_id = r.id
     WHERE il.code = $1`,
    [code]
  );

  if (result.rows.length === 0) {
    return { error: "Ссылка-приглашение не найдена", status: 404 };
  }

  const invite: InviteRow = result.rows[0];

  if (!invite.isActive) return { error: "Ссылка деактивирована", status: 400 };
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) return { error: "Ссылка истекла", status: 400 };
  if (invite.maxUses !== null && invite.usesCount >= invite.maxUses) return { error: "Лимит исчерпан", status: 400 };
  if (!invite.roomIsActive) return { error: "Комната закрыта", status: 400 };

  return { invite };
}

// ============================================================================
// POST /api/invite/:code/join — Универсальный вход (для авторизованных пользователей и гостей)
// ============================================================================
router.post("/:code/join", optionalAuth, async (req: Request, res: Response) => {
  const client = await db.connect();

  try {
    // 1. Валидация тела запроса
    const parsed = joinInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Ошибка валидации",
        details: parsed.error.flatten().fieldErrors
      });
    }
    const { displayName } = parsed.data;

    // 2. Валидация инвайта
    const validation = await validateInvite(req.params.code);
    if ("error" in validation) {
      return res.status(validation.status).json({ error: validation.error });
    }
    const { invite } = validation;

    await client.query('BEGIN');

    // 3. Определение типа пользователя
    const isAuthenticated = !!(req as any).user;
    let sessionId: string;
    let role: string = 'PARTICIPANT';
    let userId: string | null = null;
    let dbDisplayName: string = displayName;

    if (isAuthenticated) {
      // Авторизованный пользователь
      userId = (req as any).user!.userId;
      const username = (req as any).user!.username;
      dbDisplayName = displayName || username;

      // Проверка блокировки
      const blocked = await client.query(
        `SELECT 1 FROM blocked_users WHERE room_id = $1 AND user_id = $2`,
        [invite.roomId, userId]
      );
      if (blocked.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: "Вы заблокированы в этой комнате" });
      }

      // Проверка: Уже в другой комнате?
      const inOtherRoom = await isUserInAnotherRoom(client, userId, invite.roomId);
      if (inOtherRoom) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: "Вы уже находитесь в другой комнате. Покиньте её перед входом." });
      }

      // Проверка существующей сессии в ЭТОЙ комнате
      const existing = await client.query(
        `SELECT session_id, role FROM participants WHERE user_id = $1 AND room_id = $2`,
        [userId, invite.roomId]
      );

      if (existing.rows.length > 0) {
        // Повторный вход: обновляем имя, используем старую сессию
        sessionId = existing.rows[0].session_id;
        role = existing.rows[0].role;
        await client.query(
          `UPDATE participants SET display_name = $1 WHERE user_id = $2 AND room_id = $3`,
          [dbDisplayName, userId, invite.roomId]
        );
      } else {
        // Новый вход
        sessionId = nanoid(16);

        // Проверка лимита участников
        const count = await client.query(
          `SELECT COUNT(*) as c FROM participants WHERE room_id = $1`,
          [invite.roomId]
        );
        if (parseInt(count.rows[0].c) >= invite.maxUsers) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: "Комната заполнена" });
        }

        // Определение роли
        const roomOwner = await client.query(
          `SELECT owner_id FROM rooms WHERE id = $1`,
          [invite.roomId]
        );
        if (roomOwner.rows[0].owner_id === userId) {
          role = 'OWNER';
        } else {
          const lastRole = await client.query(
            `SELECT role FROM user_room
             WHERE user_id = $1 AND room_id = $2
             ORDER BY joined_at DESC LIMIT 1`,
            [userId, invite.roomId]
          );
          if (lastRole.rows.length > 0 && lastRole.rows[0].role === 'MODERATOR') {
            role = 'MODERATOR';
          }
        }

        // Добавление в participants
        await client.query(
          `INSERT INTO participants (user_id, room_id, session_id, display_name, role)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, invite.roomId, sessionId, dbDisplayName, role]
        );

        // Обновление истории user_room
        const openHistory = await client.query(
          `SELECT id FROM user_room WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL`,
          [userId, invite.roomId]
        );
        if (openHistory.rows.length === 0) {
          await client.query(
            `INSERT INTO user_room (user_id, room_id, room_slug, room_name, role, joined_at)
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [userId, invite.roomId, invite.roomSlug, invite.roomName, role]
          );
        } else {
          await client.query(
            `UPDATE user_room SET role = $1 WHERE id = $2`,
            [role, openHistory.rows[0].id]
          );
        }

        // Увеличение счётчика инвайта
        await client.query(
          `UPDATE invite_links SET uses_count = uses_count + 1 WHERE id = $1`,
          [invite.id]
        );
      }

    } else {
      // ГОСТЬ
      if (!invite.allowGuests) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: "Гостевой вход запрещён в этой комнате" });
      }

      // Проверка лимита
      const count = await client.query(
        `SELECT COUNT(*) as c FROM participants WHERE room_id = $1`,
        [invite.roomId]
      );
      if (parseInt(count.rows[0].c) >= invite.maxUsers) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: "Комната заполнена" });
      }

      sessionId = `guest_${nanoid(12)}`;
      userId = null;
      role = 'PARTICIPANT';

      // Гость: user_id = NULL, в user_room не пишем
      await client.query(
        `INSERT INTO participants (user_id, room_id, session_id, display_name, role)
         VALUES (NULL, $1, $2, $3, $4)`,
        [invite.roomId, sessionId, dbDisplayName, role]
      );

      await client.query(
        `UPDATE invite_links SET uses_count = uses_count + 1 WHERE id = $1`,
        [invite.id]
      );
    }

    await client.query('COMMIT');

    // 4. Генерация LiveKit-токена
    const tokenPayload: any = {
      identity: sessionId,
      name: dbDisplayName,
      metadata: JSON.stringify({
        userId,
        role,
        isGuest: !isAuthenticated
      }),
    };

    const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, tokenPayload);

    at.addGrant({
      roomJoin: true,
      room: invite.roomSlug,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: role === 'OWNER',
    });

    // 5. Формирование ответа
    const response: any = {
      message: isAuthenticated ? "Вход выполнен" : "Гостевой вход",
      token: await at.toJwt(),
      livekitUrl: config.livekit.publicUrl || config.livekit.url,
      room: {
        id: invite.roomId,
        name: invite.roomName,
        slug: invite.roomSlug
      },
      sessionId,
    };

    if (isAuthenticated) {
      response.role = role;
    } else {
      response.guestIdentity = sessionId;
    }

    res.json(response);

  } catch (e: any) {
    await client.query('ROLLBACK');
    console.error("Invite join error:", e);
    res.status(500).json({
      error: "Ошибка сервера",
      details: e.message
    });
  } finally {
    client.release();
  }
});

export default router;