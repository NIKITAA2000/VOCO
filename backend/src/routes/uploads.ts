import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { db } from "../lib/db.js";
import { config } from "../config/index.js";
import type { JwtPayload } from "../middleware/auth.js";

// Guest identity, выставляется когда запрос пришёл с LiveKit-токеном (а не нашим JWT).
declare global {
  namespace Express {
    interface Request {
      guestIdentity?: string;
      guestRoomSlug?: string;
    }
  }
}

// Гибридная аутентификация: пытаемся декодировать заголовок как наш JWT,
// затем — как LiveKit JWT (гости). LiveKit JWT обязан содержать `video.room`,
// совпадающий со slug-ом запроса.
function uploadAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Токен авторизации не предоставлен" });
    return;
  }
  const token = header.split(" ")[1];

  // 1) Наш JWT
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    if (decoded?.userId) {
      req.user = decoded;
      next();
      return;
    }
  } catch {
    // не наш — пробуем LiveKit
  }

  // 2) LiveKit JWT
  try {
    const decoded = jwt.verify(token, config.livekit.apiSecret) as {
      sub?: string;
      video?: { room?: string };
    };
    const slug = req.params.slug;
    if (decoded?.sub && decoded.video?.room && decoded.video.room === slug) {
      req.guestIdentity = decoded.sub;
      req.guestRoomSlug = decoded.video.room;
      next();
      return;
    }
    res.status(403).json({ error: "Токен не соответствует комнате" });
    return;
  } catch {
    res.status(401).json({ error: "Недействительный токен" });
  }
}

// Все загрузки лежат в backend/uploads/ (Docker volume в проде).
// Имена файлов случайные — внешние client'ы не могут угадать чужой файл
// без знания slug-а сообщения. Оригинальное имя сохраняется в attachment_name
// и используется при скачивании.
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED: Record<string, { kind: "image" | "video" | "document"; max: number }> = {
  // Изображения — до 10 МБ
  "image/jpeg": { kind: "image", max: 10 * 1024 * 1024 },
  "image/png": { kind: "image", max: 10 * 1024 * 1024 },
  "image/webp": { kind: "image", max: 10 * 1024 * 1024 },
  "image/gif": { kind: "image", max: 10 * 1024 * 1024 },
  // Видео — до 100 МБ
  "video/mp4": { kind: "video", max: 100 * 1024 * 1024 },
  "video/webm": { kind: "video", max: 100 * 1024 * 1024 },
  "video/quicktime": { kind: "video", max: 100 * 1024 * 1024 },
  // Документы — до 25 МБ
  "application/pdf": { kind: "document", max: 25 * 1024 * 1024 },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    kind: "document",
    max: 25 * 1024 * 1024,
  }, // .docx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
    kind: "document",
    max: 25 * 1024 * 1024,
  }, // .pptx
};

const MAX_BYTES = 100 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 8);
    const safe = crypto.randomBytes(16).toString("hex");
    cb(null, `${safe}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED[file.mimetype]) {
      cb(new Error(`Тип файла не разрешён: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

// Обёртка над multer: если файл не подошёл по фильтру/размеру — отдаём JSON 400
// вместо HTML-страницы Express по умолчанию.
function singleFileSafe(field: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    upload.single(field)(req, res, (err: any) => {
      if (err) {
        const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        res.status(status).json({ error: err.message || "Не удалось загрузить файл" });
        return;
      }
      next();
    });
  };
}

const router = Router();

// POST /api/rooms/:slug/uploads — загрузить файл в чат комнаты.
// Доступно зарегистрированным участникам (по нашему JWT) и гостям
// (по LiveKit-токену с video.room == slug).
router.post(
  "/:slug/uploads",
  uploadAuth,
  singleFileSafe("file"),
  async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "Файл не загружен" });
        return;
      }

      const meta = ALLOWED[file.mimetype];
      if (!meta) {
        // Удалим случайно сохранённый файл (multer пишет до filter в edge-cases)
        fs.promises.unlink(file.path).catch(() => undefined);
        res.status(400).json({ error: "Тип файла не разрешён" });
        return;
      }
      // Multer интерпретирует originalname как latin1 — кириллица превращается
      // в мохибаке. Перекодируем в UTF-8.
      const originalName = Buffer.from(file.originalname, "latin1").toString("utf8");
      if (file.size > meta.max) {
        fs.promises.unlink(file.path).catch(() => undefined);
        res.status(413).json({
          error: `Файл слишком большой (максимум ${Math.round(meta.max / 1024 / 1024)} МБ)`,
        });
        return;
      }

      const roomResult = await db.query(
        `SELECT id, is_active AS "isActive" FROM rooms WHERE slug = $1`,
        [req.params.slug],
      );
      if (roomResult.rows.length === 0) {
        fs.promises.unlink(file.path).catch(() => undefined);
        res.status(404).json({ error: "Комната не найдена" });
        return;
      }
      const roomId = roomResult.rows[0].id;
      if (!roomResult.rows[0].isActive) {
        fs.promises.unlink(file.path).catch(() => undefined);
        res.status(400).json({ error: "Комната закрыта" });
        return;
      }

      // Для зарегистрированных проверяем запись в participants. Гостям достаточно
      // валидного LiveKit-токена под эту комнату (uploadAuth уже проверил).
      if (req.user) {
        const authResult = await db.query(
          "SELECT 1 FROM participants WHERE user_id = $1 AND room_id = $2 AND left_at IS NULL",
          [req.user.userId, roomId],
        );
        if (authResult.rows.length === 0) {
          fs.promises.unlink(file.path).catch(() => undefined);
          res.status(403).json({ error: "Вы не в этой комнате" });
          return;
        }
      }

      const url = `/uploads/${file.filename}`;
      res.status(201).json({
        url,
        kind: meta.kind,
        name: originalName,
        size: file.size,
        mime: file.mimetype,
      });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ error: "Не удалось загрузить файл" });
    }
  },
);

export default router;
export { UPLOAD_DIR };
