import { Router, Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db } from "../lib/db.js";
import { config } from "../config/index.js";
import type { JwtPayload } from "../middleware/auth.js";
import { createPollSchema, votePollSchema } from "../schemas/index.js";

// Гибридная аутентификация: наш JWT либо LiveKit JWT (для гостей).
// Та же схема, что у uploads.ts.
declare global {
  namespace Express {
    interface Request {
      pollGuestIdentity?: string;
    }
  }
}

function pollAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Токен авторизации не предоставлен" });
    return;
  }
  const token = header.split(" ")[1];

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    if (decoded?.userId) {
      req.user = decoded;
      next();
      return;
    }
  } catch {
    // не наш JWT — пробуем LiveKit
  }

  try {
    const decoded = jwt.verify(token, config.livekit.apiSecret) as {
      sub?: string;
      video?: { room?: string };
    };
    const slug = req.params.slug;
    if (decoded?.sub && decoded.video?.room && decoded.video.room === slug) {
      req.pollGuestIdentity = decoded.sub;
      next();
      return;
    }
    res.status(403).json({ error: "Токен не соответствует комнате" });
    return;
  } catch {
    res.status(401).json({ error: "Недействительный токен" });
  }
}

const router = Router();
router.use(pollAuth);

// OWNER или MODERATOR — для создания/закрытия опросов. Проверка как в recordings.ts.
async function requireRoomMod(slug: string, userId: string) {
  const roomResult = await db.query(
    `SELECT id, owner_id AS "ownerId", is_active AS "isActive"
       FROM rooms WHERE slug = $1`,
    [slug],
  );
  if (roomResult.rows.length === 0) {
    return { error: { status: 404, message: "Комната не найдена" } as const };
  }
  const room = roomResult.rows[0];
  if (room.ownerId === userId) {
    return { room: { id: room.id as string, isActive: room.isActive as boolean } };
  }
  const authResult = await db.query(
    `SELECT role FROM participants
      WHERE user_id = $1 AND room_id = $2
      ORDER BY joined_at DESC LIMIT 1`,
    [userId, room.id],
  );
  const role = authResult.rows[0]?.role;
  if (role !== "MODERATOR") {
    return { error: { status: 403, message: "Недостаточно прав" } as const };
  }
  return { room: { id: room.id as string, isActive: room.isActive as boolean } };
}

// Поиск комнаты по slug — для голосования (доступно всем участникам, включая гостей).
async function findRoomBySlug(slug: string) {
  const result = await db.query(
    `SELECT id, is_active AS "isActive" FROM rooms WHERE slug = $1`,
    [slug],
  );
  if (result.rows.length === 0) return null;
  return result.rows[0] as { id: string; isActive: boolean };
}

// POST /api/rooms/:slug/polls — создать опрос (OWNER или MODERATOR).
router.post("/:slug/polls", async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      res.status(403).json({ error: "Гостям нельзя создавать опросы" });
      return;
    }
    const slug = req.params.slug as string;
    const access = await requireRoomMod(slug, req.user.userId);
    if (access.error) {
      res.status(access.error.status).json({ error: access.error.message });
      return;
    }
    if (!access.room.isActive) {
      res.status(400).json({ error: "Комната закрыта" });
      return;
    }

    const parse = createPollSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        error: "Некорректные данные",
        details: parse.error.flatten(),
      });
      return;
    }
    const { question, options, allowMultiple, isAnonymous } = parse.data;

    // Имя автора берём из users (для отображения в чате/результатах).
    const userResult = await db.query(
      `SELECT username FROM users WHERE id = $1`,
      [req.user.userId],
    );
    const createdByName = userResult.rows[0]?.username ?? null;

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const pollResult = await client.query(
        `INSERT INTO chat_polls (room_id, question, allow_multiple, is_anonymous, created_by, created_by_name)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS "createdAtMs"`,
        [access.room.id, question, allowMultiple, isAnonymous, req.user.userId, createdByName],
      );
      const pollId = pollResult.rows[0].id as string;
      const createdAtMs = Number(pollResult.rows[0].createdAtMs);

      const optionRows: { id: string; text: string; position: number }[] = [];
      for (let i = 0; i < options.length; i++) {
        const opt = await client.query(
          `INSERT INTO poll_options (poll_id, text, position)
           VALUES ($1, $2, $3) RETURNING id, text, position`,
          [pollId, options[i], i],
        );
        optionRows.push(opt.rows[0]);
      }
      await client.query("COMMIT");

      res.status(201).json({
        poll: {
          id: pollId,
          question,
          allowMultiple,
          isAnonymous,
          isClosed: false,
          createdBy: req.user.userId,
          createdByName,
          createdAt: createdAtMs,
          closedAt: null,
          options: optionRows.map((o) => ({
            id: o.id,
            text: o.text,
            position: o.position,
            voteCount: 0,
            voters: [],
          })),
          totalVotes: 0,
          myVote: [],
        },
      });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Create poll error:", error);
    res.status(500).json({ error: "Не удалось создать опрос" });
  }
});

// POST /api/rooms/:slug/polls/:id/vote — проголосовать. Только зарегистрированные:
// гости (LiveKit-JWT без нашего userId) получают 403.
router.post("/:slug/polls/:id/vote", async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      res.status(403).json({
        error: "Голосование доступно только зарегистрированным пользователям",
      });
      return;
    }
    const slug = req.params.slug as string;
    const pollId = req.params.id as string;
    const room = await findRoomBySlug(slug);
    if (!room) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }
    if (!room.isActive) {
      res.status(400).json({ error: "Комната закрыта" });
      return;
    }

    const parse = votePollSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        error: "Некорректные данные",
        details: parse.error.flatten(),
      });
      return;
    }
    const { optionIds, voterIdentity, voterName } = parse.data;

    // Берём опрос и его опции, проверяем что он жив.
    const pollResult = await db.query(
      `SELECT id, allow_multiple AS "allowMultiple", is_closed AS "isClosed"
         FROM chat_polls WHERE id = $1 AND room_id = $2`,
      [pollId, room.id],
    );
    if (pollResult.rows.length === 0) {
      res.status(404).json({ error: "Опрос не найден" });
      return;
    }
    const poll = pollResult.rows[0];
    if (poll.isClosed) {
      res.status(400).json({ error: "Опрос уже закрыт" });
      return;
    }

    if (!poll.allowMultiple && optionIds.length > 1) {
      res.status(400).json({ error: "Можно выбрать только один вариант" });
      return;
    }

    // Проверяем, что все option_id принадлежат опросу.
    const validOptionsResult = await db.query(
      `SELECT id FROM poll_options WHERE poll_id = $1 AND id = ANY($2::uuid[])`,
      [pollId, optionIds],
    );
    if (validOptionsResult.rows.length !== optionIds.length) {
      res.status(400).json({ error: "Неверные варианты ответа" });
      return;
    }

    // Голос фиксируется — если уже голосовал, отклоняем.
    const existingVote = await db.query(
      `SELECT 1 FROM poll_votes WHERE poll_id = $1 AND voter_identity = $2 LIMIT 1`,
      [pollId, voterIdentity],
    );
    if (existingVote.rows.length > 0) {
      res.status(409).json({ error: "Вы уже голосовали" });
      return;
    }

    // voter_user_id — null для гостей, наш userId для зарегистрированных.
    const voterUserId = req.user?.userId ?? null;

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      for (const optionId of optionIds) {
        await client.query(
          `INSERT INTO poll_votes (poll_id, option_id, voter_user_id, voter_identity, voter_name)
           VALUES ($1, $2, $3, $4, $5)`,
          [pollId, optionId, voterUserId, voterIdentity, voterName ?? null],
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    res.json({ message: "Голос принят", optionIds });
  } catch (error) {
    console.error("Vote poll error:", error);
    res.status(500).json({ error: "Не удалось проголосовать" });
  }
});

// POST /api/rooms/:slug/polls/:id/close — закрыть опрос (OWNER или MODERATOR).
router.post("/:slug/polls/:id/close", async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      res.status(403).json({ error: "Гостям нельзя закрывать опросы" });
      return;
    }
    const slug = req.params.slug as string;
    const access = await requireRoomMod(slug, req.user.userId);
    if (access.error) {
      res.status(access.error.status).json({ error: access.error.message });
      return;
    }

    const result = await db.query(
      `UPDATE chat_polls SET is_closed = true, closed_at = NOW()
        WHERE id = $1 AND room_id = $2 AND is_closed = false
        RETURNING id`,
      [req.params.id, access.room.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Опрос не найден или уже закрыт" });
      return;
    }
    res.json({ message: "Опрос закрыт" });
  } catch (error) {
    console.error("Close poll error:", error);
    res.status(500).json({ error: "Не удалось закрыть опрос" });
  }
});

export default router;
