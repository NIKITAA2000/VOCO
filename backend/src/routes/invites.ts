import { Router, Request, Response } from "express";
import { nanoid } from "nanoid";
import { AccessToken } from "livekit-server-sdk";
import { db } from "../lib/db.js";
import { authenticate } from "../middleware/auth.js";
import { joinGuestSchema } from "../schemas/index.js";
import { config } from "../config/index.js";

const router = Router();

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

  if (!invite.isActive) {
    return { error: "Ссылка-приглашение деактивирована", status: 400 };
  }

  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    return { error: "Ссылка-приглашение истекла", status: 400 };
  }

  if (invite.maxUses !== null && invite.usesCount >= invite.maxUses) {
    return { error: "Лимит использований ссылки исчерпан", status: 400 };
  }

  if (!invite.roomIsActive) {
    return { error: "Комната закрыта", status: 400 };
  }

  return { invite };
}

// POST /api/invite/:code/join — войти по ссылке (с авторизацией)
router.post("/:code/join", authenticate, async (req: Request, res: Response) => {
  try {
    const validation = await validateInvite(req.params.code);
    if ("error" in validation) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const { invite } = validation;

    // Проверяем — не в комнате ли уже
    const existingResult = await db.query(
      "SELECT id FROM participants WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
      [req.user!.userId, invite.roomId]
    );

    if (existingResult.rows.length === 0) {
      // Проверяем вместимость
      const countResult = await db.query(
        "SELECT COUNT(DISTINCT user_id) AS count FROM participants WHERE room_id = $1 AND left_at IS NULL",
        [invite.roomId]
      );

      if (parseInt(countResult.rows[0].count) >= invite.maxUsers) {
        res.status(400).json({ error: "Комната заполнена" });
        return;
      }

      await db.query(
        "INSERT INTO participants (user_id, room_id, role) VALUES ($1, $2, 'PARTICIPANT')",
        [req.user!.userId, invite.roomId]
      );

      await db.query(
        "UPDATE invite_links SET uses_count = uses_count + 1 WHERE id = $1",
        [invite.id]
      );
    }

    const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
      identity: req.user!.userId,
      name: req.user!.username,
    });

    at.addGrant({
      roomJoin: true,
      room: invite.roomSlug,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const livekitToken = await at.toJwt();
    const livekitUrl = config.livekit.publicUrl || config.livekit.url;

    res.json({
      message: "Присоединились к комнате",
      token: livekitToken,
      livekitUrl,
      room: { id: invite.roomId, name: invite.roomName, slug: invite.roomSlug },
    });
  } catch (error) {
    console.error("Invite join error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// POST /api/invite/:code/join-guest — войти как гость (без авторизации)
router.post("/:code/join-guest", async (req: Request, res: Response) => {
  try {
    const parsed = joinGuestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Ошибка валидации",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { displayName } = parsed.data;

    const validation = await validateInvite(req.params.code);
    if ("error" in validation) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const { invite } = validation;

    if (!invite.allowGuests) {
      res.status(403).json({ error: "Гостевой вход по этой ссылке запрещён" });
      return;
    }

    // Проверяем вместимость по зарегистрированным участникам
    const countResult = await db.query(
      "SELECT COUNT(DISTINCT user_id) AS count FROM participants WHERE room_id = $1 AND left_at IS NULL",
      [invite.roomId]
    );

    if (parseInt(countResult.rows[0].count) >= invite.maxUsers) {
      res.status(400).json({ error: "Комната заполнена" });
      return;
    }

    await db.query(
      "UPDATE invite_links SET uses_count = uses_count + 1 WHERE id = $1",
      [invite.id]
    );

    const guestIdentity = `guest_${nanoid(8)}`;

    const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
      identity: guestIdentity,
      name: displayName,
    });

    at.addGrant({
      roomJoin: true,
      room: invite.roomSlug,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const livekitToken = await at.toJwt();
    const livekitUrl = config.livekit.publicUrl || config.livekit.url;

    res.json({
      message: "Присоединились к комнате как гость",
      token: livekitToken,
      livekitUrl,
      guestIdentity,
      room: { id: invite.roomId, name: invite.roomName, slug: invite.roomSlug },
    });
  } catch (error) {
    console.error("Invite guest join error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

export default router;
