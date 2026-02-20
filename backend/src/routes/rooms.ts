import { Router, Request, Response } from "express";
import { nanoid } from "nanoid";
import { AccessToken } from "livekit-server-sdk";
import { db } from "../lib/db.js";
import { authenticate } from "../middleware/auth.js";
import { createRoomSchema } from "../schemas/index.js";
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

      const role = room.ownerId === req.user!.userId ? "OWNER" : "PARTICIPANT";
      await db.query(
        "INSERT INTO participants (user_id, room_id, role) VALUES ($1, $2, $3)",
        [req.user!.userId, room.id, role]
      );
    }

    // Generate LiveKit token
    const at = new AccessToken(
      config.livekit.apiKey,
      config.livekit.apiSecret,
      {
        identity: req.user!.userId,
        name: req.user!.username,
      }
    );

    at.addGrant({
      roomJoin: true,
      room: room.slug,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const livekitToken = await at.toJwt();

    res.json({
      message: "Присоединились к комнате",
      token: livekitToken,
      livekitUrl: config.livekit.url.replace("ws://", "http://"),
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