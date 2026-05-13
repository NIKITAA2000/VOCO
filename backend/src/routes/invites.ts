import { Router, Request, Response } from "express";
import { nanoid } from "nanoid";
import { AccessToken } from "livekit-server-sdk";
import { db } from "../lib/db.js";
import { authenticate } from "../middleware/auth.js";
import { joinGuestSchema } from "../schemas/index.js";
import { config } from "../config/index.js";
import {
  buildMetadata,
  PARTICIPANT_STATUS_ACTIVE,
} from "../lib/livekit.js";

async function loadPinnedMessages(roomId: string) {
  const result = await db.query(
    `SELECT id, message, author_identity AS "authorIdentity",
            author_name AS "authorName",
            original_external_id AS "originalExternalId",
            original_timestamp AS "originalTimestamp",
            attachment_url AS "attachmentUrl",
            attachment_name AS "attachmentName",
            attachment_kind AS "attachmentKind",
            attachment_size AS "attachmentSize",
            attachment_mime AS "attachmentMime",
            pinned_by AS "pinnedBy", pinned_at AS "pinnedAt"
     FROM pinned_messages
     WHERE room_id = $1
     ORDER BY pinned_at ASC`,
    [roomId]
  );
  return result.rows.map((p) => ({
    id: p.id,
    message: p.message ?? "",
    authorIdentity: p.authorIdentity,
    authorName: p.authorName,
    originalExternalId: p.originalExternalId,
    originalTimestamp: p.originalTimestamp != null ? Number(p.originalTimestamp) : null,
    attachment: p.attachmentUrl
      ? {
          url: p.attachmentUrl,
          name: p.attachmentName,
          kind: p.attachmentKind,
          size: p.attachmentSize != null ? Number(p.attachmentSize) : null,
          mime: p.attachmentMime,
        }
      : null,
    pinnedBy: p.pinnedBy,
    pinnedAt: p.pinnedAt,
  }));
}

async function loadChatHistory(roomId: string) {
  const result = await db.query(
    `SELECT id, external_id AS "externalId",
            author_identity AS "authorIdentity",
            author_name AS "authorName", message,
            sent_at AS "sentAt", is_guest AS "isGuest",
            attachment_url AS "attachmentUrl",
            attachment_name AS "attachmentName",
            attachment_kind AS "attachmentKind",
            attachment_size AS "attachmentSize",
            attachment_mime AS "attachmentMime"
     FROM chat_messages
     WHERE room_id = $1
     ORDER BY sent_at ASC`,
    [roomId]
  );
  return result.rows.map((m) => ({
    id: m.id,
    externalId: m.externalId,
    authorIdentity: m.authorIdentity,
    authorName: m.authorName,
    message: m.message ?? "",
    sentAt: Number(m.sentAt),
    isGuest: m.isGuest,
    attachment: m.attachmentUrl
      ? {
          url: m.attachmentUrl,
          name: m.attachmentName,
          kind: m.attachmentKind,
          size: m.attachmentSize != null ? Number(m.attachmentSize) : null,
          mime: m.attachmentMime,
        }
      : null,
  }));
}

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
  roomAllowGuests: boolean;
  roomRequireApproval: boolean;
  roomOwnerId: string;
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
            r.name AS "roomName", r.max_users AS "maxUsers",
            r.allow_guests AS "roomAllowGuests",
            r.require_approval AS "roomRequireApproval",
            r.owner_id AS "roomOwnerId"
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

// GET /api/invite/:code/info — публичная превью-информация о приглашении
router.get("/:code/info", async (req: Request, res: Response) => {
  try {
    const validation = await validateInvite(req.params.code as string);
    if ("error" in validation) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }
    const { invite } = validation;

    const ownerResult = await db.query(
      "SELECT username FROM users WHERE id = $1",
      [invite.roomOwnerId]
    );
    const ownerUsername = ownerResult.rows[0]?.username ?? "";

    res.json({
      room: {
        id: invite.roomId,
        name: invite.roomName,
        slug: invite.roomSlug,
        allowGuests: invite.roomAllowGuests && invite.allowGuests,
        requireApproval: invite.roomRequireApproval,
      },
      owner: { username: ownerUsername },
    });
  } catch (error) {
    console.error("Invite info error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// POST /api/invite/:code/join — войти по ссылке (с авторизацией)
router.post("/:code/join", authenticate, async (req: Request, res: Response) => {
  try {
    const validation = await validateInvite(req.params.code as string);
    if ("error" in validation) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const { invite } = validation;

    // Проверяем блокировку
    const blockedResult = await db.query(
      "SELECT id FROM blocked_users WHERE room_id = $1 AND user_id = $2",
      [invite.roomId, req.user!.userId]
    );
    if (blockedResult.rows.length > 0) {
      res.status(403).json({ error: "Вы заблокированы в этой комнате" });
      return;
    }

    // Проверяем — не в комнате ли уже
    const existingResult = await db.query(
      "SELECT id FROM participants WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
      [req.user!.userId, invite.roomId]
    );
    const alreadyInRoom = existingResult.rows.length > 0;

    if (!alreadyInRoom) {
      // Проверяем вместимость
      const countResult = await db.query(
        "SELECT COUNT(DISTINCT user_id) AS count FROM participants WHERE room_id = $1 AND left_at IS NULL",
        [invite.roomId]
      );

      if (parseInt(countResult.rows[0].count) >= invite.maxUsers) {
        res.status(400).json({ error: "Комната заполнена" });
        return;
      }

      // Сохраняем роль если пользователь уже был в комнате (MODERATOR не теряется после rejoin)
      const lastRoleResult = await db.query(
        "SELECT role FROM participants WHERE user_id = $1 AND room_id = $2 ORDER BY joined_at DESC LIMIT 1",
        [req.user!.userId, invite.roomId]
      );
      const lastRole = lastRoleResult.rows[0]?.role;
      const role =
        invite.roomOwnerId === req.user!.userId
          ? "OWNER"
          : lastRole === "MODERATOR"
          ? "MODERATOR"
          : "PARTICIPANT";

      await db.query(
        "INSERT INTO participants (user_id, room_id, role) VALUES ($1, $2, $3)",
        [req.user!.userId, invite.roomId, role]
      );

      await db.query(
        "UPDATE invite_links SET uses_count = uses_count + 1 WHERE id = $1",
        [invite.id]
      );
    }

    // Получаем роль для LiveKit грантов
    const roleResult = await db.query(
      "SELECT role FROM participants WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL ORDER BY joined_at DESC LIMIT 1",
      [req.user!.userId, invite.roomId]
    );
    const participantRole = roleResult.rows[0]?.role ?? "PARTICIPANT";
    const canPublishData = participantRole === "OWNER" || participantRole === "MODERATOR";
    const isPrivileged = participantRole === "OWNER" || participantRole === "MODERATOR";
    let wasApproved = false;
    if (invite.roomRequireApproval && !isPrivileged) {
      const approvedResult = await db.query(
        "SELECT 1 FROM participants WHERE user_id = $1 AND room_id = $2 AND approved = true LIMIT 1",
        [req.user!.userId, invite.roomId],
      );
      wasApproved = approvedResult.rows.length > 0;
    }
    const isPending = invite.roomRequireApproval && !isPrivileged && !wasApproved;

    const { displayName } = req.body;
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
      room: invite.roomSlug,
      canPublish: !isPending,
      canSubscribe: !isPending,
      canPublishData: isPending ? false : canPublishData,
      canUpdateOwnMetadata: !isPending,
    });

    const livekitToken = await at.toJwt();
    const livekitUrl = config.livekit.publicUrl || config.livekit.url;

    const [pinnedMessages, chatHistory] = await Promise.all([
      loadPinnedMessages(invite.roomId),
      loadChatHistory(invite.roomId),
    ]);

    res.json({
      message: isPending ? "Запрос отправлен модератору" : "Присоединились к комнате",
      token: livekitToken,
      livekitUrl,
      pending: isPending,
      room: { id: invite.roomId, name: invite.roomName, slug: invite.roomSlug },
      pinnedMessages,
      chatHistory,
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

    const validation = await validateInvite(req.params.code as string);
    if ("error" in validation) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const { invite } = validation;

    if (!invite.allowGuests) {
      res.status(403).json({ error: "Гостевой вход по этой ссылке запрещён" });
      return;
    }
    if (!invite.roomAllowGuests) {
      res.status(403).json({ error: "В этой комнате запрещён гостевой вход" });
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
    const isPending = invite.roomRequireApproval;

    const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
      identity: guestIdentity,
      name: displayName,
      metadata: buildMetadata({
        status: isPending ? "pending" : PARTICIPANT_STATUS_ACTIVE,
        isGuest: true,
      }),
    });

    at.addGrant({
      roomJoin: true,
      room: invite.roomSlug,
      canPublish: !isPending,
      canSubscribe: !isPending,
      canPublishData: isPending ? false : true,
      canUpdateOwnMetadata: !isPending,
    });

    const livekitToken = await at.toJwt();
    const livekitUrl = config.livekit.publicUrl || config.livekit.url;

    const [pinnedMessages, chatHistory] = await Promise.all([
      loadPinnedMessages(invite.roomId),
      loadChatHistory(invite.roomId),
    ]);

    res.json({
      message: isPending
        ? "Запрос отправлен модератору"
        : "Присоединились к комнате как гость",
      token: livekitToken,
      livekitUrl,
      guestIdentity,
      pending: isPending,
      room: { id: invite.roomId, name: invite.roomName, slug: invite.roomSlug },
      pinnedMessages,
      chatHistory,
    });
  } catch (error) {
    console.error("Invite guest join error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

export default router;
