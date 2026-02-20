import { Router, Request, Response } from "express";
import { nanoid } from "nanoid";
import { db } from "../lib/db.js";
import { authenticate } from "../middleware/auth.js";
import { createRoomSchema } from "../schemas/index.js";

const router = Router();

// All room routes require authentication
router.use(authenticate);

// POST /api/rooms — create a new room
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

    // Auto-add owner as participant
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

// GET /api/rooms — list user's rooms
router.get("/", async (req: Request, res: Response) => {
  try {
    const rooms = db.findRoomsByUser(req.user!.userId);

    const result = rooms.map((room) => {
      const owner = db.findUserById(room.ownerId);
      const activeCount = db.getActiveParticipants(room.id).length;
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

// GET /api/rooms/:slug — get room by slug
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

// POST /api/rooms/:slug/join — join room
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

    const activeCount = db.getActiveParticipants(room.id).length;
    if (activeCount >= room.maxUsers) {
      res.status(400).json({ error: "Комната заполнена" });
      return;
    }

    const role = room.ownerId === req.user!.userId ? "OWNER" : "PARTICIPANT";
    db.addParticipant(req.user!.userId, room.id, role);

    res.json({
      message: "Присоединились к комнате",
      // LiveKit токен будет здесь после подключения LiveKit
      room: { id: room.id, name: room.name, slug: room.slug },
    });
  } catch (error) {
    console.error("Join room error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// POST /api/rooms/:slug/leave — leave room
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

// DELETE /api/rooms/:slug — close room (owner only)
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