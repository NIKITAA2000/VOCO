import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { db } from "../lib/db.js";
import { authenticate } from "../middleware/auth.js";
import {
  createTrackBodySchema,
  updateTrackSchema,
  reorderPlaylistSchema,
} from "../schemas/index.js";

const AUDIO_DIR = path.resolve(process.cwd(), "uploads", "audio");
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

const ALLOWED_AUDIO: Record<string, true> = {
  "audio/mpeg": true,
  "audio/mp3": true,
  "audio/ogg": true,
  "audio/wav": true,
  "audio/x-wav": true,
  "audio/wave": true,
};

const ALLOWED_ICON: Record<string, true> = {
  "image/jpeg": true,
  "image/png": true,
  "image/webp": true,
};

const MAX_TRACK_BYTES = 10 * 1024 * 1024;
const MAX_EVENT_BYTES = 1 * 1024 * 1024;
const MAX_ICON_BYTES = 2 * 1024 * 1024;
const MAX_PLAYLIST_TRACKS = 10;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, AUDIO_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 8);
    const safe = crypto.randomBytes(16).toString("hex");
    cb(null, `${safe}${ext}`);
  },
});

// Track-uploader: одно аудио до 10 МБ + опциональная иконка до 2 МБ.
const trackUpload = multer({
  storage,
  // Жёсткий лимит — самый большой возможный файл в multipart (audio).
  limits: { fileSize: MAX_TRACK_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === "audio") {
      if (!ALLOWED_AUDIO[file.mimetype]) {
        cb(new Error("Аудио: mp3, ogg или wav"));
        return;
      }
      cb(null, true);
      return;
    }
    if (file.fieldname === "icon") {
      if (!ALLOWED_ICON[file.mimetype]) {
        cb(new Error("Иконка: jpg, png или webp"));
        return;
      }
      cb(null, true);
      return;
    }
    cb(new Error(`Неожиданное поле: ${file.fieldname}`));
  },
});

// Event-sound uploader (fun/hand/join): одно аудио до 1 МБ.
const eventUpload = multer({
  storage,
  limits: { fileSize: MAX_EVENT_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_AUDIO[file.mimetype]) {
      cb(new Error("Аудио: mp3, ogg или wav"));
      return;
    }
    cb(null, true);
  },
});

function trackFieldsSafe(req: Request, res: Response, next: NextFunction) {
  const handler = trackUpload.fields([
    { name: "audio", maxCount: 1 },
    { name: "icon", maxCount: 1 },
  ]);
  handler(req, res, (err: any) => {
    if (err) {
      const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      res.status(status).json({ error: err.message || "Не удалось загрузить файл" });
      return;
    }
    next();
  });
}

function eventFieldSafe(req: Request, res: Response, next: NextFunction) {
  const handler = eventUpload.single("audio");
  handler(req, res, (err: any) => {
    if (err) {
      const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      res.status(status).json({ error: err.message || "Не удалось загрузить файл" });
      return;
    }
    next();
  });
}

// Все звуки и плейлист правит ТОЛЬКО владелец комнаты — не модератор. Хочется
// гарантировать, что фоновую музыку или прикольный звук не подменит кто-то ещё.
async function requireRoomOwner(slug: string, userId: string) {
  const result = await db.query(
    `SELECT id, owner_id AS "ownerId" FROM rooms WHERE slug = $1`,
    [slug],
  );
  if (result.rows.length === 0) {
    return { error: { status: 404, message: "Комната не найдена" } as const };
  }
  const room = result.rows[0];
  if (room.ownerId !== userId) {
    return { error: { status: 403, message: "Только владелец комнаты" } as const };
  }
  return { roomId: room.id as string };
}

function publicUrlForFile(filename: string): string {
  return `/uploads/audio/${filename}`;
}

// Безопасный unlink по публичному URL (/uploads/audio/<file>). Не даём вылезти
// за пределы AUDIO_DIR через ../ — basename отрезает любые подкаталоги.
async function unlinkByUrl(url: string | null | undefined): Promise<void> {
  if (!url) return;
  if (!url.startsWith("/uploads/audio/")) return;
  const filename = path.basename(url);
  if (!filename) return;
  const full = path.join(AUDIO_DIR, filename);
  await fs.promises.unlink(full).catch(() => undefined);
}

const router = Router();
router.use(authenticate);

// POST /api/rooms/:slug/playlist — загрузить трек.
router.post(
  "/:slug/playlist",
  trackFieldsSafe,
  async (req: Request, res: Response) => {
    const files = req.files as
      | { audio?: Express.Multer.File[]; icon?: Express.Multer.File[] }
      | undefined;
    const audio = files?.audio?.[0];
    const icon = files?.icon?.[0];

    const cleanup = async () => {
      if (audio) await fs.promises.unlink(audio.path).catch(() => undefined);
      if (icon) await fs.promises.unlink(icon.path).catch(() => undefined);
    };

    try {
      if (!audio) {
        await cleanup();
        res.status(400).json({ error: "Аудио-файл обязателен" });
        return;
      }
      if (audio.size > MAX_TRACK_BYTES) {
        await cleanup();
        res.status(413).json({ error: "Аудио до 10 МБ" });
        return;
      }
      if (icon && icon.size > MAX_ICON_BYTES) {
        await cleanup();
        res.status(413).json({ error: "Иконка до 2 МБ" });
        return;
      }

      const parsed = createTrackBodySchema.safeParse({
        title: req.body?.title,
        author: req.body?.author,
      });
      if (!parsed.success) {
        await cleanup();
        res
          .status(400)
          .json({ error: "Некорректные данные", details: parsed.error.flatten() });
        return;
      }

      const access = await requireRoomOwner(req.params.slug as string, req.user!.userId);
      if (access.error) {
        await cleanup();
        res.status(access.error.status).json({ error: access.error.message });
        return;
      }

      const countResult = await db.query(
        `SELECT COUNT(*)::int AS count FROM room_playlist_tracks WHERE room_id = $1`,
        [access.roomId],
      );
      if (countResult.rows[0].count >= MAX_PLAYLIST_TRACKS) {
        await cleanup();
        res
          .status(409)
          .json({ error: `В плейлисте максимум ${MAX_PLAYLIST_TRACKS} треков` });
        return;
      }

      const audioUrl = publicUrlForFile(audio.filename);
      const iconUrl = icon ? publicUrlForFile(icon.filename) : null;

      const insertResult = await db.query(
        `INSERT INTO room_playlist_tracks
           (room_id, title, author, audio_url, audio_mime, audio_size, icon_url, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7,
           (SELECT COALESCE(MAX(position), -1) + 1 FROM room_playlist_tracks WHERE room_id = $1))
         RETURNING id, title, author,
                   audio_url AS "audioUrl",
                   audio_mime AS "audioMime",
                   audio_size AS "audioSize",
                   icon_url AS "iconUrl",
                   position`,
        [
          access.roomId,
          parsed.data.title,
          parsed.data.author ?? null,
          audioUrl,
          audio.mimetype,
          audio.size,
          iconUrl,
        ],
      );

      const row = insertResult.rows[0];
      res.status(201).json({
        track: {
          id: row.id,
          title: row.title,
          author: row.author ?? null,
          audioUrl: row.audioUrl,
          audioMime: row.audioMime,
          audioSize: Number(row.audioSize),
          iconUrl: row.iconUrl ?? null,
          position: row.position,
        },
      });
    } catch (error) {
      console.error("Upload track error:", error);
      await cleanup();
      res.status(500).json({ error: "Не удалось загрузить трек" });
    }
  },
);

// PATCH /api/rooms/:slug/playlist/:trackId — переименовать.
router.patch("/:slug/playlist/:trackId", async (req: Request, res: Response) => {
  try {
    const parsed = updateTrackSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Некорректные данные", details: parsed.error.flatten() });
      return;
    }
    const access = await requireRoomOwner(req.params.slug as string, req.user!.userId);
    if (access.error) {
      res.status(access.error.status).json({ error: access.error.message });
      return;
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    if (parsed.data.title !== undefined) {
      fields.push(`title = $${fields.length + 1}`);
      values.push(parsed.data.title);
    }
    if (parsed.data.author !== undefined) {
      fields.push(`author = $${fields.length + 1}`);
      values.push(parsed.data.author);
    }
    values.push(req.params.trackId, access.roomId);

    const result = await db.query(
      `UPDATE room_playlist_tracks SET ${fields.join(", ")}
        WHERE id = $${fields.length + 1} AND room_id = $${fields.length + 2}
        RETURNING id, title, author,
                  audio_url AS "audioUrl",
                  audio_mime AS "audioMime",
                  audio_size AS "audioSize",
                  icon_url AS "iconUrl",
                  position`,
      values,
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Трек не найден" });
      return;
    }
    const row = result.rows[0];
    res.json({
      track: {
        id: row.id,
        title: row.title,
        author: row.author ?? null,
        audioUrl: row.audioUrl,
        audioMime: row.audioMime,
        audioSize: Number(row.audioSize),
        iconUrl: row.iconUrl ?? null,
        position: row.position,
      },
    });
  } catch (error) {
    console.error("Update track error:", error);
    res.status(500).json({ error: "Не удалось обновить трек" });
  }
});

// DELETE /api/rooms/:slug/playlist/:trackId
router.delete("/:slug/playlist/:trackId", async (req: Request, res: Response) => {
  try {
    const access = await requireRoomOwner(req.params.slug as string, req.user!.userId);
    if (access.error) {
      res.status(access.error.status).json({ error: access.error.message });
      return;
    }
    const result = await db.query(
      `DELETE FROM room_playlist_tracks
        WHERE id = $1 AND room_id = $2
        RETURNING audio_url AS "audioUrl", icon_url AS "iconUrl"`,
      [req.params.trackId, access.roomId],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Трек не найден" });
      return;
    }
    await unlinkByUrl(result.rows[0].audioUrl);
    await unlinkByUrl(result.rows[0].iconUrl);
    res.json({ message: "Трек удалён" });
  } catch (error) {
    console.error("Delete track error:", error);
    res.status(500).json({ error: "Не удалось удалить трек" });
  }
});

// PUT /api/rooms/:slug/playlist/reorder
router.put("/:slug/playlist/reorder", async (req: Request, res: Response) => {
  try {
    const parsed = reorderPlaylistSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Некорректные данные", details: parsed.error.flatten() });
      return;
    }
    const access = await requireRoomOwner(req.params.slug as string, req.user!.userId);
    if (access.error) {
      res.status(access.error.status).json({ error: access.error.message });
      return;
    }

    const existing = await db.query(
      `SELECT id FROM room_playlist_tracks WHERE room_id = $1`,
      [access.roomId],
    );
    const existingIds = new Set<string>(existing.rows.map((r) => r.id));
    if (
      parsed.data.orderedIds.length !== existingIds.size ||
      parsed.data.orderedIds.some((id) => !existingIds.has(id))
    ) {
      res
        .status(400)
        .json({ error: "Список треков не совпадает с плейлистом комнаты" });
      return;
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      for (let i = 0; i < parsed.data.orderedIds.length; i++) {
        await client.query(
          `UPDATE room_playlist_tracks SET position = $1
            WHERE id = $2 AND room_id = $3`,
          [i, parsed.data.orderedIds[i], access.roomId],
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    res.json({ message: "Порядок обновлён" });
  } catch (error) {
    console.error("Reorder playlist error:", error);
    res.status(500).json({ error: "Не удалось обновить порядок" });
  }
});

const SOUND_TYPES = ["fun", "hand", "join"] as const;
type SoundType = (typeof SOUND_TYPES)[number];

function isSoundType(value: string): value is SoundType {
  return (SOUND_TYPES as readonly string[]).includes(value);
}

function columnFor(type: SoundType): string {
  return {
    fun: "sound_fun_url",
    hand: "sound_hand_url",
    join: "sound_join_url",
  }[type];
}

// PUT /api/rooms/:slug/sounds/:type — залить event/fun-звук.
router.put(
  "/:slug/sounds/:type",
  eventFieldSafe,
  async (req: Request, res: Response) => {
    const file = req.file;
    const cleanup = async () => {
      if (file) await fs.promises.unlink(file.path).catch(() => undefined);
    };
    try {
      const type = req.params.type as string;
      if (!isSoundType(type)) {
        await cleanup();
        res.status(400).json({ error: "Неверный тип звука" });
        return;
      }
      if (!file) {
        res.status(400).json({ error: "Аудио-файл обязателен" });
        return;
      }
      if (file.size > MAX_EVENT_BYTES) {
        await cleanup();
        res.status(413).json({ error: "Звук до 1 МБ" });
        return;
      }
      const access = await requireRoomOwner(req.params.slug as string, req.user!.userId);
      if (access.error) {
        await cleanup();
        res.status(access.error.status).json({ error: access.error.message });
        return;
      }

      const url = publicUrlForFile(file.filename);
      // Берём старый url ДО апдейта, чтобы потом снести его файл.
      const prevResult = await db.query(
        `SELECT ${columnFor(type)} AS "previousUrl" FROM rooms WHERE id = $1`,
        [access.roomId],
      );
      const previousUrl: string | null = prevResult.rows[0]?.previousUrl ?? null;

      await db.query(
        `UPDATE rooms SET ${columnFor(type)} = $1 WHERE id = $2`,
        [url, access.roomId],
      );

      if (previousUrl && previousUrl !== url) {
        await unlinkByUrl(previousUrl);
      }

      res.json({ url });
    } catch (error) {
      console.error("Upload sound error:", error);
      await cleanup();
      res.status(500).json({ error: "Не удалось загрузить звук" });
    }
  },
);

// DELETE /api/rooms/:slug/sounds/:type — сбросить на дефолт.
router.delete("/:slug/sounds/:type", async (req: Request, res: Response) => {
  try {
    const type = req.params.type as string;
    if (!isSoundType(type)) {
      res.status(400).json({ error: "Неверный тип звука" });
      return;
    }
    const access = await requireRoomOwner(req.params.slug as string, req.user!.userId);
    if (access.error) {
      res.status(access.error.status).json({ error: access.error.message });
      return;
    }

    const prevResult = await db.query(
      `SELECT ${columnFor(type)} AS "previousUrl" FROM rooms WHERE id = $1`,
      [access.roomId],
    );
    const previousUrl: string | null = prevResult.rows[0]?.previousUrl ?? null;

    await db.query(
      `UPDATE rooms SET ${columnFor(type)} = NULL WHERE id = $1`,
      [access.roomId],
    );

    if (previousUrl) {
      await unlinkByUrl(previousUrl);
    }

    res.json({ url: null });
  } catch (error) {
    console.error("Reset sound error:", error);
    res.status(500).json({ error: "Не удалось сбросить звук" });
  }
});

export default router;
export { AUDIO_DIR, unlinkByUrl };
