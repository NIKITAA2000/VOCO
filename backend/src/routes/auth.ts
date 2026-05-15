import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { db } from "../lib/db.js";
import { generateToken } from "../middleware/auth.js";
import { registerSchema, loginSchema, updateProfileSchema } from "../schemas/index.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// Аватарки лежат рядом с чатовыми загрузками — backend/uploads/avatars/.
// Тот же Docker-volume в проде, что и для чата.
const AVATAR_DIR = path.resolve(process.cwd(), "uploads", "avatars");
if (!fs.existsSync(AVATAR_DIR)) {
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
}

const AVATAR_ALLOWED: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};
const AVATAR_MAX_BYTES = 5 * 1024 * 1024; // 5 МБ

const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, AVATAR_DIR),
  filename: (_req, file, cb) => {
    const ext = AVATAR_ALLOWED[file.mimetype] ?? ".bin";
    const safe = crypto.randomBytes(16).toString("hex");
    cb(null, `${safe}${ext}`);
  },
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: AVATAR_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!AVATAR_ALLOWED[file.mimetype]) {
      cb(new Error("Только JPG, PNG или WebP"));
      return;
    }
    cb(null, true);
  },
});

function avatarSingleSafe(field: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    avatarUpload.single(field)(req, res, (err: any) => {
      if (err) {
        const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        res.status(status).json({
          error:
            err.code === "LIMIT_FILE_SIZE"
              ? "Файл слишком большой (максимум 5 МБ)"
              : err.message || "Не удалось загрузить файл",
        });
        return;
      }
      next();
    });
  };
}

// POST /api/auth/register
router.post("/register", async (req: Request, res: Response) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Ошибка валидации",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { email, username, password } = parsed.data;

    // Check if user exists
    const existing = await db.query(
      "SELECT id, email, username FROM users WHERE email = $1 OR username = $2",
      [email, username]
    );

    if (existing.rows.length > 0) {
      const field = existing.rows[0].email === email ? "email" : "username";
      res.status(409).json({
        error: `Пользователь с таким ${field} уже существует`,
      });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const result = await db.query(
      `INSERT INTO users (email, username, password)
       VALUES ($1, $2, $3)
       RETURNING id, email, username, avatar_url AS "avatarUrl", created_at AS "createdAt"`,
      [email, username, hashedPassword]
    );

    const user = result.rows[0];

    const token = generateToken({
      userId: user.id,
      email: user.email,
      username: user.username,
    });

    res.status(201).json({
      message: "Регистрация успешна",
      user,
      token,
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// POST /api/auth/login
router.post("/login", async (req: Request, res: Response) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Ошибка валидации",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { email, password } = parsed.data;

    const result = await db.query(
      `SELECT id, email, username, password, avatar_url AS "avatarUrl"
       FROM users WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: "Неверный email или пароль" });
      return;
    }

    const user = result.rows[0];

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      res.status(401).json({ error: "Неверный email или пароль" });
      return;
    }

    const token = generateToken({
      userId: user.id,
      email: user.email,
      username: user.username,
    });

    res.json({
      message: "Вход выполнен",
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatarUrl: user.avatarUrl,
      },
      token,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// GET /api/auth/me
router.get("/me", authenticate, async (req: Request, res: Response) => {
  try {
    const result = await db.query(
      `SELECT id, email, username, avatar_url AS "avatarUrl", created_at AS "createdAt"
       FROM users WHERE id = $1`,
      [req.user!.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Пользователь не найден" });
      return;
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error("Get me error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// PATCH /api/auth/me
router.patch("/me", authenticate, async (req: Request, res: Response) => {
  try {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Ошибка валидации",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { username, email, password, avatarUrl } = parsed.data;
    const userId = req.user!.userId;

    if (username !== undefined || email !== undefined) {
      const conflict = await db.query(
        `SELECT id, email, username FROM users
         WHERE id <> $1 AND (
           ($2::text IS NOT NULL AND email = $2) OR
           ($3::text IS NOT NULL AND username = $3)
         )`,
        [userId, email ?? null, username ?? null]
      );
      if (conflict.rows.length > 0) {
        const field = conflict.rows[0].email === email ? "email" : "username";
        res.status(409).json({
          error: `Пользователь с таким ${field} уже существует`,
        });
        return;
      }
    }

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (username !== undefined) {
      updates.push(`username = $${idx++}`);
      values.push(username);
    }
    if (email !== undefined) {
      updates.push(`email = $${idx++}`);
      values.push(email);
    }
    if (password !== undefined) {
      const hashedPassword = await bcrypt.hash(password, 12);
      updates.push(`password = $${idx++}`);
      values.push(hashedPassword);
    }
    if (avatarUrl !== undefined) {
      updates.push(`avatar_url = $${idx++}`);
      values.push(avatarUrl);
    }

    values.push(userId);

    const result = await db.query(
      `UPDATE users SET ${updates.join(", ")}
       WHERE id = $${idx}
       RETURNING id, email, username, avatar_url AS "avatarUrl", created_at AS "createdAt"`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Пользователь не найден" });
      return;
    }

    const user = result.rows[0];
    const token = generateToken({
      userId: user.id,
      email: user.email,
      username: user.username,
    });

    res.json({ user, token });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// POST /api/auth/avatar — загрузить фото-аватарку.
// Файл сохраняется в uploads/avatars/<hex>.<ext>, возвращается относительный URL.
// Привязка к users.avatar_url делается следующим PATCH /api/auth/me.
router.post(
  "/avatar",
  authenticate,
  avatarSingleSafe("file"),
  async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "Файл не загружен" });
        return;
      }
      const url = `/uploads/avatars/${file.filename}`;
      res.status(201).json({ avatarUrl: url });
    } catch (error) {
      console.error("Avatar upload error:", error);
      res.status(500).json({ error: "Не удалось загрузить аватарку" });
    }
  },
);

export default router;
