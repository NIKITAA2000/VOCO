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

    const room = db.createRoom({
      name,
      slug,
      maxUsers,
      ownerId: req.user!.userId,
    });

    db.addParticipant(req.user!.userId, room.id, "OWNER");

    const owner = db.findUserById(req.user!.userId);

    res.status(201).json({
      message: "Комната создана",
      room: {
        ...room,
        owner: owner ? { id: owner.id, username: owner.username } : null,
      },
    });
  } catch (error) {
    console.error("Create room error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// GET /api/rooms
router.get("/", async (req: Request, res: Response) => {
  try {
    const rooms = db.findRoomsByUser(req.user!.userId);

    const result = rooms.map((room) => {
      const owner = db.findUserById(room.ownerId);
      const activeCount = db.getUniqueActiveCount(room.id);
      return {
        ...room,
        owner: owner ? { id: owner.id, username: owner.username } : null,
        _count: { participants: activeCount },
      };
    });

    res.json({ rooms: result });
  } catch (error) {
    console.error("List rooms error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// GET /api/rooms/:slug
router.get("/:slug", async (req: Request, res: Response) => {
  try {
    const room = db.findRoomBySlug(req.params.slug);

    if (!room) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }

    const owner = db.findUserById(room.ownerId);
    const participants = db.getActiveParticipantsWithUsers(room.id);

    res.json({
      room: {
        ...room,
        owner: owner ? { id: owner.id, username: owner.username } : null,
        participants,
      },
    });
  } catch (error) {
    console.error("Get room error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// POST /api/rooms/:slug/join — join & get LiveKit token
router.post("/:slug/join", async (req: Request, res: Response) => {
  try {
    const room = db.findRoomBySlug(req.params.slug);

    if (!room) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }

    if (!room.isActive) {
      res.status(400).json({ error: "Комната закрыта" });
      return;
    }

    // Check capacity only for NEW users (not already in room)
    const isAlreadyIn = db.isUserInRoom(req.user!.userId, room.id);
    if (!isAlreadyIn) {
      const activeCount = db.getUniqueActiveCount(room.id);
      if (activeCount >= room.maxUsers) {
        res.status(400).json({ error: "Комната заполнена" });
        return;
      }
    }

    const role = room.ownerId === req.user!.userId ? "OWNER" : "PARTICIPANT";
    db.addParticipant(req.user!.userId, room.id, role);

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
    const room = db.findRoomBySlug(req.params.slug);

    if (!room) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }

    db.removeParticipant(req.user!.userId, room.id);
    res.json({ message: "Вы покинули комнату" });
  } catch (error) {
    console.error("Leave room error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// DELETE /api/rooms/:slug
router.delete("/:slug", async (req: Request, res: Response) => {
  try {
    const room = db.findRoomBySlug(req.params.slug);

    if (!room) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }

    if (room.ownerId !== req.user!.userId) {
      res.status(403).json({ error: "Только владелец может закрыть комнату" });
      return;
    }

    db.closeRoom(room.id);
    res.json({ message: "Комната закрыта" });
  } catch (error) {
    console.error("Delete room error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

export default router;